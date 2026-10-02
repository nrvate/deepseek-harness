/**
 * Validation and redaction of MCP server specs received over the wire.
 * @module
 */
import { SENSITIVE_ENV_PATTERN } from '@deepseek-ai/dsh-subprocess'
import type { McpError, McpServerSpec, McpValue } from './types.ts'

/** Header names whose literal values are credentials. */
const SENSITIVE_HEADER_PATTERN = /authorization|cookie|token|key|secret|password/i

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** URL query parameter and command-line option names whose values are credentials. */
const SENSITIVE_PARAMETER_PATTERN = /token|key|secret|passw|auth|credential|signature/i

/** A command-line option, with the value it carries after `=`. */
const OPTION = /^--?([A-Za-z0-9_.-]+)(?:=(.*))?$/s

/** What a credential in a displayed command line is replaced by. */
const MASK = '***'

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
 * Whether a URL embeds a credential: a user name, a password, or a query parameter with a credential-shaped name.
 * @param url - configured endpoint; text that is not a URL has none.
 * @returns true when the URL carries one.
 */
export function hasEmbeddedCredentials(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.username !== '' || parsed.password !== ''
      || [...parsed.searchParams.keys()].some(name => SENSITIVE_PARAMETER_PATTERN.test(name))
  } catch (_error) {
    return false
  }
}

/**
 * Find the command-line arguments that carry a credential: an option with a credential-shaped name
 * and its value, either after `=` or as the next argument that is not itself an option.
 * @param args - the command's arguments.
 * @returns the indexes of the arguments that hold the values, each with the option that names it.
 */
export function credentialArguments(args: readonly string[]): Array<{ index: number; option: string }> {
  const found: Array<{ index: number; option: string }> = []
  args.forEach((arg, index) => {
    const option = OPTION.exec(arg)
    if (option === null || !SENSITIVE_PARAMETER_PATTERN.test(option[1] as string)) return
    if (option[2] !== undefined) found.push({ index, option: option[1] as string })
    else if (index + 1 < args.length && !(args[index + 1] as string).startsWith('-')) found.push({ index: index + 1, option: option[1] as string })
  })
  return found
}

/**
 * The command line shown next to a row, with every credential argument value masked.
 * @param spec - the command and its arguments.
 * @returns the executable and arguments, space separated.
 */
export function maskedCommandLine(spec: { command: string; args: string[] }): string {
  const hidden = new Map(credentialArguments(spec.args).map(({ index }) => [index, true]))
  const args = spec.args.map((arg, index) => {
    if (!hidden.has(index)) return arg
    const option = OPTION.exec(arg)
    return option?.[2] === undefined ? MASK : `${arg.slice(0, arg.length - option[2].length)}${MASK}`
  })
  return [spec.command, ...args].join(' ')
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
    return {
      code: 'literal-secret',
      message: 'The URL must not contain a user name, a password, or a credential in its query; use a header that references an environment variable',
    }
  }
  const argument = spec.transport === 'stdio' ? credentialArguments(spec.args)[0] : undefined
  if (argument !== undefined) {
    return {
      code: 'literal-secret',
      message: `The argument "${argument.option}" looks like it carries a credential; pass it in an environment variable that references the harness environment`,
    }
  }
  const strings = (map: Record<string, McpValue>): Record<string, string> => Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key, value.kind === 'literal' ? value.value : 'x']),
  )
  const common = {
    serverName: spec.serverName,
    ...spec.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: spec.toolCallTimeoutMs },
    ...spec.failOnStartupError === undefined ? {} : { failOnStartupError: spec.failOnStartupError },
    ...spec.defaultActive === undefined ? {} : { defaultActive: spec.defaultActive },
    ...spec.toolPolicy === undefined ? {} : { toolPolicy: spec.toolPolicy },
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
