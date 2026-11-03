/**
 * Tests for the tool list and usage counters an MCP client publishes to
 * `mcpStatus`. Isolated file so vi.mock of the MCP SDK doesn't pollute other
 * test suites.
 */
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { describe, expect, it, vi, beforeEach, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Transport } from '@modelcontextprotocol/client'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import McpStatus from '@deepseek-ai/dsh-mcp-status'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

const { mockConnect, mockClose, mockListTools, mockCallTool, MockClient, instances } = vi.hoisted(() => {
  const mockConnect = vi.fn<(_options?: { signal?: AbortSignal }) => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>, _options?: { signal?: AbortSignal }) => Promise<unknown>>()
  const mockSetNotificationHandler = vi.fn()
  const mockCallTool = vi.fn<(_params?: Record<string, unknown>, _options?: unknown) => Promise<unknown>>()
  class MockClient {
    transport: Transport | undefined
    onclose: (() => void) | undefined
    async connect(transport: Transport, options?: { signal?: AbortSignal }): Promise<void> {
      this.transport = transport
      const onclose = transport.onclose
      transport.onclose = () => { onclose?.(); this.onclose?.() }
      await transport.start()
      await mockConnect.call(this, options)
    }
    ping = (): Promise<void> => Promise.resolve()
    close = mockClose
    getServerCapabilities = () => ({ tools: {} })
    getInstructions(): string | undefined { return undefined }
    getServerVersion(): { name: string; version: string } | undefined { return { name: 'mock-server', version: '1.2.3' } }
    getNegotiatedProtocolVersion(): string | undefined { return '2026-07-28' }
    callTool = mockCallTool
    listResources = async () => ({ resources: [] })
    listTools = mockListTools
    constructor(_info: unknown, options: { listChanged: { tools: { onChanged: () => void } } }) {
      instances.push(this)
      mockSetNotificationHandler('notifications/tools/list_changed', options.listChanged.tools.onChanged)
    }
  }
  const instances: MockClient[] = []
  return { mockConnect, mockClose, mockListTools, mockCallTool, mockSetNotificationHandler, MockClient, instances }
})

vi.mock('@modelcontextprotocol/client', async importOriginal => ({
  ...await importOriginal<typeof import('@modelcontextprotocol/client')>(),
  Client: MockClient,
  StreamableHTTPClientTransport: vi.fn(function () {
    return {
      onclose: undefined as (() => void) | undefined,
      start: () => Promise.resolve(),
      send: () => Promise.resolve(),
      close() { this.onclose?.(); return Promise.resolve() },
    }
  }),
}))
vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: vi.fn(function () {
    return {
      onclose: undefined as (() => void) | undefined,
      start: () => Promise.resolve(),
      send: () => Promise.resolve(),
      close() { this.onclose?.(); return Promise.resolve() },
    }
  }),
}))

import { Config as ConfigSchema, apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import { resolveReconnectPolicy, startConnection } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'
import { McpStatusCell } from '@deepseek-ai/dsh-mcp-client/src/status.ts'

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function quiet(ctx: Context): string[] {
  const warns: string[] = []
  ctx.logger.warn = ((message: unknown) => { warns.push(String(message)) }) as typeof ctx.logger.warn
  ctx.logger.error = (() => {}) as typeof ctx.logger.error
  return warns
}

function stdioConfig(overrides?: Partial<Extract<Config, { transport: 'stdio' }>>): Config {
  return ConfigSchema({
    transport: 'stdio',
    serverName: 'srv',
    command: 'echo',
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    startupTimeoutMs: 30_000,
    failOnStartupError: false,
    ...overrides,
  })
}

function listing(...names: string[]): { tools: { name: string; inputSchema: { type: string } }[]; nextCursor: undefined } {
  return { tools: names.map(name => ({ name, inputSchema: { type: 'object' } })), nextCursor: undefined }
}

describe('published tools and usage', () => {
  let ctx: Context

  beforeEach(async () => {
    vi.clearAllMocks()
    instances.length = 0
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { transport?: Transport }) {
      this.transport?.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockResolvedValue(listing('remote'))
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    ctx = await mountRegistry()
    await ctx.plugin(McpStatus)
  })

  function start(reconnect?: Config['reconnect']) {
    quiet(ctx)
    const cell = new McpStatusCell(() => {})
    const handle = startConnection(ctx, stdioConfig(reconnect === undefined ? {} : { reconnect }), resolveReconnectPolicy(reconnect, 'usage'), cell)
    return { handle, status: () => cell.current() }
  }

  it('describes each registered tool and its parameters', async () => {
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
    expect(status()).toMatchObject({ state: 'connected', toolCount: 2 })
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

  it('withdraws the tools it published when the registry rejects them, and keeps reporting', async () => {
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { inner.tools.register(defineTool({ name: 'mcp__srv__remote', description: 'squatter', parameters: {}, output: { schema: { type: 'json' }, render: () => [] }, execute: () => Promise.resolve('x') })) } })
    const { handle } = start()
    await handle.ready
    expect(handle.handle.tools()).toEqual([])
    await handle.dispose()
  })

  it('registers into the shared status service when the plugin loads', async () => {
    quiet(ctx)
    await ctx.plugin({ inject: ['tools'], apply }, stdioConfig())
    await vi.waitFor(() => { expect(ctx.mcpStatus.tools('srv')).toHaveLength(1) })
    expect(ctx.mcpStatus.servers()).toEqual([{ serverName: 'srv', defaultActive: true }])
  })

  describe('usage counters', () => {
    let seq = 0
    const call = (name: string, args: Record<string, unknown>) => executeToolFixture(ctx, {
      name, arguments: args, callId: ToolCallId(`usage-${++seq}`), signal: new AbortController().signal,
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
      const inSession = (id: string) => executeToolFixture(ctx, {
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
      quiet(ctx)
      const off = startConnection(ctx, stdioConfig({ serverName: 'off', defaultActive: false }), resolveReconnectPolicy(undefined, 'usage'), new McpStatusCell(() => {}))
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
      await vi.waitFor(() => { expect(handle.handle.stats().connections).toBe(2) }, { timeout: 2000 })
      expect(status().state).toBe('connected')
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
        quiet(ctx)
        const handle = startConnection(ctx, ConfigSchema({
          transport: 'streamable-http', serverName: 'web', url: 'http://127.0.0.1:9/mcp', headers: {}, toolCallTimeoutMs: 60_000, failOnStartupError: false,
        }), resolveReconnectPolicy(undefined, 'usage'), new McpStatusCell(() => {}))
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
