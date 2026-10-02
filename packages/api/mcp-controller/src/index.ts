/**
 * Remote operations that add, edit, enable, disable, and remove the MCP server
 * rows a profile patch inserts. Writes run serialized with hot reload, roll the
 * file back when the Loader rejects the change, and never return stored secrets.
 * @module @deepseek-ai/dsh-api-mcp-controller
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { composeEntries, readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { readPluginInventory } from '@deepseek-ai/dsh-host-plugin-inventory'
import type {} from '@deepseek-ai/dsh-hmr'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-mcp-status'
import type {} from '@deepseek-ai/dsh-mcp-selection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { commandLine, MCP_CLIENT_MODULE, readOwnedRows, removeRow, setRowEnabled, upsertRow, type OwnedRow } from './patch.ts'
import { displayUrl, hasEmbeddedCredentials, messageOf, redact, validateSpec } from './spec.ts'
import type {
  McpChangeResult, McpEntryId, McpError, McpOverview, McpReadOnlyReason, McpReconnectResult, McpServerInfo, McpServerSpec,
  McpSessionServers, McpToolsResult, McpUpsertOptions,
} from './types.ts'

export type * from './types.ts'

/** Row ids this form creates are `mcp-<serverName>`. */
const ROW_ID_PREFIX = 'mcp-'
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** Status changes arrive in bursts while a server reconnects; one `plugin-manager/changed` follows each burst. */
const STATUS_CHANGE_DEBOUNCE_MS = 250

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** MCP server row management for the active profile. */
    mcpServersController: McpServersController
  }
}

function flatten(rows: EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...row.group && Array.isArray(row.config) ? flatten(row.config as EntryOptions[]) : []])
}

/** The listed row `id` names, when the profile patch owns it. */
function requireOwned(rows: McpServerInfo[], id: McpEntryId): McpServerInfo {
  const row = rows.find(candidate => candidate.id === id)
  if (row === undefined) throw new ChangeRefused({ code: 'unknown-server', message: `No MCP server row "${id}"` })
  if (!row.owned) {
    throw new ChangeRefused({ code: 'read-only', message: 'This server comes from a bundle, the home patch, or an overlay; change it there' })
  }
  return row
}

class ChangeRefused extends Error {
  constructor(readonly detail: McpError) { super(detail.message) }
}

/** Remote owner of the profile's MCP server rows. */
export class McpServersController extends TypertRemoteService {
  static inject = ['loader', 'profileContext']

  private statusTimer: NodeJS.Timeout | undefined

  constructor(ctx: Context) {
    super(ctx, 'mcpServersController', { namespace: 'mcpServers' })
    ctx.on('mcp-status/changed', () => { this.scheduleStatusChange() })
    ctx.effect(() => () => { clearTimeout(this.statusTimer) }, 'mcpServersController: status debounce')
  }

  private scheduleStatusChange(): void {
    if (this.statusTimer !== undefined) return
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined
      this.ctx.emit('plugin-manager/changed', { reason: 'plugin' })
    }, STATUS_CHANGE_DEBOUNCE_MS)
    this.statusTimer.unref()
  }

  private get profile() { return this.ctx.profileContext }

  /**
   * List every MCP server row of the running profile, including rows from bundles, the
   * home patch, and command-line overlays that cannot be changed here.
   * @returns rows in composition order; stored literal secrets are replaced by `kept`.
   */
  @Remote
  async list(): Promise<McpServerInfo[]> {
    const owned = new Map(readOwnedRows(await this.readPatch()).map(row => [row.id, row]))
    const rows = flatten(composeEntries([readProfilePatches('dsh', this.profile)]))
      .filter(row => row.name === MCP_CLIENT_MODULE)
    const inventory = new Map((await readPluginInventory(this.ctx)).entries.map(entry => [entry.entryId as string, entry]))
    const loaded = new Map([...this.ctx.loader.entries()].map(entry => [entry.options.id, entry.id]))
    const statuses = this.ctx.get('mcpStatus')
    return rows.map((row) => {
      const live = inventory.get(loaded.get(row.id) ?? '')
      const name = this.serverNameOf(row, owned.get(row.id))
      const status = name === '' ? undefined : statuses?.get(name)
      const base = {
        id: row.id as McpEntryId,
        enabled: live?.enabled ?? row.disabled !== true,
        fiberPhase: live?.fiberPhase ?? null,
        ...status === undefined ? {} : { status },
      }
      const mine = owned.get(row.id)
      if (mine?.spec !== undefined) {
        const reason = mine.spec.transport === 'streamable-http' && hasEmbeddedCredentials(mine.spec.url)
          ? 'embedded-credentials' as const : undefined
        return {
          ...base, serverName: mine.spec.serverName, transport: mine.spec.transport, owned: true,
          defaultActive: mine.spec.defaultActive ?? true,
          summary: mine.spec.transport === 'stdio' ? commandLine(mine.spec) : displayUrl(mine.spec.url),
          ...reason === undefined ? { spec: redact(mine.spec) } : { readOnlyReason: reason },
        }
      }
      const config = (row.config ?? {}) as Record<string, unknown>
      const text = (value: unknown): string => typeof value === 'string' ? value : ''
      const transport = config.transport === 'streamable-http' ? 'streamable-http' as const : 'stdio' as const
      return {
        ...base, serverName: text(config.serverName), transport, owned: mine !== undefined,
        defaultActive: config.defaultActive !== false,
        summary: transport === 'stdio' ? text(config.command) : displayUrl(text(config.url)),
        readOnlyReason: (mine === undefined ? 'unaddressable' : 'custom-expression') satisfies McpReadOnlyReason,
      }
    })
  }

  /** The server name a composed row configures, from the profile file when the row is owned. */
  private serverNameOf(row: EntryOptions, mine: OwnedRow | undefined): string {
    if (mine?.serverName !== undefined) return mine.serverName
    const name = (row.config as Record<string, unknown> | undefined)?.serverName
    return typeof name === 'string' ? name : ''
  }

  /**
   * Add an MCP server row, or replace the row `options.id` names. A stdio server runs a
   * command with the Host's privileges, so adding or changing one requires the caller to
   * echo the command line it showed the person.
   * @param spec - configuration to write; secrets are environment variable references.
   * @param options - row to replace and the confirmed command line.
   * @returns the persisted change and whether the running profile applied it.
   */
  @Remote
  upsert(spec: McpServerSpec, options?: McpUpsertOptions): Promise<McpChangeResult> {
    const target = options?.id ?? `${ROW_ID_PREFIX}${spec.serverName}`
    return this.change(target, async () => {
      if (!SERVER_NAME.test(spec.serverName)) {
        throw new ChangeRefused({ code: 'invalid-config', message: 'The server name must be 1-32 letters, digits, "_" or "-"' })
      }
      const refusal = await validateSpec(spec)
      if (refusal !== undefined) throw new ChangeRefused(refusal)
      const rows = await this.list()
      if (rows.some(row => row.id !== target && row.serverName === spec.serverName)) {
        throw new ChangeRefused({ code: 'duplicate-server', message: `A server named "${spec.serverName}" is already configured` })
      }
      if (options?.id === undefined) {
        if (flatten(composeEntries([readProfilePatches('dsh', this.profile)])).some(row => row.id === target)) {
          throw new ChangeRefused({ code: 'duplicate-server', message: `The row id "${target}" is already in use` })
        }
      } else {
        const existing = requireOwned(rows, options.id)
        if (existing.readOnlyReason !== undefined) {
          throw new ChangeRefused({ code: 'read-only', message: 'This server holds values the form cannot edit; change it in the profile patch' })
        }
      }
      if (spec.transport === 'stdio') {
        const command = commandLine(spec)
        if (options?.confirmedCommand !== command) {
          throw new ChangeRefused({ code: 'confirmation-required', message: 'Confirm the command this server will run', command })
        }
      }
      return text => upsertRow(text, target, spec)
    })
  }

  /**
   * Remove one server row from the profile patch.
   * The name is not `remove`: a Remote method may not share a name with a member of its namespace service.
   * @param id - row id returned by `list`.
   * @returns the persisted change and whether the running profile applied it.
   */
  @Remote
  removeServer(id: McpEntryId): Promise<McpChangeResult> {
    return this.change(id, async () => {
      requireOwned(await this.list(), id)
      return text => removeRow(text, id)
    })
  }

  /**
   * Enable or disable one server row the profile patch owns.
   * @param id - row id returned by `list`.
   * @param enabled - whether the row loads.
   * @returns the persisted change and whether the running profile applied it.
   */
  @Remote
  setEnabled(id: McpEntryId, enabled: boolean): Promise<McpChangeResult> {
    return this.change(id, async () => {
      requireOwned(await this.list(), id)
      return text => setRowEnabled(text, id, enabled)
    })
  }

  /**
   * Read the tools one server offers, with its connection state.
   * @param id - row id returned by `list`.
   * @returns the tools registered from the server right now; empty when it is not connected or has no client.
   */
  @Remote
  async tools(id: McpEntryId): Promise<McpToolsResult> {
    const name = (await this.list()).find(row => row.id === id)?.serverName
    const statuses = this.ctx.get('mcpStatus')
    const status = name === undefined ? undefined : statuses?.get(name)
    return { ...status === undefined ? {} : { status }, tools: name === undefined ? [] : statuses?.tools(name) ?? [] }
  }

  /**
   * Read every configured server's connection state and usage counters in one call.
   * @param sessionId - Session whose own share of the counters to include; omitted reads the totals only.
   * @returns one entry per row in composition order, with the Host clock the figures were read at.
   */
  @Remote
  async overview(sessionId?: string): Promise<McpOverview> {
    const statuses = this.ctx.get('mcpStatus')
    return {
      readAt: Date.now(),
      servers: (await this.list()).map((row) => {
        const stats = row.status === undefined ? undefined : statuses?.stats(row.serverName)
        const sessionStats = stats === undefined || sessionId === undefined ? undefined : statuses?.stats(row.serverName, sessionId)
        return {
          id: row.id, serverName: row.serverName, enabled: row.enabled, defaultActive: row.defaultActive,
          ...row.status === undefined ? {} : { status: row.status },
          ...stats === undefined ? {} : { stats },
          ...sessionStats === undefined ? {} : { sessionStats },
        }
      }),
    }
  }

  /**
   * Replace the servers one Session uses. The choice is logged on the Session and
   * takes effect on its next model request.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param active - every server name the Session uses from now on; an empty list uses none.
   * @returns the servers in use afterwards.
   * @throws when a name is not a configured server, or the profile mounts no selection service.
   */
  @Remote
  setSessionServers(agent: Agent, active: string[]): McpSessionServers {
    const selection = this.ctx.get('mcpSelection')
    if (selection === undefined) throw new Error('This profile does not support choosing MCP servers per session')
    return { active: selection.select(agent, active) }
  }

  /**
   * Ask one server's client to connect now instead of waiting out its retry delay, restarting its retry budget.
   * @param id - row id returned by `list`.
   * @returns whether a new attempt started.
   */
  @Remote
  async reconnectServer(id: McpEntryId): Promise<McpReconnectResult> {
    const name = (await this.list()).find(row => row.id === id)?.serverName
    const statuses = this.ctx.get('mcpStatus')
    return { started: name !== undefined && statuses !== undefined && await statuses.reconnect(name) }
  }

  private async readPatch(): Promise<string> {
    try {
      return await readFile(this.profile.patchPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '[]\n'
      throw error
    }
  }

  /**
   * Run one edit: check it, write the new patch text, reload, and restore the file when the reload fails.
   * `prepare` validates and returns the text transformation; the transformation throws when its row is absent.
   */
  private async change(
    target: string,
    prepare: () => Promise<(text: string) => string>,
  ): Promise<McpChangeResult> {
    const hmr = this.ctx.get('hmr')
    const run = (): Promise<McpChangeResult> => withFileLock(join(this.profile.dir, 'package.json'), async () => {
      const result: McpChangeResult = { changed: false, application: hmr === undefined ? 'restart-required' : 'applied', target }
      const path = this.profile.patchPath
      let before = '[]\n'
      try {
        before = await this.readPatch()
        try {
          readOwnedRows(before)
        } catch (error) {
          throw new ChangeRefused({ code: 'unreadable-patch', message: messageOf(error) })
        }
        const edit = await prepare()
        let after: string
        try {
          after = edit(before)
        } catch (error) {
          throw new ChangeRefused({ code: 'invalid-config', message: messageOf(error) })
        }
        if (after === before) return result
        const previous = readProfilePatches('dsh', this.profile)
        await writeFileAtomic(path, after, { mode: 0o600 })
        result.changed = true
        if (hmr !== undefined) {
          try {
            result.warnings = await reconcileProfilePatches(this.ctx.root, readProfilePatches('dsh', this.profile), 'dsh', [target])
          } catch (error) {
            await writeFileAtomic(path, before, { mode: 0o600 })
            await reconcileProfilePatches(this.ctx.root, previous, 'dsh')
            result.changed = false
            throw error
          }
        }
      } catch (error) {
        result.application = 'failed'
        result.error = error instanceof ChangeRefused
          ? error.detail
          : { code: 'operation-error', message: messageOf(error) }
      }
      this.ctx.emit('plugin-manager/changed', { reason: 'plugin' })
      return result
    })
    return hmr === undefined ? run() : hmr.runExclusive(run)
  }
}

export type { OwnedRow }
export default McpServersController
