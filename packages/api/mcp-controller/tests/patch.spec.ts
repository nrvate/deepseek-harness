/** Patch text edits keep comments, unmanaged keys, and the `!!js` tag. */
import { expect, it } from 'vitest'
import { commandLine, readOwnedRows, removeRow, setRowEnabled, upsertRow } from '../src/patch.ts'
import type { McpHttpSpec, McpStdioSpec } from '../src/types.ts'

const http: McpHttpSpec = {
  transport: 'streamable-http',
  serverName: 'web',
  url: 'http://localhost:3000/mcp',
  headers: { Authorization: { kind: 'env', name: 'MCP_TOKEN', scheme: 'Bearer' }, 'X-Team': { kind: 'literal', value: 'core' } },
}
const stdio: McpStdioSpec = {
  transport: 'stdio',
  serverName: 'github',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_TOKEN: { kind: 'env', name: 'GITHUB_TOKEN' } },
  toolCallTimeoutMs: 30_000,
}

it('adds a row as its own insert group and keeps comments and other rows', () => {
  const text = upsertRow('# mine\n- id: other\n  disabled: true\n', 'mcp-web', http)
  expect(text).toContain('# mine')
  expect(text).toContain('- id: other')
  expect(text).toContain('Authorization: !!js "`Bearer ${process.env.MCP_TOKEN}`"')
  expect(text).toContain('X-Team: core')
  expect(readOwnedRows(text)).toEqual([{ id: 'mcp-web', disabled: false, spec: http, serverName: 'web' }])
})

it('writes an environment reference as a !!js scalar', () => {
  const text = upsertRow('[]\n', 'mcp-github', stdio)
  expect(text).toContain('GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN')
  expect(readOwnedRows(text)[0]?.spec).toEqual(stdio)
})

it('starts from an absent file', () => {
  expect(readOwnedRows('[]\n')).toEqual([])
})

it('replaces managed keys in place and leaves keys the form does not manage', () => {
  const original = [
    '- insert:',
    '    # keep me',
    '    - id: mcp-github',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: github',
    '        transport: stdio',
    '        command: old',
    '        cwd: /work',
    '        reconnect:',
    '          maxAttempts: 3',
    '        maxInstructionBytes: 1024',
    '',
  ].join('\n')
  const text = upsertRow(original, 'mcp-github', { ...stdio, cwd: undefined })
  expect(text).toContain('# keep me')
  expect(text).toContain('maxAttempts: 3')
  expect(text).toContain('maxInstructionBytes: 1024')
  expect(text).toContain('command: npx')
  expect(text).not.toContain('cwd:')
  expect(text).not.toContain('old')
})

it('drops the other transport\'s keys when the transport changes', () => {
  const asStdio = upsertRow('[]\n', 'mcp-x', { ...stdio, serverName: 'x' })
  const asHttp = upsertRow(asStdio, 'mcp-x', { ...http, serverName: 'x' })
  expect(asHttp).not.toContain('command')
  expect(asHttp).not.toContain('GITHUB_TOKEN')
  expect(readOwnedRows(asHttp)[0]?.spec?.transport).toBe('streamable-http')
})

it('keeps an existing expression only when the same source comes back', () => {
  const original = '- insert:\n    - id: mcp-a\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: a\n        transport: stdio\n        command: tool\n        env:\n          HOME_DIR: !!js process.cwd()\n'
  const row = readOwnedRows(original)[0]
  expect(row?.spec).toMatchObject({ env: { HOME_DIR: { kind: 'expression', source: 'process.cwd()' } } })
  const kept = upsertRow(original, 'mcp-a', row?.spec as McpStdioSpec)
  expect(kept).toContain('HOME_DIR: !!js process.cwd()')
  const forged = { ...row?.spec as McpStdioSpec, env: { HOME_DIR: { kind: 'expression', source: 'process.exit(1)' } } } as McpStdioSpec
  expect(() => upsertRow(original, 'mcp-a', forged)).toThrow('an expression can only be kept')
  expect(() => upsertRow('[]\n', 'mcp-b', { ...stdio, env: { X: { kind: 'expression', source: 'process.cwd()' } } })).toThrow('an expression can only be kept')
})

it('keeps a stored literal for a kept value and refuses one that is not stored', () => {
  const original = '- insert:\n    - id: mcp-a\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: a\n        transport: stdio\n        command: tool\n        env:\n          API_TOKEN: stored\n'
  const kept = upsertRow(original, 'mcp-a', { ...stdio, serverName: 'a', command: 'tool', args: [], env: { API_TOKEN: { kind: 'kept' } } })
  expect(kept).toContain('API_TOKEN: stored')
  expect(() => upsertRow(original, 'mcp-a', { ...stdio, serverName: 'a', env: { OTHER_TOKEN: { kind: 'kept' } } })).toThrow('no stored value')
})

it('rejects an environment name that could carry code', () => {
  expect(() => upsertRow('[]\n', 'mcp-a', { ...stdio, env: { X: { kind: 'env', name: 'A}`;process.exit(1);`' } } })).toThrow('not an environment variable name')
})

it('reads rows holding values the form cannot represent without a spec', () => {
  const text = '- insert:\n    - id: mcp-a\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: a\n        transport: stdio\n        command: tool\n        cwd: !!js process.cwd()\n    - id: mcp-b\n      name: "@deepseek-ai/dsh-mcp-client"\n      config: !!js ({})\n    - id: notmcp\n      name: other\n'
  expect(readOwnedRows(text)).toEqual([
    { id: 'mcp-a', disabled: false, serverName: 'a' },
    { id: 'mcp-b', disabled: false },
  ])
})

it.each([
  ['a non-string URL', 'transport: streamable-http\n        url: 5'],
  ['a non-string header', 'transport: streamable-http\n        url: http://h\n        headers:\n          A: 5'],
  ['a non-sequence args', 'transport: stdio\n        command: c\n        args: x'],
  ['an expression argument', 'transport: stdio\n        command: c\n        args:\n          - !!js process.cwd()'],
  ['a numeric argument', 'transport: stdio\n        command: c\n        args: [1]'],
  ['a non-map env', 'transport: stdio\n        command: c\n        env: x'],
  ['a non-number timeout', 'transport: stdio\n        command: c\n        toolCallTimeoutMs: soon'],
  ['a non-boolean startup flag', 'transport: stdio\n        command: c\n        failOnStartupError: maybe'],
  ['an unknown transport', 'transport: carrier-pigeon'],
])('reads %s as not editable', (_label, config) => {
  const text = `- insert:\n    - id: mcp-a\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: a\n        ${config}\n`
  expect(readOwnedRows(text)[0]).toEqual({ id: 'mcp-a', disabled: false, serverName: 'a' })
})

it('reads timeouts and startup flags', () => {
  const text = upsertRow('[]\n', 'mcp-a', { ...stdio, serverName: 'a', failOnStartupError: true })
  expect(readOwnedRows(text)[0]?.spec).toMatchObject({ toolCallTimeoutMs: 30_000, failOnStartupError: true })
})

it('enables and disables a row on the row itself', () => {
  const added = upsertRow('[]\n', 'mcp-web', http)
  const off = setRowEnabled(added, 'mcp-web', false)
  expect(readOwnedRows(off)[0]).toMatchObject({ id: 'mcp-web', disabled: true })
  expect(readOwnedRows(setRowEnabled(off, 'mcp-web', true))[0]?.disabled).toBe(false)
  expect(() => setRowEnabled(added, 'missing', true)).toThrow('no MCP server row')
})

it('removes a row and the insert group that held only it', () => {
  const both = upsertRow(upsertRow('# c\n- id: other\n  disabled: true\n', 'mcp-web', http), 'mcp-github', stdio)
  const one = removeRow(both, 'mcp-web')
  expect(readOwnedRows(one).map(row => row.id)).toEqual(['mcp-github'])
  expect(one).toContain('# c')
  expect(removeRow(one, 'mcp-github')).not.toContain('insert')
  expect(() => removeRow(one, 'missing')).toThrow('no MCP server row')
})

it('removes one row from a shared insert group and keeps the others', () => {
  const text = '- insert:\n    - id: keep\n      name: other\n    - id: mcp-a\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: a\n        transport: stdio\n        command: c\n'
  const after = removeRow(text, 'mcp-a')
  expect(after).toContain('id: keep')
  expect(after).toContain('insert')
  expect(after).not.toContain('mcp-a')
})

it('does not overwrite a malformed patch', () => {
  expect(() => upsertRow('{ not: a sequence }\n', 'mcp-a', http)).toThrow('YAML sequence')
  expect(() => readOwnedRows('[')).toThrow()
})

it('formats the command a person approves', () => {
  expect(commandLine(stdio)).toBe('npx -y @modelcontextprotocol/server-github')
})

it('writes and clears a working directory', () => {
  const withCwd = upsertRow('[]\n', 'mcp-a', { ...stdio, serverName: 'a', cwd: '/work' })
  expect(withCwd).toContain('cwd: /work')
  expect(readOwnedRows(withCwd)[0]?.spec).toMatchObject({ cwd: '/work' })
  expect(upsertRow(withCwd, 'mcp-a', { ...stdio, serverName: 'a', cwd: '' })).not.toContain('cwd')
})

it('rewrites the headers of an HTTP row and keeps an expression header it already holds', () => {
  const first = upsertRow('[]\n', 'mcp-a', { ...http, serverName: 'a' })
  const second = upsertRow(first, 'mcp-a', { ...http, serverName: 'a', headers: { 'X-Team': { kind: 'literal', value: 'infra' } } })
  expect(second).toContain('X-Team: infra')
  expect(second).not.toContain('Authorization')
})

it('adds a config to a row that has none', () => {
  const text = '- insert:\n    - id: mcp-a\n      name: "@deepseek-ai/dsh-mcp-client"\n'
  expect(readOwnedRows(text)).toEqual([{ id: 'mcp-a', disabled: false }])
  expect(readOwnedRows(upsertRow(text, 'mcp-a', { ...stdio, serverName: 'a' }))[0]?.spec).toMatchObject({ serverName: 'a' })
})

it('reads a row without a server name as not editable', () => {
  const text = '- insert:\n    - id: mcp-a\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        transport: stdio\n        command: c\n'
  expect(readOwnedRows(text)).toEqual([{ id: 'mcp-a', disabled: false }])
})

it('skips patch items that are not maps', () => {
  expect(readOwnedRows('- just text\n- insert:\n    - id: mcp-a\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: a\n        transport: stdio\n        command: c\n')).toHaveLength(1)
})
