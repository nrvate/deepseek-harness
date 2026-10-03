/** The policy store answers per server and takes a changed policy without a reload. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import McpPolicyStore, { MCP_TOOL_MODES } from '../src/index.ts'

describe('McpPolicyStore', () => {
  it('answers the stored policy of a server and nothing for others, filling omitted fields', async () => {
    const ctx = new Context()
    // Raw config, as a profile patch supplies it; the plugin's schema fills and wraps it.
    await ctx.plugin(McpPolicyStore, { servers: { docs: { default: 'allow' }, mail: { tools: { send: 'deny' } } } } as never)
    expect(ctx.mcpPolicy.policyOf('docs')).toEqual({ default: 'allow', tools: {} })
    expect(ctx.mcpPolicy.policyOf('mail')).toEqual({ default: 'ask', tools: { send: 'deny' } })
    expect(ctx.mcpPolicy.policyOf('other')).toBeUndefined()
    // An inherited property name is not a server.
    expect(ctx.mcpPolicy.policyOf('toString')).toBeUndefined()
    expect(MCP_TOOL_MODES).toEqual(['ask', 'allow', 'deny'])
  })

  it('refuses a mode it does not know', () => {
    expect(() => McpPolicyStore.Config({ servers: { docs: { default: 'sometimes' } } as never })).toThrow()
  })

  it('stores nothing by default', async () => {
    const ctx = new Context()
    await ctx.plugin(McpPolicyStore, {})
    expect(ctx.mcpPolicy.policyOf('docs')).toBeUndefined()
  })
})
