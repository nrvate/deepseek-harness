/** The registry exposes each registered server's tools and usage and relays its changes as one event. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import McpStatusRuntime, { type McpServerHandle, type McpToolInfo } from '../src/index.ts'

function handle(serverName: string) {
  const listeners = new Set<() => void>()
  let tools: McpToolInfo[] = [{ name: 'echo', publicName: `mcp__${serverName}__echo`, description: 'Echo', parameters: [] }]
  const served: McpServerHandle = {
    defaultActive: serverName !== 'b',
    tools: () => tools,
    stats: session => ({ calls: session === undefined ? 3 : 1, errors: 1, inputTokens: 10, outputTokens: 20, totalMs: 30, maxMs: 15, connections: 1, schemaTokens: 5, transport: 'stdio', tools: [] }),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return {
    served,
    listeners,
    setTools(next: McpToolInfo[]) {
      tools = next
      for (const listener of listeners) listener()
    },
  }
}

async function mount() {
  const ctx = new Context()
  await ctx.plugin(McpStatusRuntime).await()
  const changed = vi.fn()
  ctx.on('mcp-status/changed', changed)
  return { ctx, changed }
}

it('lists registered servers and answers per server', async () => {
  const { ctx } = await mount()
  ctx.mcpStatus.register('a', handle('a').served)
  ctx.mcpStatus.register('b', handle('b').served)

  expect(ctx.mcpStatus.servers()).toEqual([{ serverName: 'a', defaultActive: true }, { serverName: 'b', defaultActive: false }])
  expect(ctx.mcpStatus.tools('a')).toHaveLength(1)
  expect(ctx.mcpStatus.tools('missing')).toEqual([])
  expect(ctx.mcpStatus.stats('a')).toMatchObject({ calls: 3, errors: 1 })
  expect(ctx.mcpStatus.stats('a', 'session-1')).toMatchObject({ calls: 1 })
  expect(ctx.mcpStatus.stats('missing')).toBeUndefined()
})

it('relays registrations, tool changes, and removals as one event naming the server', async () => {
  const { ctx, changed } = await mount()
  const a = handle('a')
  const dispose = ctx.mcpStatus.register('a', a.served)
  expect(changed).toHaveBeenCalledWith('a')
  changed.mockClear()

  a.setTools([])
  expect(changed).toHaveBeenCalledTimes(1)
  expect(ctx.mcpStatus.tools('a')).toEqual([])
  changed.mockClear()

  dispose()
  expect(changed).toHaveBeenCalledWith('a')
  expect(a.listeners.size).toBe(0)
  expect(ctx.mcpStatus.servers()).toEqual([])
})

it('stops serving a server when the registering fiber is disposed', async () => {
  const { ctx } = await mount()
  const a = handle('a')
  const fiber = ctx.plugin({ inject: ['mcpStatus'], apply: (inner: Context) => { inner.mcpStatus.register('a', a.served) } })
  await fiber.await()
  expect(ctx.mcpStatus.stats('a')).toBeDefined()
  await fiber.dispose()
  expect(ctx.mcpStatus.stats('a')).toBeUndefined()
})

it('keeps a server in its first place when it registers again, as a restart does', async () => {
  const { ctx } = await mount()
  const dispose = ctx.mcpStatus.register('a', handle('a').served)
  ctx.mcpStatus.register('b', handle('b').served)
  dispose()
  ctx.mcpStatus.register('a', handle('a').served)
  expect(ctx.mcpStatus.servers().map(server => server.serverName)).toEqual(['a', 'b'])
})
