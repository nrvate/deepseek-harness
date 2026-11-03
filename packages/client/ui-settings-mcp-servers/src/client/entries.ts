/**
 * The MCP manager's server entries as the page reads them from Settings, and
 * the `env` and `headers` values the form edits. Settings values arrive as
 * JSON, so every field is read defensively; fields the form does not edit are
 * carried through a save unchanged.
 */
import type { McpToolMode, McpToolPolicy } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Settings namespace of the MCP manager: its Loader row id in the shipped profiles. */
export const MANAGER_NS = 'mcp-manager'
/** Settings namespace of the MCP tool-call policy store. */
export const POLICY_NS = 'mcp-policy'
/** Settings namespace of the per-Session MCP server selection. */
export const SELECTION_NS = 'mcp-selection'

/** Server names the manager accepts as `servers` keys. */
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/
/** Credential references the credentials provider accepts. */
export const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One configured server entry, read from the manager's resolved Settings value. */
export interface McpEntry {
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  url: string
  headers: Record<string, string>
  enabled: boolean
  toolCallTimeoutMs?: number
  /** The entry as stored, so a save keeps the fields the form does not edit. */
  raw: Record<string, JsonValue>
}

/**
 * Whether a Settings value is a JSON object.
 * @param value - a value from a Settings view.
 * @returns true for a non-array object.
 */
export function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: JsonValue | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(value)) return out
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') out[key] = item
  return out
}

/**
 * Read one map field of a namespace value.
 * @param value - a Settings namespace value, base, or user section.
 * @param field - the map field, such as `servers`.
 * @returns the field's entries, empty when the section or the field is absent.
 */
export function mapField(value: JsonValue | undefined, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) return {}
  const map = value[field]
  return isRecord(map) ? map : {}
}

/**
 * Read one server entry.
 * @param value - the entry's JSON value.
 * @returns the entry, or undefined when it names no known transport.
 */
export function parseEntry(value: JsonValue): McpEntry | undefined {
  if (!isRecord(value)) return undefined
  const transport = value.transport
  if (transport !== 'stdio' && transport !== 'streamable-http') return undefined
  const text = (field: string): string => typeof value[field] === 'string' ? value[field] : ''
  const args = Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === 'string') : []
  return {
    transport, command: text('command'), args, env: strings(value.env), cwd: text('cwd'), url: text('url'),
    headers: strings(value.headers), enabled: value.enabled !== false,
    ...typeof value.toolCallTimeoutMs === 'number' ? { toolCallTimeoutMs: value.toolCallTimeoutMs } : {},
    raw: value,
  }
}

function isMode(value: JsonValue | undefined): value is McpToolMode {
  return value === 'ask' || value === 'allow' || value === 'deny'
}

/**
 * Read one server's tool-call policy from the policy store's `servers` map.
 * @param value - the stored policy, or undefined when the store holds none.
 * @returns the policy; a missing one asks before every call.
 */
export function parsePolicy(value: JsonValue | undefined): McpToolPolicy {
  if (!isRecord(value)) return { default: 'ask', tools: {} }
  const tools: Record<string, McpToolMode> = {}
  for (const [tool, mode] of Object.entries(mapField(value, 'tools'))) if (isMode(mode)) tools[tool] = mode
  return { default: isMode(value.default) ? value.default : 'ask', tools }
}

/** How a staged `env` or `headers` value is written. */
export type ValueMode = 'literal' | 'credential' | 'bearer'

/** One staged `env` or `headers` entry. */
export interface ValueDraft {
  /** Stable identity while the entry is edited; the name can change under it. */
  readonly uid: number
  key: string
  mode: ValueMode
  /** The text for `literal`; the credential reference for `credential` and `bearer`. */
  text: string
  /** A secret typed for a credential reference, stored in the credentials provider on save; never written to the entry. */
  secret: string
}

const WHOLE_CREDENTIAL = /^\$\{credential:([A-Za-z_][A-Za-z0-9_]*)\}$/
const BEARER_CREDENTIAL = /^Bearer \$\{credential:([A-Za-z_][A-Za-z0-9_]*)\}$/

/**
 * Stage one stored value for the form.
 * @param uid - the entry's identity.
 * @param key - the variable or header name.
 * @param value - the stored text, possibly a credential template.
 * @returns the staged entry.
 */
export function draftValue(uid: number, key: string, value: string): ValueDraft {
  const whole = WHOLE_CREDENTIAL.exec(value)
  if (whole !== null) return { uid, key, mode: 'credential', text: whole[1] ?? '', secret: '' }
  const bearer = BEARER_CREDENTIAL.exec(value)
  if (bearer !== null) return { uid, key, mode: 'bearer', text: bearer[1] ?? '', secret: '' }
  return { uid, key, mode: 'literal', text: value, secret: '' }
}

/**
 * The text one staged value stores.
 * @param entry - the staged value.
 * @returns the literal text, or the credential template.
 */
export function storedValue(entry: ValueDraft): string {
  switch (entry.mode) {
    case 'literal': return entry.text
    case 'credential': return `\${credential:${entry.text.trim()}}`
    case 'bearer': return `Bearer \${credential:${entry.text.trim()}}`
  }
}

/**
 * Suggest a credential reference for a value that does not name one yet.
 * @param server - the server's name.
 * @param key - the variable or header name.
 * @returns an upper-case reference such as `MCP_GITHUB_TOKEN`.
 */
export function suggestRef(server: string, key: string): string {
  const ref = `MCP_${server}_${key}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  return CREDENTIAL_REF.test(ref) ? ref : 'MCP_SECRET'
}

/**
 * Show a command line as a person would type it, quoting arguments that need it.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the command line.
 */
export function commandLine(command: string, args: readonly string[]): string {
  const quote = (part: string): string => /^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replaceAll('\'', '\'\\\'\'')}'`
  return [command, ...args].map(quote).join(' ')
}

/**
 * One line that describes an entry in the server list.
 * @param entry - the server entry.
 * @returns the command line or the URL.
 */
export function entrySummary(entry: McpEntry): string {
  return entry.transport === 'stdio' ? commandLine(entry.command, entry.args) : entry.url
}
