/** The tool-call policy gate, through the real tool registry and its approval routing. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { McpToolInfo } from '@deepseek-ai/dsh-mcp-status/types'
import { DEFAULT_TOOL_POLICY, registerToolPolicy, resolveToolPolicy, type McpToolPolicy } from '../src/policy.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

const info = (name: string): McpToolInfo => ({ name, publicName: `mcp__srv__${name}`, description: '', parameters: [] })

/** A registry with the server's tools `read` and `send`, an unrelated tool, and the policy gate. */
async function bench(policy: McpToolPolicy) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const ran: string[] = []
  for (const name of ['mcp__srv__read', 'mcp__srv__send', 'local']) {
    ctx.tools.register(defineTool({
      name, description: name, parameters: {}, output: { schema: { type: 'json' }, render: () => [] },
      execute: () => { ran.push(name); return Promise.resolve('done') },
    }))
  }
  await ctx.plugin({ apply: (inner: Context) => { registerToolPolicy(inner, 'srv', policy, () => [info('read'), info('send')]) } })
  let seq = 0
  const call = (name: string, agent?: Agent) => ctx.tools.execute({
    name, arguments: {}, callId: ToolCallId(`policy-${++seq}`), signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent },
  })
  return { ctx, ran, call }
}

/** An approval service that records each request and answers with `outcome`. */
function approve(ctx: Context, outcome: 'allowed-once' | 'rejected') {
  const request = vi.fn((_request: { toolName: string; reason?: string; displayReason?: { en: string } }) => Promise.resolve(outcome))
  ctx.provide('approval', { request } as never)
  return request
}

const agent = { session: { id: 'session' } } as Agent

describe('resolveToolPolicy', () => {
  it('asks before every call when nothing is configured, and keeps configured modes', () => {
    expect(resolveToolPolicy(undefined, 'srv')).toEqual(DEFAULT_TOOL_POLICY)
    expect(resolveToolPolicy({ tools: { send: 'deny' } }, 'srv')).toEqual({ default: 'ask', tools: { send: 'deny' } })
    expect(resolveToolPolicy({ default: 'allow' }, 'srv')).toEqual({ default: 'allow', tools: {} })
  })

  it('refuses a mode it does not know', () => {
    expect(() => resolveToolPolicy({ default: 'sometimes' as never }, 'mcp-client(srv)'))
      .toThrow('mcp-client(srv): toolPolicy.default must be "allow", "ask", or "deny"')
    expect(() => resolveToolPolicy({ tools: { send: 'yes' as never } }, 'mcp-client(srv)'))
      .toThrow('mcp-client(srv): toolPolicy.tools.send must be "allow", "ask", or "deny"')
  })
})

describe('the tool-call gate', () => {
  it('refuses a denied tool before it runs, with a reason the model can act on', async () => {
    const { ran, call } = await bench({ default: 'allow', tools: { send: 'deny' } })
    const refused = await call('mcp__srv__send')
    expect(refused).toMatchObject({ isError: true, error: { info: { code: 'MCP_TOOL_DENIED' } } })
    expect(JSON.stringify(refused)).toContain('the user\'s policy for MCP server \\"srv\\" does not allow the tool \\"send\\"')
    expect((await call('mcp__srv__read')).isError).toBe(false)
    expect(ran).toEqual(['mcp__srv__read'])
  })

  it('asks the person first, and runs the tool only when they allow it', async () => {
    const { ctx, ran, call } = await bench(DEFAULT_TOOL_POLICY)
    const request = approve(ctx, 'allowed-once')
    expect((await call('mcp__srv__read', agent)).isError).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      toolName: 'mcp__srv__read',
      reason: 'MCP server "srv" tool "read" requires approval by its tool policy',
      displayReason: { en: 'Allow the MCP server "srv" to run its tool "read"?' },
    })
    request.mockResolvedValue('rejected')
    expect((await call('mcp__srv__send', agent)).isError).toBe(true)
    expect(ran).toEqual(['mcp__srv__read'])
  })

  it('refuses an asking tool when no one can be asked', async () => {
    const { ran, call } = await bench(DEFAULT_TOOL_POLICY)
    expect((await call('mcp__srv__read', agent)).isError).toBe(true)
    expect(ran).toEqual([])
  })

  it('lets a per-tool mode override the default', async () => {
    const { ctx, ran, call } = await bench({ default: 'ask', tools: { read: 'allow' } })
    const request = approve(ctx, 'rejected')
    expect((await call('mcp__srv__read', agent)).isError).toBe(false)
    expect(request).not.toHaveBeenCalled()
    expect(ran).toEqual(['mcp__srv__read'])
  })

  it('does not ask in a Session that runs with full access', async () => {
    const { ctx, ran, call } = await bench(DEFAULT_TOOL_POLICY)
    const request = approve(ctx, 'rejected')
    const mode = vi.fn(() => 'danger-full-access')
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: mode() }) } as never)
    expect((await call('mcp__srv__read', agent)).isError).toBe(false)
    mode.mockReturnValue('workspace-write')
    expect((await call('mcp__srv__read', agent)).isError).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    expect(ran).toEqual(['mcp__srv__read'])
  })

  it('never relaxes a refusal from a later listener, and leaves other tools alone', async () => {
    const { ctx, ran, call } = await bench({ default: 'allow', tools: { send: 'ask' } })
    const request = approve(ctx, 'allowed-once')
    ctx.on('tools/pre-execute', (exec): Promise<PreToolDecision> => Promise.resolve(exec.name === 'local'
      ? { kind: 'allow' }
      : { kind: 'deny', reason: 'blocked by a hook' }))
    expect(JSON.stringify(await call('mcp__srv__read', agent))).toContain('blocked by a hook')
    expect(JSON.stringify(await call('mcp__srv__send', agent))).toContain('blocked by a hook')
    expect((await call('local', agent)).isError).toBe(false)
    expect(request).not.toHaveBeenCalled()
    expect(ran).toEqual(['local'])
  })
})
