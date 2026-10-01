/** Wire specs are checked the way the plugin checks them at load, and secrets never leave the Host. */
import { expect, it } from 'vitest'
import { displayUrl, hasEmbeddedCredentials, messageOf, redact, validateSpec } from '../src/spec.ts'
import type { McpHttpSpec, McpStdioSpec } from '../src/types.ts'

const stdio: McpStdioSpec = { transport: 'stdio', serverName: 'srv', command: 'echo', args: [], env: {} }
const http: McpHttpSpec = { transport: 'streamable-http', serverName: 'srv', url: 'https://example.test/mcp', headers: {} }

it('accepts specs the plugin accepts', async () => {
  expect(await validateSpec(stdio)).toBeUndefined()
  expect(await validateSpec({ ...http, headers: { Authorization: { kind: 'env', name: 'TOKEN', scheme: 'Bearer' } } })).toBeUndefined()
})

it.each([
  ['an unparsable URL', { ...http, url: 'not a url' }],
  ['a non-http URL', { ...http, url: 'file:///tmp/x' }],
  ['an empty command', { ...stdio, command: ' ' }],
  ['a zero timeout', { ...stdio, toolCallTimeoutMs: 0 }],
  ['an oversized timeout', { ...stdio, toolCallTimeoutMs: 2 ** 31 }],
  ['an empty variable name', { ...stdio, env: { '': { kind: 'literal', value: 'x' } } }],
  ['a malformed variable reference', { ...stdio, env: { A: { kind: 'env', name: 'a b' } } }],
] as const)('rejects %s as an invalid config', async (_label, spec) => {
  expect(await validateSpec(spec as never)).toMatchObject({ code: 'invalid-config' })
})

it('refuses a literal credential and tells the person what to do', async () => {
  const refusal = await validateSpec({ ...stdio, env: { GITHUB_TOKEN: { kind: 'literal', value: 'ghp_x' } } })
  expect(refusal).toMatchObject({ code: 'literal-secret' })
  expect(refusal?.message).toContain('environment variable')
  expect(await validateSpec({ ...http, headers: { Authorization: { kind: 'literal', value: 'Bearer x' } } }))
    .toMatchObject({ code: 'literal-secret' })
  expect(await validateSpec({ ...http, headers: { 'X-Api-Key': { kind: 'literal', value: 'k' } } }))
    .toMatchObject({ code: 'literal-secret' })
})

it('accepts ordinary literals and empty credential placeholders', async () => {
  expect(await validateSpec({ ...stdio, env: { LOG_LEVEL: { kind: 'literal', value: 'debug' }, API_TOKEN: { kind: 'literal', value: '' } } })).toBeUndefined()
  expect(await validateSpec({ ...http, headers: { 'X-Team': { kind: 'literal', value: 'core' } } })).toBeUndefined()
})

it('refuses a URL with embedded credentials', async () => {
  expect(await validateSpec({ ...http, url: 'https://user:pw@example.test/mcp' })).toMatchObject({ code: 'literal-secret' })
})

it('replaces stored literal secrets with kept and nothing else', () => {
  const read = redact({
    ...stdio,
    env: { API_TOKEN: { kind: 'literal', value: 'secret' }, LOG: { kind: 'literal', value: 'x' }, REF: { kind: 'env', name: 'REF' } },
  })
  expect(read).toMatchObject({ env: { API_TOKEN: { kind: 'kept' }, LOG: { kind: 'literal', value: 'x' }, REF: { kind: 'env', name: 'REF' } } })
  expect(JSON.stringify(read)).not.toContain('secret')
  const header = redact({ ...http, headers: { Authorization: { kind: 'literal', value: 'Bearer abc' } } })
  expect(JSON.stringify(header)).not.toContain('abc')
})

it('displays a URL without credentials, query, or a trailing root slash', () => {
  expect(displayUrl('https://u:p@example.test/mcp?token=abc')).toBe('https://example.test/mcp')
  expect(displayUrl('https://example.test/')).toBe('https://example.test')
  expect(displayUrl('garbage')).toBe('garbage')
  expect(hasEmbeddedCredentials('https://u@example.test')).toBe(true)
  expect(hasEmbeddedCredentials('https://example.test')).toBe(false)
  expect(hasEmbeddedCredentials('garbage')).toBe(false)
})

it('accepts a startup flag', async () => {
  expect(await validateSpec({ ...stdio, failOnStartupError: true })).toBeUndefined()
})

it('reads the message of any thrown value', () => {
  expect(messageOf(new Error('boom'))).toBe('boom')
  expect(messageOf('plain')).toBe('plain')
})
