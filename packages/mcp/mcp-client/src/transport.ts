/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process with an allow-listed
 * environment; Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * Ambient names a stdio server inherits. Everything else in the harness
 * environment stays out of a third-party server unless its `env` names it:
 * a name-pattern scrub alone passes credentials under names such as
 * `DATABASE_URL` or `GH_PAT`. Names are compared case-insensitively because
 * Windows environment names are.
 */
const INHERITED_ENV_NAMES = new Set([
  // Identity, shell, and executable lookup.
  'HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER',
  // Their Windows counterparts.
  'APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'PROGRAMDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'SYSTEMDRIVE', 'SYSTEMROOT', 'USERNAME', 'USERPROFILE', 'WINDIR',
  // Locale, time zone, and scratch directories.
  'LANG', 'LANGUAGE', 'TZ', 'TEMP', 'TMP', 'TMPDIR',
  // Per-user directories that package runners such as npx and uvx cache under.
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'XDG_STATE_HOME',
  // Network routing and trust roots, so a server reaches the network the way the harness does.
  'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_DIR', 'SSL_CERT_FILE',
])

/** Locale categories (`LC_ALL`, `LC_CTYPE`, ...) are inherited as a family. */
const INHERITED_ENV_PREFIX = 'LC_'

/**
 * Build a stdio server's environment: the allow-listed names of the subprocess
 * seam's scrubbed parent env, then the spec's explicit `env`. The scrubbed env
 * supplies the proxy names a child Node needs; a value that begins with `()`
 * is a shell function export and is never inherited.
 * @param extra - the configured `env`, which wins over every inherited name.
 * @returns a fresh environment for the server process.
 */
export function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(scrubbedParentEnv())) {
    const key = name.toUpperCase()
    if ((INHERITED_ENV_NAMES.has(key) || key.startsWith(INHERITED_ENV_PREFIX)) && !value.startsWith('()')) env[name] = value
  }
  return { ...env, ...extra }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } },
      )
  }
}
