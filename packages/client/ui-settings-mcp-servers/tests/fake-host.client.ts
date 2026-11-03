/**
 * A scripted Host for the page, the status item, and the selector: Settings
 * namespaces with a profile base and a user layer merged as Settings merges
 * them, a credentials store, the MCP manager's `watch` stream under test
 * control, and the fork's `mcpServers` Remote.
 */
import { Context } from '@deepseek-ai/cordis'
import { vi } from 'vitest'
import { stubConfigForm, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  McpManagedServerStatus, McpManagedServerView, McpServerStats, McpServerUsage, McpToolInfo, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { McpFleet } from '../src/client/fleet.ts'
import type { McpUiSettings } from '../src/mcp-ui-settings.ts'

type Json = { [key: string]: JsonValue }

function isObject(value: JsonValue | undefined): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Plain objects merge recursively; every other value replaces, as Settings layers do. */
function merge(under: JsonValue | undefined, over: JsonValue | undefined): JsonValue | undefined {
  if (over === undefined) return under
  if (!isObject(under) || !isObject(over)) return over
  const out: Json = { ...under }
  for (const [key, value] of Object.entries(over)) out[key] = merge(out[key], value) ?? null
  return out
}

function edit(section: Json, op: SettingsPathOpView): Json {
  const [head, ...rest] = op.path
  if (head === undefined) return section
  const out: Json = { ...section }
  if (rest.length === 0) {
    if (op.op === 'set') out[head] = op.value
    else Reflect.deleteProperty(out, head)
    return out
  }
  const child = out[head]
  out[head] = edit(isObject(child) ? child : {}, { ...op, path: rest })
  return out
}

/** One Settings namespace: its profile base and its user section. */
interface Namespace {
  base: Json
  user: Json | undefined
  revision: number
}

/** A successful Remote answer. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

/** A refused Remote answer. */
export function refused(message: string, code = 'gateway/bad-request'): { ok: false; error: Error & { code: string } } {
  return { ok: false, error: Object.assign(new Error(message), { code }) }
}

/** Usage counters with every figure zero unless given. */
export function stats(rest: Partial<McpServerStats> = {}): McpServerStats {
  return { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalMs: 0, maxMs: 0, connections: 1, schemaTokens: 0, transport: 'stdio', tools: [], ...rest }
}

/** A connected status with `toolCount` tools. */
export function connected(toolCount = 1, connectedAt = 1_000): McpManagedServerStatus {
  return { state: 'connected', toolCount, connectedAt }
}

/** A running client's usage. */
export function usage(serverName: string, rest: Partial<McpServerUsage> = {}): McpServerUsage {
  return { serverName, defaultActive: true, stats: stats(), ...rest }
}

/** A live view for the manager's list. */
export function view(name: string, status: McpManagedServerStatus = connected(), configured = true): McpManagedServerView {
  return { name, configured, status }
}

/** What the fake Host starts with. */
export interface HostSeed {
  /** Profile-base `servers` of the manager entry. */
  base?: Json
  /** User-layer `servers` of the manager entry. */
  user?: Json
  /** User-layer `servers` of the policy store. */
  policies?: Json
  /** User-layer `defaultActive` of the selection plugin. */
  defaults?: Json
  /** Whether Settings accepts writes. */
  writable?: boolean
  /** Whether the profile mounts the manager. */
  manager?: boolean
  /** Credentials that hold a value. */
  stored?: string[]
  /** The tools `mcpServers.tools` reports. */
  tools?: McpToolInfo[]
  /** Usage `mcpServers.overview` reports. */
  overview?: McpServerUsage[]
}

/**
 * Build the scripted Host on a fresh Context.
 * @param seed - the Settings, credentials, tools, and usage the Host starts with.
 * @returns the Context, the Remote fakes, the fleet, and a way to publish the manager's list.
 */
export function fakeHost(seed: HostSeed = {}) {
  const ctx = new Context()
  const namespaces = new Map<string, Namespace>([
    ['mcp-policy', { base: { servers: {} }, user: seed.policies === undefined ? undefined : { servers: seed.policies }, revision: 1 }],
    ['mcp-selection', { base: { defaultActive: {} }, user: seed.defaults === undefined ? undefined : { defaultActive: seed.defaults }, revision: 1 }],
  ])
  if (seed.manager !== false) {
    namespaces.set('mcp-manager', { base: { servers: seed.base ?? {} }, user: seed.user === undefined ? undefined : { servers: seed.user }, revision: 1 })
  }
  const viewOf = (ns: string, entry: Namespace): SettingsNamespaceView => ({
    autoGenerate: false, ns, schema: null, applies: 'live', secrets: [], revision: entry.revision,
    value: merge(entry.base, entry.user) ?? {}, base: entry.base, ...entry.user === undefined ? {} : { user: entry.user },
  })
  const settings = {
    describe: vi.fn(() => Promise.resolve(ok({
      writable: seed.writable !== false, hasDocument: true,
      namespaces: [...namespaces].map(([ns, entry]) => viewOf(ns, entry)),
    }))),
    mutate: vi.fn((ns: string, ops: SettingsPathOpView[], revision: number | undefined) => {
      const entry = namespaces.get(ns)
      if (entry === undefined) return Promise.resolve(refused(`no namespace ${ns}`))
      if (revision !== undefined && revision !== entry.revision) return Promise.resolve(refused('stale', 'settings/conflict'))
      let user = entry.user ?? {}
      for (const op of ops) user = edit(user, op)
      entry.user = user
      entry.revision += 1
      return Promise.resolve(ok(viewOf(ns, entry)))
    }),
  }
  const stored = new Set(seed.stored ?? [])
  const credentials = {
    describe: vi.fn((refs: string[]) => Promise.resolve(ok(Object.fromEntries(
      refs.map(ref => [ref, { configured: stored.has(ref), writable: true }]),
    )))),
    set: vi.fn((ref: string, _value: string) => {
      stored.add(ref)
      return Promise.resolve(ok(undefined))
    }),
    unset: vi.fn((ref: string) => {
      stored.delete(ref)
      return Promise.resolve(ok(undefined))
    }),
  }
  // The manager's list stream: each `publish` delivers one list to every open watch.
  const listeners = new Set<(views: McpManagedServerView[]) => void>()
  let latest: McpManagedServerView[] | undefined
  const mcpManager = {
    watch: vi.fn((signal: AbortSignal) => ({
      async* [Symbol.asyncIterator]() {
        const queue: McpManagedServerView[][] = latest === undefined ? [] : [latest]
        let wake: (() => void) | undefined
        const listener = (views: McpManagedServerView[]): void => {
          queue.push(views)
          wake?.()
        }
        listeners.add(listener)
        signal.addEventListener('abort', () => { wake?.() })
        try {
          while (!signal.aborted) {
            const next = queue.shift()
            if (next !== undefined) {
              yield next
              continue
            }
            await new Promise<void>((resolve) => { wake = resolve })
            wake = undefined
          }
        } finally {
          listeners.delete(listener)
        }
      },
    })),
    restart: vi.fn((_name: string) => Promise.resolve(ok(undefined))),
    probe: vi.fn((_name: string, _signal?: AbortSignal) => Promise.resolve(ok({
      ok: true as const, serverInfo: { name: 'files-server', version: '1.2.0' }, toolNames: ['echo', 'search'], truncated: false, durationMs: 42,
      closeConfirmed: true,
    }))),
  }
  const mcpServers = {
    tools: vi.fn((_name: string) => Promise.resolve(ok({ tools: seed.tools ?? [] }))),
    overview: vi.fn((_sessionId?: string) => Promise.resolve(ok({ readAt: 10_000_000, servers: seed.overview ?? [] }))),
    setSessionServers: vi.fn((_sessionId: string, active: string[]) => Promise.resolve(ok({ active }))),
    allowTool: vi.fn((_publicName: string) => Promise.resolve(ok({ ok: true as const, serverName: 'files', tool: 'echo' }))),
  }
  const remote = new TestRemote(ctx, { settings, credentials, mcpManager, mcpServers })
  const form = stubConfigForm<McpUiSettings>()
  form.publish({ value: { statusItem: true }, writable: true })
  const fleet = new McpFleet(ctx)
  const selectPanel = vi.fn()
  ctx.provide('layout', { selectPanel })
  return {
    ctx, remote, settings, credentials, mcpManager, mcpServers, form, fleet, selectPanel, stored,
    /** The user section of one namespace, as the last write left it. */
    user: (ns: string): Json | undefined => namespaces.get(ns)?.user,
    /** Deliver one list from the manager to every open watch. */
    publish: (views: McpManagedServerView[]): void => {
      latest = views
      for (const listener of [...listeners]) listener(views)
    },
  }
}
