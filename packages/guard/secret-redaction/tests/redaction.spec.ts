/** Redaction of tool results, through the real tool registry. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type PostToolDecision } from '@deepseek-ai/dsh-tools'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import * as Redaction from '../src/index.ts'
import { environmentSecrets, redactBlocks, redactText, TOKEN_PATTERNS } from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

const GITHUB = `ghp_${'a'.repeat(36)}`
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

describe('environmentSecrets', () => {
  it('collects credential-shaped and listed names, and URL passwords, above the minimum length', () => {
    const found = environmentSecrets({
      DEEPSEEK_API_KEY: 'sk-live-value',
      DATABASE_URL: 'postgres://app:hunter2hunter@db/prod',
      GH_PAT: 'pat-value-1',
      CUSTOM_THING: 'custom-value',
      SHORT_TOKEN: 'abc',
      HOME: '/home/u',
      PROXY: 'http://user:proxy-pass-1@proxy:8080',
      MISSING: undefined,
    }, ['custom_thing'], 8)
    expect(found).toEqual([
      { value: 'sk-live-value', label: 'DEEPSEEK_API_KEY' },
      { value: 'postgres://app:hunter2hunter@db/prod', label: 'DATABASE_URL' },
      { value: 'hunter2hunter', label: 'DATABASE_URL password' },
      { value: 'pat-value-1', label: 'GH_PAT' },
      { value: 'custom-value', label: 'CUSTOM_THING' },
      { value: 'proxy-pass-1', label: 'PROXY password' },
    ])
  })
})

describe('redactText', () => {
  it('replaces known values longest first, and leaves text without secrets as the same string', () => {
    const secrets = [{ value: 'abcd1234', label: 'SHORT' }, { value: 'xxabcd1234xx', label: 'LONG' }]
    expect(redactText('a xxabcd1234xx b abcd1234', secrets, false)).toBe('a [redacted: LONG] b [redacted: SHORT]')
    const plain = 'nothing here'
    expect(redactText(plain, secrets, true)).toBe(plain)
  })

  it.each([
    ['private key', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----'],
    ['GitHub token', GITHUB],
    ['GitHub token', `github_pat_${'b'.repeat(60)}`],
    ['GitLab token', `glpat-${'c'.repeat(20)}`],
    ['Slack token', 'xoxb-1234567890-abcdef'],
    ['AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
    ['Google API key', `AIza${'d'.repeat(35)}`],
    ['npm token', `npm_${'e'.repeat(36)}`],
    ['API key', 'sk-proj-abcdefghijklmnopqrstuvwx'],
  ])('redacts a %s by its format', (label, token) => {
    expect(redactText(`before ${token} after`, [], true)).toBe(`before [redacted: ${label}] after`)
    expect(redactText(token, [], false)).toBe(token)
  })

  it('redacts an AWS secret key only where a credentials file names it', () => {
    expect(redactText(`aws_secret_access_key = ${AWS_SECRET}`, [], true)).toBe('aws_secret_access_key = [redacted: AWS secret key]')
    expect(redactText(AWS_SECRET, [], true)).toBe(AWS_SECRET)
    expect(TOKEN_PATTERNS.length).toBe(9)
  })
})

describe('redactBlocks', () => {
  it('rewrites only text blocks, and reports no change as undefined', () => {
    const image = { type: 'image' as const, data: 'x', mimeType: 'image/png' }
    const blocks = [{ type: 'text' as const, text: `key ${GITHUB}` }, image] as never
    const out = redactBlocks(blocks, text => redactText(text, [], true))
    expect(out).toEqual([{ type: 'text', text: 'key [redacted: GitHub token]' }, image])
    expect(redactBlocks([{ type: 'text', text: 'fine' }] as never, text => text)).toBeUndefined()
  })
})

/** A registry with tools that print what they are given, the guard, and an optional stub credential provider. */
async function bench(config: Partial<Redaction.Config> = {}, provider?: object) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (provider !== undefined) ctx.provide('credentials', provider as never)
  ctx.tools.register(defineTool({
    name: 'echo', description: 'echo', parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: (args: { text: string }) => Promise.resolve(args.text),
  }))
  ctx.tools.register(defineTool({
    name: 'fail', description: 'fail', parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: () => [] },
    execute: (args: { text: string }) => Promise.reject(new Error(args.text)),
  }))
  await ctx.plugin(Redaction, Redaction.Config(config))
  let seq = 0
  const call = async (name: string, text: string): Promise<string> => {
    const result = await ctx.tools.execute({ name, arguments: { text }, callId: ToolCallId(`r-${++seq}`), signal: new AbortController().signal })
    return result.content.map(block => block.type === 'text' ? block.text : '').join('')
  }
  return { ctx, call }
}

describe('the post-execute guard', () => {
  it('redacts environment secrets and token formats in results and errors', async () => {
    process.env.REDACTION_TEST_TOKEN = 'env-secret-value-1'
    try {
      const { call } = await bench()
      expect(await call('echo', `token env-secret-value-1 and ${GITHUB}`)).toBe('token [redacted: REDACTION_TEST_TOKEN] and [redacted: GitHub token]')
      expect(await call('fail', 'leaked env-secret-value-1')).toContain('[redacted: REDACTION_TEST_TOKEN]')
      expect(await call('echo', 'ordinary output')).toBe('ordinary output')
    } finally {
      Reflect.deleteProperty(process.env, 'REDACTION_TEST_TOKEN')
    }
  })

  it('redacts what the credential provider holds, read on each call', async () => {
    const records = new Map<string, unknown>([
      ['llm/openai', { kind: 'api-key', key: 'stored-api-key-1', env: { AWS_PROFILE: 'stored-profile-1' } }],
      ['account/deepseek', { kind: 'grant', payload: { access: 'grant-token-value-1', nested: ['grant-refresh-1', 7] } }],
      ['llm/empty', undefined],
      ['llm/ambient', { kind: 'api-key', env: { AWS_REGION: 'us-east-1-region' } }],
    ])
    const provider = {
      resolve: (ref: string) => Promise.resolve(ref === 'DEEPSEEK_API_KEY' ? { value: 'resolved-ref-value', source: 'file' } : undefined),
      listRecords: () => Promise.resolve([...records.keys()].map((key) => {
        const [scope, id] = key.split('/') as [string, string]
        return { key: credentialKey(scope, id), kind: 'api-key' }
      })),
      readRecord: (key: string) => Promise.resolve(records.get(key)),
    }
    const { call } = await bench({ credentialRefs: ['DEEPSEEK_API_KEY', 'OTHER_KEY'] }, provider)
    expect(await call('echo', 'resolved-ref-value stored-api-key-1 stored-profile-1 grant-token-value-1 grant-refresh-1 us-east-1-region')).toBe([
      '[redacted: DEEPSEEK_API_KEY]', '[redacted: llm/openai]', '[redacted: llm/openai AWS_PROFILE]',
      '[redacted: account/deepseek]', '[redacted: account/deepseek]', '[redacted: llm/ambient AWS_REGION]',
    ].join(' '))
    records.set('llm/new', { kind: 'api-key', key: 'added-later-key' })
    expect(await call('echo', 'added-later-key')).toBe('[redacted: llm/new]')
  })

  it('leaves everything when every source is off', async () => {
    process.env.REDACTION_TEST_TOKEN = 'env-secret-value-1'
    try {
      const { call } = await bench({ environment: false, credentials: false, patterns: false })
      expect(await call('echo', `env-secret-value-1 ${GITHUB}`)).toBe(`env-secret-value-1 ${GITHUB}`)
    } finally {
      Reflect.deleteProperty(process.env, 'REDACTION_TEST_TOKEN')
    }
  })

  it('redacts a replacement or a block from an inner listener, and leaves a replaced value to the registry', async () => {
    const { ctx, call } = await bench()
    let decision: PostToolDecision = { kind: 'accept', content: [{ type: 'text', text: `preview ${GITHUB}` }] }
    ctx.on('tools/post-execute', () => Promise.resolve(decision))
    expect(await call('echo', 'ignored')).toBe('preview [redacted: GitHub token]')
    decision = { kind: 'block', feedback: [{ type: 'text', text: `blocked ${GITHUB}` }] }
    expect(await call('echo', 'ignored')).toBe('blocked [redacted: GitHub token]')
    decision = { kind: 'block', feedback: [{ type: 'text', text: 'blocked plainly' }] }
    expect(await call('echo', 'ignored')).toBe('blocked plainly')
    decision = { kind: 'accept', value: 'replaced value' }
    expect(await call('echo', 'ignored')).toBe('replaced value')
    // Context another listener attaches survives the redaction.
    decision = { kind: 'accept', content: [{ type: 'text', text: GITHUB }], additionalContexts: [createUserMessage({ content: [{ type: 'text', text: 'note' }], source: { kind: 'user' } })] }
    const result = await ctx.tools.execute({ name: 'echo', arguments: { text: 'x' }, callId: ToolCallId('r-context'), signal: new AbortController().signal })
    expect(result.content).toEqual([{ type: 'text', text: '[redacted: GitHub token]' }])
    expect(result.additionalContexts).toHaveLength(1)
  })

  it('refuses a credential reference that is not a reference name at load', async () => {
    await expect(bench({ credentialRefs: ['not a ref'] })).rejects.toThrow('credential ref "not a ref"')
  })
})
