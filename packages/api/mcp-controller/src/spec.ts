/**
 * Validation and redaction of MCP server specs received over the wire.
 * @module
 */
import { SENSITIVE_ENV_PATTERN } from '@deepseek-ai/dsh-subprocess'
import type { McpError, McpServerSpec, McpValue } from './types.ts'

/** Header names whose literal values are credentials. */
const SENSITIVE_HEADER_PATTERN = /authorization|cookie|token|key|secret|password/i

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Whether a literal value under this key would store a credential in the patch file.
 * @param spec - the server the key belongs to; its transport selects the name pattern.
 * @param key - the `env` or header name.
 * @returns true for a credential-shaped name.
 */
export function isSecretKey(spec: McpServerSpec, key: string): boolean {
  return (spec.transport === 'stdio' ? SENSITIVE_ENV_PATTERN : SENSITIVE_HEADER_PATTERN).test(key)
}

/**
 * The `env` or `headers` map of a spec.
 * @param spec - server configuration.
 * @returns `env` for a local command, `headers` for an HTTP endpoint.
 */
export function valueMap(spec: McpServerSpec): Record<string, McpValue> {
  return spec.transport === 'stdio' ? spec.env : spec.headers
}

/**
 * Replace stored literal secrets with `kept` so no response carries them.
 * @param spec - configuration read from the patch file.
 * @returns a copy safe to return to a client.
 */
export function redact(spec: McpServerSpec): McpServerSpec {
  const values = Object.fromEntries(Object.entries(valueMap(spec)).map(([key, value]) => [
    key, value.kind === 'literal' && isSecretKey(spec, key) ? { kind: 'kept' } as const : value,
  ]))
  return spec.transport === 'stdio' ? { ...spec, env: values } : { ...spec, headers: values }
}

/**
 * The URL without user name, password, or query, for display next to a row.
 * @param url - configured endpoint; text that is not a URL is returned as written.
 * @returns the origin and path.
 */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch (_error) {
    return url
  }
}

/**
 * Whether a URL embeds a user name or password.
 * @param url - configured endpoint; text that is not a URL has none.
 * @returns true when a user name or password is present.
 */
export function hasEmbeddedCredentials(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.username !== '' || parsed.password !== ''
  } catch (_error) {
    return false
  }
}

/**
 * The message of a thrown value.
 * @param error - caught value; plugin and YAML failures are Errors, a string may come from a provider.
 * @returns its text.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function invalid(message: string): McpError {
  return { code: 'invalid-config', message }
}

/**
 * Check a spec the way the plugin will when it loads: the credential rules of this
 * form, the plugin's Config schema, and its load-time checks.
 * @param spec - configuration received from a client.
 * @param env - the environment the Loader evaluates `process.env` references against.
 * @returns the first failure, or undefined when the plugin would accept the spec.
 */
export async function validateSpec(spec: McpServerSpec, env: NodeJS.ProcessEnv = process.env): Promise<McpError | undefined> {
  const values = valueMap(spec)
  for (const [key, value] of Object.entries(values)) {
    if (key.trim() === '') return invalid('A name must not be empty')
    if (value.kind === 'env' && !ENV_NAME.test(value.name)) {
      return invalid(`"${value.name}" is not an environment variable name`)
    }
    // An unset variable makes the plugin refuse its config (env) or send "Bearer undefined" (headers).
    if (value.kind === 'env' && env[value.name] === undefined) {
      return invalid(`The environment variable "${value.name}" is not set in the harness environment`)
    }
    if (value.kind === 'literal' && value.value !== '' && isSecretKey(spec, key)) {
      return { code: 'literal-secret', message: `"${key}" looks like a credential; reference an environment variable instead of typing the value` }
    }
  }
  if (spec.transport === 'streamable-http' && hasEmbeddedCredentials(spec.url)) {
    return { code: 'literal-secret', message: 'The URL must not contain a user name or password; use a header that references an environment variable' }
  }
  const strings = (map: Record<string, McpValue>): Record<string, string> => Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key, value.kind === 'literal' ? value.value : 'x']),
  )
  const common = {
    serverName: spec.serverName,
    ...spec.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: spec.toolCallTimeoutMs },
    ...spec.failOnStartupError === undefined ? {} : { failOnStartupError: spec.failOnStartupError },
  }
  const raw = spec.transport === 'stdio'
    ? { transport: spec.transport, command: spec.command, args: spec.args, env: strings(spec.env), cwd: spec.cwd ?? '', ...common }
    : { transport: spec.transport, url: spec.url, headers: strings(spec.headers), ...common }
  try {
    const { Config, validateServerConfig } = await import('@deepseek-ai/dsh-mcp-client')
    const config = Config(raw)
    validateServerConfig(config, `mcp-client(${spec.serverName})`)
  } catch (error) {
    return invalid(messageOf(error))
  }
  return undefined
}
