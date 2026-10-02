/**
 * Tests for the connection state and tool list the supervisor publishes to
 * `mcpStatus`, and for its reconnect-now action. Isolated file so vi.mock of
 * the MCP SDK doesn't pollute other test suites.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import McpStatus from '@deepseek-ai/dsh-mcp-status'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

// ---- Mock MCP SDK ----

// vi.mock factories are hoisted above every import/const, so the mock fns and
// class must be created inside vi.hoisted to exist when the factories run.
const { mockConnect, mockClose, mockListTools, mockCallTool, MockClient, instances } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>) => Promise<unknown>>()
  const mockCallTool = vi.fn<(
    _params?: Record<string, unknown>, _options?: unknown,
  ) => Promise<unknown>>()
  class MockClient {
    transport: object | undefined = {}
    onclose: (() => void) | undefined
    connect = mockConnect
    close = mockClose
    getServerCapabilities = () => ({ tools: {} })
    getInstructions(): string | undefined { return undefined }
    getServerVersion(): { name: string; version: string } | undefined { return { name: 'mock-server', version: '1.2.3' } }
    getNegotiatedProtocolVersion(): string | undefined { return '2026-07-28' }
    listResources = async () => ({ resources: [] })
    listTools = mockListTools
    callTool = mockCallTool
    constructor(_info: unknown, options: { listChanged: { tools: { onChanged: () => void } } }) {
      instances.push(this)
      void options
    }
  }
  const instances: MockClient[] = []
  return { mockConnect, mockClose, mockListTools, mockCallTool, MockClient, instances }
})

vi.mock('@modelcontextprotocol/client', async importOriginal => ({
  ...await importOriginal<typeof import('@modelcontextprotocol/client')>(),
  Client: MockClient,
  StreamableHTTPClientTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: vi.fn(function () { return { close: () => Promise.resolve() } }),
}))

// vi.mock is hoisted above static imports, so the modules under test see the
// mocked SDK even through a static import.
import { apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import { resolveReconnectPolicy, startConnection } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'

// ---- Helpers ----

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** Capture the supervisor's logger lines by level on one context. */
function captureLogs(ctx: Context): { warns: string[]; errors: string[]; infos: string[] } {
  const warns: string[] = []
  const errors: string[] = []
  const infos: string[] = []
  ctx.logger.warn = ((message: unknown) => { warns.push(String(message)) }) as typeof ctx.logger.warn
  ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
  ctx.logger.info = ((message: unknown) => { infos.push(String(message)) }) as typeof ctx.logger.info
  return { warns, errors, infos }
}

function stdioConfig(reconnect?: Config['reconnect']): Config {
  return {
    transport: 'stdio',
    serverName: 'srv',
    command: 'echo',
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
    ...reconnect === undefined ? {} : { reconnect },
  }
}

/** The tool list the mock server advertises after a successful (re)connect. */
function listing(...names: string[]): { tools: { name: string; inputSchema: { type: string } }[]; nextCursor: undefined } {
  return {
    tools: names.map(name => ({ name, inputSchema: { type: 'object' } })),
    nextCursor: undefined,
  }
}

// ---- Tests ----

/** Wait until the published state matches. */
async function reaches(read: () => string, state: string): Promise<void> {
  await vi.waitFor(() => { expect(read()).toBe(state) }, { timeout: 2000 })
}

describe('published connection status', () => {
  let ctx: Context

  beforeEach(async () => {
    vi.clearAllMocks()
    instances.length = 0
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockResolvedValue(listing('remote'))
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    ctx = await mountRegistry()
    await ctx.plugin(McpStatus)
  })

  function start(reconnect?: Config['reconnect']) {
    captureLogs(ctx)
    const handle = startConnection(ctx, stdioConfig(reconnect), resolveReconnectPolicy(reconnect, 'status'))
    return { handle, status: () => handle.handle.status() }
  }

  it('reports a connected server with its tools and no error', async () => {
    mockListTools.mockResolvedValue({
      tools: [{
        name: 'search',
        description: 'Search things',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to find' },
            limit: { type: ['integer', 'null'] },
            mode: { enum: ['a', 'b'] },
            bare: 'not a schema',
            multi: { type: [5] },
          },
          required: ['query'],
        },
      }, { name: 'plain', inputSchema: { type: 'object', properties: 'oops', required: 'oops' } }],
      nextCursor: undefined,
    })
    const { handle, status } = start()
    await handle.ready
    expect(status()).toMatchObject({ serverName: 'srv', state: 'connected', attempt: 0, maxAttempts: 10, toolCount: 2 })
    expect(status().error).toBeUndefined()
    expect(typeof status().connectedAt).toBe('number')
    expect(handle.handle.tools()).toEqual([
      {
        name: 'search', publicName: 'mcp__srv__search', description: 'Search things',
        parameters: [
          { name: 'query', type: 'string', required: true, description: 'What to find' },
          { name: 'limit', type: 'integer|null', required: false, description: '' },
          { name: 'mode', type: 'any', required: false, description: '' },
          { name: 'bare', type: 'any', required: false, description: '' },
          { name: 'multi', type: 'any', required: false, description: '' },
        ],
      },
      { name: 'plain', publicName: 'mcp__srv__plain', description: '', parameters: [] },
    ])
    await handle.dispose()
  })

  it('reports a failed first attempt as reconnecting with its message, then connected once it succeeds', async () => {
    mockConnect.mockRejectedValueOnce(new Error('connection refused'))
    const { handle, status } = start({ initialDelayMs: 30, maxDelayMs: 30 })
    await handle.ready
    expect(status()).toMatchObject({ state: 'reconnecting', attempt: 1, error: 'connection refused', toolCount: 0 })
    await reaches(() => status().state, 'connected')
    expect(status().error).toBeUndefined()
    expect(status().attempt).toBe(0)
    await handle.dispose()
  })

  it('reports a thrown value that is not an Error by its text', async () => {
    mockConnect.mockRejectedValueOnce('plain refusal')
    const { handle, status } = start({ initialDelayMs: 30, maxDelayMs: 30 })
    await handle.ready
    expect(status().error).toBe('plain refusal')
    await handle.dispose()
  })

  it('reports a lost connection as reconnecting without an error, then recovers', async () => {
    const { handle, status } = start({ initialDelayMs: 20, maxDelayMs: 20 })
    await handle.ready
    instances[0]?.onclose?.()
    expect(status()).toMatchObject({ state: 'reconnecting', attempt: 1 })
    expect(status().error).toBeUndefined()
    await reaches(() => status().state, 'connected')
    await handle.dispose()
  })

  it('stops at failed once the retry budget is spent, with no tools', async () => {
    mockConnect.mockRejectedValue(new Error('still down'))
    const { handle, status } = start({ initialDelayMs: 5, maxDelayMs: 5, maxAttempts: 2 })
    await handle.ready
    await reaches(() => status().state, 'failed')
    expect(status()).toMatchObject({ attempt: 2, maxAttempts: 2, error: 'still down', toolCount: 0 })
    await handle.dispose()
  })

  it('reports failed straight away when reconnecting is disabled', async () => {
    mockConnect.mockRejectedValue(new Error('refused'))
    const { handle, status } = start({ enabled: false })
    await handle.ready
    expect(status()).toMatchObject({ state: 'failed', error: 'refused' })
    await handle.dispose()
  })

  it('reports failed with an explanation when a failed connection cannot be closed', async () => {
    mockConnect.mockRejectedValue(new Error('refused'))
    mockClose.mockRejectedValue(new Error('stuck'))
    vi.useFakeTimers()
    try {
      const { handle, status } = start()
      const ready = handle.ready
      await vi.advanceTimersByTimeAsync(6000)
      await ready
      expect(status().state).toBe('failed')
      expect(status().error).toContain('could not be closed')
      await handle.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('connects now from failed, restarting the budget, and refuses while a connection is live or in flight', async () => {
    mockConnect.mockRejectedValue(new Error('down'))
    const { handle, status } = start({ initialDelayMs: 5, maxDelayMs: 5, maxAttempts: 1 })
    await handle.ready
    await reaches(() => status().state, 'failed')

    mockConnect.mockResolvedValue(undefined)
    expect(await handle.handle.reconnect()).toBe(true)
    expect(status().state).toBe('connecting')
    expect(await handle.handle.reconnect()).toBe(false)
    await reaches(() => status().state, 'connected')
    expect(status()).toMatchObject({ attempt: 0, toolCount: 1 })
    expect(await handle.handle.reconnect()).toBe(false)
    await handle.dispose()
  })

  it('skips a pending backoff wait when asked to connect now', async () => {
    mockConnect.mockRejectedValueOnce(new Error('down'))
    const { handle, status } = start({ initialDelayMs: 60_000, maxDelayMs: 60_000 })
    await handle.ready
    expect(status().state).toBe('reconnecting')
    expect(await handle.handle.reconnect()).toBe(true)
    await reaches(() => status().state, 'connected')
    await handle.dispose()
  })

  it('refuses to reconnect after disposal', async () => {
    mockConnect.mockRejectedValue(new Error('down'))
    const { handle } = start({ enabled: false })
    await handle.ready
    await handle.dispose()
    expect(await handle.handle.reconnect()).toBe(false)
  })

  it('tells observers about each change until they unsubscribe or the plugin is disposed', async () => {
    const { handle, status } = start({ initialDelayMs: 5, maxDelayMs: 5 })
    const seen: string[] = []
    const stop = handle.handle.subscribe(() => { seen.push(status().state) })
    await handle.ready
    expect(seen).toContain('connected')
    stop()
    seen.length = 0
    instances[0]?.onclose?.()
    await reaches(() => status().state, 'connected')
    expect(seen).toEqual([])

    const second = handle.handle.subscribe(() => { seen.push('late') })
    await handle.dispose()
    instances.at(-1)?.onclose?.()
    expect(seen).toEqual([])
    second()
  })

  it('withdraws the tools it published when the registry rejects them, and keeps reporting', async () => {
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { inner.tools.register(defineTool({ name: 'mcp__srv__remote', description: 'squatter', parameters: {}, output: { schema: { type: 'json' }, render: () => [] }, execute: () => Promise.resolve('x') })) } })
    const { handle, status } = start()
    await handle.ready
    expect(status().toolCount).toBe(0)
    expect(handle.handle.tools()).toEqual([])
    await handle.dispose()
  })

  it('registers into the shared status service when the plugin loads', async () => {
    captureLogs(ctx)
    await ctx.plugin({ inject: ['tools'], apply }, stdioConfig())
    await vi.waitFor(() => { expect(ctx.mcpStatus.get('srv')?.state).toBe('connected') })
    expect(ctx.mcpStatus.tools('srv')).toHaveLength(1)
  })

  describe('usage counters', () => {
    let seq = 0
    const call = (name: string, args: Record<string, unknown>) => ctx.tools.execute({
      name, arguments: args, callId: ToolCallId(`status-${++seq}`), signal: new AbortController().signal,
    })

    it('starts at zero with the connection facts the server reported', async () => {
      const { handle } = start()
      await handle.ready
      const stats = handle.handle.stats()
      expect(stats).toMatchObject({
        calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalMs: 0, maxMs: 0, connections: 1,
        serverInfo: { name: 'mock-server', version: '1.2.3' }, protocolVersion: '2026-07-28', transport: 'stdio', tools: [],
      })
      expect(stats.lastCallAt).toBeUndefined()
      // One tool named "remote" with an object schema: its definition is what every request carries.
      expect(stats.schemaTokens).toBe(Math.ceil(JSON.stringify({ name: 'mcp__srv__remote', description: '', parameters: { type: 'object' } }).length / 4))
      await handle.dispose()
    })

    it('counts calls, failures, latency, and estimated tokens in and out, per tool', async () => {
      mockListTools.mockResolvedValue(listing('remote', 'other'))
      const { handle } = start()
      await handle.ready
      const before = Date.now()

      mockCallTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'x'.repeat(40) }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] })
      await call('mcp__srv__remote', { query: 'abcdefgh' })
      mockCallTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'server said no' }], isError: true })
      expect((await call('mcp__srv__remote', {})).isError).toBe(true)
      mockCallTool.mockRejectedValueOnce(new Error('timed out'))
      expect((await call('mcp__srv__other', {})).isError).toBe(true)
      mockCallTool.mockResolvedValueOnce('not a result object')
      expect((await call('mcp__srv__other', {})).isError).toBe(true)
      mockCallTool.mockResolvedValueOnce({ content: 'not an array' })
      await call('mcp__srv__other', {})

      const stats = handle.handle.stats()
      expect(stats.calls).toBe(5)
      expect(stats.errors).toBe(2)
      // Arguments: {"query":"abcdefgh"} is 20 characters, and four empty objects are 2 each.
      expect(stats.inputTokens).toBe(Math.ceil((20 + 2 * 4) / 4))
      // Text only: 40 characters, then "server said no" (14); the image and malformed results add nothing.
      expect(stats.outputTokens).toBe(Math.ceil((40 + 14) / 4))
      expect(stats.totalMs).toBeGreaterThanOrEqual(stats.maxMs)
      expect(stats.maxMs).toBeGreaterThanOrEqual(0)
      expect(stats.lastCallAt).toBeGreaterThanOrEqual(before - 1)
      expect(stats.tools.map(({ name, calls, errors }) => [name, calls, errors])).toEqual([['other', 3, 1], ['remote', 2, 1]])
      await handle.dispose()
    })

    it('attributes a call to the Session that made it and keeps the server totals', async () => {
      const { handle } = start()
      await handle.ready
      const inSession = (id: string) => ctx.tools.execute({
        name: 'mcp__srv__remote', arguments: { q: 'abcd' }, callId: ToolCallId(`session-${++seq}`),
        signal: new AbortController().signal, agent: { session: { id } } as Agent,
      })
      mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'x'.repeat(8) }] })
      await inSession('one')
      await inSession('one')
      await inSession('two')
      await call('mcp__srv__remote', {})

      expect(handle.handle.stats().calls).toBe(4)
      expect(handle.handle.stats('one')).toMatchObject({ calls: 2, errors: 0, outputTokens: 4, tools: [{ name: 'remote', calls: 2 }] })
      expect(handle.handle.stats('two')).toMatchObject({ calls: 1, outputTokens: 2 })
      // A Session that never called this server reports zero usage with the same connection facts.
      expect(handle.handle.stats('idle')).toMatchObject({ calls: 0, inputTokens: 0, tools: [], connections: 1, transport: 'stdio' })
      expect(handle.handle.stats('idle').lastCallAt).toBeUndefined()
      await handle.dispose()
    })

    it('reports whether new Sessions use the server, on by default', async () => {
      const { handle } = start()
      expect(handle.handle.defaultActive).toBe(true)
      await handle.dispose()
      captureLogs(ctx)
      const off = startConnection(ctx, { ...stdioConfig(), serverName: 'off', defaultActive: false }, resolveReconnectPolicy(undefined, 'status'))
      expect(off.handle.defaultActive).toBe(false)
      await off.dispose()
    })

    it('orders tools with equal counts by name and keeps counters across a reconnect', async () => {
      mockListTools.mockResolvedValue(listing('zeta', 'alpha'))
      const { handle, status } = start({ initialDelayMs: 10, maxDelayMs: 10 })
      await handle.ready
      await call('mcp__srv__zeta', {})
      await call('mcp__srv__alpha', {})
      instances[0]?.onclose?.()
      await reaches(() => status().state, 'connected')
      const stats = handle.handle.stats()
      expect(stats.connections).toBe(2)
      expect(stats.calls).toBe(2)
      expect(stats.tools.map(tool => tool.name)).toEqual(['alpha', 'zeta'])
      await handle.dispose()
    })

    it('omits the server facts a server does not report and names the HTTP transport', async () => {
      const info = vi.spyOn(MockClient.prototype, 'getServerVersion').mockReturnValue(undefined)
      const version = vi.spyOn(MockClient.prototype, 'getNegotiatedProtocolVersion').mockReturnValue(undefined)
      try {
        captureLogs(ctx)
        const handle = startConnection(ctx, {
          transport: 'streamable-http', serverName: 'web', url: 'http://127.0.0.1:9/mcp', headers: {}, toolCallTimeoutMs: 60_000, failOnStartupError: false,
        }, resolveReconnectPolicy(undefined, 'status'))
        await handle.ready
        const stats = handle.handle.stats()
        expect(stats.serverInfo).toBeUndefined()
        expect(stats.protocolVersion).toBeUndefined()
        expect(stats.transport).toBe('streamable-http')
        await handle.dispose()
      } finally {
        info.mockRestore()
        version.mockRestore()
      }
    })

    it('reports no definition cost after the registry rejects the tools', async () => {
      await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { inner.tools.register(defineTool({ name: 'mcp__srv__remote', description: 'squatter', parameters: {}, output: { schema: { type: 'json' }, render: () => [] }, execute: () => Promise.resolve('x') })) } })
      const { handle } = start()
      await handle.ready
      expect(handle.handle.stats().schemaTokens).toBe(0)
      await handle.dispose()
    })
  })
})
