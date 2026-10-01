/** The registry exposes each registered server and relays its changes as one event. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import McpStatusRuntime, { type McpServerHandle, type McpServerStatus } from '../src/index.ts'

function status(serverName: string, rest: Partial<McpServerStatus> = {}): McpServerStatus {
  return { serverName, state: 'connected', attempt: 0, maxAttempts: 10, toolCount: 1, ...rest }
}

function handle(serverName: string) {
  const reconnect = vi.fn(() => Promise.resolve(true))
  const listeners = new Set<() => void>()
  let current = status(serverName)
  const served: McpServerHandle = {
    status: () => current,
    tools: () => [{ name: 'echo', publicName: `mcp__${serverName}__echo`, description: 'Echo', parameters: [] }],
    reconnect,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return {
    served,
    reconnect,
    listeners,
    change(next: Partial<McpServerStatus>) {
      current = { ...current, ...next }
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
  const a = handle('a')
  const b = handle('b')
  ctx.mcpStatus.register('a', a.served)
  ctx.mcpStatus.register('b', b.served)
  b.change({ state: 'failed', error: 'down' })

  expect(ctx.mcpStatus.list().map(item => item.serverName)).toEqual(['a', 'b'])
  expect(ctx.mcpStatus.get('b')).toMatchObject({ state: 'failed', error: 'down' })
  expect(ctx.mcpStatus.get('missing')).toBeUndefined()
  expect(ctx.mcpStatus.tools('a')).toHaveLength(1)
  expect(ctx.mcpStatus.tools('missing')).toEqual([])
})

it('relays registrations, changes, and removals as one event naming the server', async () => {
  const { ctx, changed } = await mount()
  const a = handle('a')
  const dispose = ctx.mcpStatus.register('a', a.served)
  expect(changed).toHaveBeenCalledWith('a')
  changed.mockClear()

  a.change({ toolCount: 2 })
  expect(changed).toHaveBeenCalledTimes(1)
  changed.mockClear()

  dispose()
  expect(changed).toHaveBeenCalledWith('a')
  expect(a.listeners.size).toBe(0)
  expect(ctx.mcpStatus.list()).toEqual([])
})

it('stops serving a server when the registering fiber is disposed', async () => {
  const { ctx } = await mount()
  const a = handle('a')
  const fiber = ctx.plugin({ inject: ['mcpStatus'], apply: (inner: Context) => { inner.mcpStatus.register('a', a.served) } })
  await fiber.await()
  expect(ctx.mcpStatus.get('a')).toBeDefined()
  await fiber.dispose()
  expect(ctx.mcpStatus.get('a')).toBeUndefined()
})

it('asks the named client to reconnect and reports an unknown server as unchanged', async () => {
  const { ctx } = await mount()
  const a = handle('a')
  ctx.mcpStatus.register('a', a.served)
  expect(await ctx.mcpStatus.reconnect('a')).toBe(true)
  expect(a.reconnect).toHaveBeenCalledOnce()
  expect(await ctx.mcpStatus.reconnect('missing')).toBe(false)
})
