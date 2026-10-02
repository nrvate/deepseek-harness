/**
 * The selection through the real agent loop: a scripted model, the real tool
 * registry, session log, and projection. Each case asserts what a model
 * request carried, and that a hidden tool is refused when called.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import McpStatus, { type McpServerHandle } from '@deepseek-ai/dsh-mcp-status'
import McpSelection, { mcpServersProjectionDefinition } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** A stand-in MCP client: tools on the registry and a handle in the status service, as the real client registers them. */
function connect(ctx: Context, server: string, tools: string[], defaultActive = true): () => void {
  const names = tools.map(tool => `mcp__${server}__${tool}`)
  const handle: McpServerHandle = {
    defaultActive,
    status: () => ({ serverName: server, state: 'connected', attempt: 0, maxAttempts: 10, toolCount: names.length }),
    tools: () => names.map((publicName, index) => ({ name: tools[index] ?? '', publicName, description: '', parameters: [] })),
    stats: () => ({ calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalMs: 0, maxMs: 0, connections: 1, schemaTokens: 0, transport: 'stdio', tools: [] }),
    reconnect: () => Promise.resolve(false),
    subscribe: () => () => {},
  }
  const disposers = [
    ...names.map(name => ctx.tools.register(defineContentToolFixture({
      name, description: `tool of ${server}`, parameters: {}, execute: () => Promise.resolve([{ type: 'text', text: `ran ${name}` }]),
    }))),
    ctx.mcpStatus.register(server, handle),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(McpStatus)
  await ctx.plugin(McpSelection)
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'read', description: 'a tool no MCP server owns', parameters: {}, execute: () => Promise.resolve([{ type: 'text', text: 'ran read' }]),
  }))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

async function turn(ctx: Context, agent: Agent, text = 'go'): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
}

function events<T extends SessionEvent['type']>(agent: Agent, type: T): Extract<SessionEvent, { type: T }>[] {
  return agent.session.snapshotEvents().filter(event => event.type === type) as Extract<SessionEvent, { type: T }>[]
}

/** Tool names of the most recent request the model received. */
function lastRequestTools(adapter: MockAdapter): string[] {
  return (adapter.requests.at(-1)?.tools ?? []).map(tool => tool.name).sort()
}

const create = (ctx: Context, id: string): Promise<Agent> => ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })

describe('configured defaults', () => {
  it('gives a Session that selected nothing the servers that are on by default, and logs no selection', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    connect(ctx, 'alpha', ['search'])
    connect(ctx, 'beta', ['fetch'], false)
    const agent = await create(ctx, 'defaults')

    expect(ctx.mcpSelection.logged(agent.session)).toBeUndefined()
    expect(ctx.mcpSelection.active(agent.session)).toEqual(['alpha'])
    await turn(ctx, agent)

    expect(lastRequestTools(adapter)).toEqual(['mcp__alpha__search', 'read'])
    expect(events(agent, 'mcp/servers')).toEqual([])
    expect(ctx.sessionProjections.stateOf(agent.session, 'mcpServers')).toEqual({ active: null })
  })

  it('follows a server that connects later, while the Session has logged no selection', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    const agent = await create(ctx, 'late-default')
    await turn(ctx, agent)
    expect(lastRequestTools(adapter)).toEqual(['read'])

    connect(ctx, 'alpha', ['search'])
    connect(ctx, 'beta', ['fetch'], false)
    await turn(ctx, agent)
    expect(lastRequestTools(adapter)).toEqual(['mcp__alpha__search', 'read'])
  })

  it('leaves a caller with no agent unrestricted', async () => {
    const ctx = await harness(new MockAdapter([]))
    connect(ctx, 'beta', ['fetch'], false)
    expect(ctx.mcpSelection.isActive('beta', undefined)).toBe(true)
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('mcp__beta__fetch')
  })
})

describe('a logged selection', () => {
  it('replaces the defaults, is logged whole, and changes the next request', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    connect(ctx, 'alpha', ['search'])
    connect(ctx, 'beta', ['fetch'], false)
    const agent = await create(ctx, 'select')
    await turn(ctx, agent)

    expect(ctx.mcpSelection.select(agent, ['beta'])).toEqual(['beta'])
    expect(events(agent, 'mcp/servers').map(event => event.data)).toEqual([{ active: ['beta'] }])
    expect(ctx.mcpSelection.logged(agent.session)).toEqual(['beta'])
    expect(ctx.mcpSelection.isActive('alpha', agent)).toBe(false)
    expect(ctx.mcpSelection.isActive('beta', agent)).toBe(true)

    await turn(ctx, agent)
    expect(lastRequestTools(adapter)).toEqual(['mcp__beta__fetch', 'read'])
    // The loop's own record of the changed tool set: a header whose reason is the change.
    const headers = events(agent, 'request/header')
    expect(headers.at(-1)?.data.reason).toBe('change')
    expect(headers.at(-1)?.data.header.tools?.map(tool => tool.name).sort()).toEqual(['mcp__beta__fetch', 'read'])
  })

  it('orders the selection as the servers are configured and drops duplicates', async () => {
    const ctx = await harness(new MockAdapter([]))
    connect(ctx, 'alpha', ['search'], false)
    connect(ctx, 'beta', ['fetch'], false)
    const agent = await create(ctx, 'order')
    expect(ctx.mcpSelection.select(agent, ['beta', 'alpha', 'beta'])).toEqual(['alpha', 'beta'])
    expect(events(agent, 'mcp/servers').at(-1)?.data).toEqual({ active: ['alpha', 'beta'] })
  })

  it('logs nothing when the request names the servers already in use', async () => {
    const ctx = await harness(new MockAdapter([]))
    connect(ctx, 'alpha', ['search'])
    const agent = await create(ctx, 'same')
    expect(ctx.mcpSelection.select(agent, ['alpha'])).toEqual(['alpha'])
    expect(events(agent, 'mcp/servers')).toEqual([])
  })

  it('refuses a server that is not configured and logs nothing', async () => {
    const ctx = await harness(new MockAdapter([]))
    connect(ctx, 'alpha', ['search'])
    const agent = await create(ctx, 'unknown')
    expect(() => ctx.mcpSelection.select(agent, ['alpha', 'ghost'])).toThrow('MCP server "ghost" is not configured')
    expect(events(agent, 'mcp/servers')).toEqual([])
  })

  it('does not pick up a server configured after the Session selected', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    connect(ctx, 'alpha', ['search'])
    const agent = await create(ctx, 'pinned')
    ctx.mcpSelection.select(agent, [])
    connect(ctx, 'gamma', ['late'])
    await turn(ctx, agent)
    expect(ctx.mcpSelection.active(agent.session)).toEqual([])
    expect(lastRequestTools(adapter)).toEqual(['read'])
  })

  it('ignores a selected server that is no longer configured', async () => {
    const ctx = await harness(new MockAdapter([]))
    connect(ctx, 'alpha', ['search'])
    const disconnect = connect(ctx, 'beta', ['fetch'])
    const agent = await create(ctx, 'stale')
    ctx.mcpSelection.select(agent, ['beta'])
    disconnect()
    expect(ctx.mcpSelection.logged(agent.session)).toEqual(['beta'])
    expect(ctx.mcpSelection.active(agent.session)).toEqual([])
  })

  it('belongs to one Session only', async () => {
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    const ctx = await harness(adapter)
    connect(ctx, 'alpha', ['search'])
    const first = await create(ctx, 'first')
    const second = await create(ctx, 'second')
    ctx.mcpSelection.select(first, [])

    await turn(ctx, first)
    expect(lastRequestTools(adapter)).toEqual(['read'])
    await turn(ctx, second)
    expect(lastRequestTools(adapter)).toEqual(['mcp__alpha__search', 'read'])
  })
})

describe('enforcement', () => {
  it('refuses a call to a tool of an inactive server instead of running it', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'mcp__alpha__search', {}),
      textResponse('done'),
    ])
    const ctx = await harness(adapter)
    connect(ctx, 'alpha', ['search'])
    const agent = await create(ctx, 'refuse')
    ctx.mcpSelection.select(agent, [])
    await turn(ctx, agent)

    const result = events(agent, 'tool/result').at(-1)
    expect(result?.data.message.isError).toBe(true)
    expect(JSON.stringify(result?.data.message.content)).not.toContain('ran mcp__alpha__search')
    expect(JSON.stringify(result?.data.message.content)).toContain('unknown tool')
  })

  it('runs the same call once the server is active again', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'mcp__alpha__search', {}),
      textResponse('done'),
    ])
    const ctx = await harness(adapter)
    connect(ctx, 'alpha', ['search'])
    const agent = await create(ctx, 'allow')
    ctx.mcpSelection.select(agent, [])
    ctx.mcpSelection.select(agent, ['alpha'])
    await turn(ctx, agent)

    const result = events(agent, 'tool/result').at(-1)
    expect(result?.data.message.isError).toBe(false)
    expect(JSON.stringify(result?.data.message.content)).toContain('ran mcp__alpha__search')
  })

  it('hides a tool an inactive server adds after the Session started', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    connect(ctx, 'beta', ['fetch'], false)
    const agent = await create(ctx, 'resync')
    // The server re-syncs with one more tool: the status handle and the registry both gain it.
    connect(ctx, 'beta2', ['later'], false)
    await turn(ctx, agent)
    expect(lastRequestTools(adapter)).toEqual(['read'])
    expect(ctx.tools.get('mcp__beta2__later', agent)).toBeUndefined()
  })

  it('hides shared MCP tools from a Session that uses no server, and returns them with the first server', async () => {
    const ctx = await harness(new MockAdapter([]))
    connect(ctx, 'alpha', ['search'])
    ctx.tools.register(defineContentToolFixture({
      name: 'list_mcp_resources', description: 'shared', parameters: {}, execute: () => Promise.resolve([{ type: 'text', text: 'listed' }]),
    }))
    const stop = ctx.mcpSelection.hideWhenNone(['list_mcp_resources'])
    const agent = await create(ctx, 'shared')
    const visible = (): string[] => ctx.tools.schemas(agent).map(tool => tool.name).sort()

    expect(visible()).toEqual(['list_mcp_resources', 'mcp__alpha__search', 'read'])
    ctx.mcpSelection.select(agent, [])
    expect(visible()).toEqual(['read'])
    ctx.mcpSelection.select(agent, ['alpha'])
    expect(visible()).toEqual(['list_mcp_resources', 'mcp__alpha__search', 'read'])

    ctx.mcpSelection.select(agent, [])
    stop()
    expect(visible()).toEqual(['list_mcp_resources', 'read'])
  })

  it('lifts its restriction when the agent is disposed', async () => {
    const ctx = await harness(new MockAdapter([]))
    connect(ctx, 'alpha', ['search'])
    const handle = await ctx.agents.create({ sessionId: SessionId('dispose'), agentOptions: { provider: 'mock', model: 'mock' } })
    const { agent } = handle
    ctx.mcpSelection.select(agent, [])
    expect(ctx.tools.get('mcp__alpha__search', agent)).toBeUndefined()
    await handle.dispose()
    // A registry change after disposal must not touch the departed agent.
    expect(() => connect(ctx, 'omega', ['extra'], false)).not.toThrow()
  })
})

describe('the mcpServers projection', () => {
  it('starts with no selection, takes the last logged one whole, and sends its state as the client view', () => {
    const { init, apply, wire } = mcpServersProjectionDefinition
    // Events as a real Session log records them.
    const session = Session.create(SessionId('projection'), [])
    session.append('mcp/servers', { active: ['alpha'] })
    session.append('mcp/servers', { active: [] })
    const logged = session.snapshotEvents()
    const [first, second] = logged.filter(event => event.type === 'mcp/servers')
    const other = logged.find(event => event.type !== 'mcp/servers')
    const empty = init()
    expect(empty).toEqual({ active: null })
    const selected = apply(empty, first!)
    expect(selected).toEqual({ active: ['alpha'] })
    expect(apply(selected, second!)).toEqual({ active: [] })
    // Any other event leaves the state object untouched.
    expect(apply(selected, other!)).toBe(selected)
    expect(wire.view(selected)).toBe(selected)
  })
})
