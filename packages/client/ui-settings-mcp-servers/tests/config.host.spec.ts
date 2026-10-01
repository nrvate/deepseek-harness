/** The Host half: the status-item preference as a live, validated settings field. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import { apply, Config, DEFAULT_STATUS_ITEM, MCP_UI_SETTINGS_NAMESPACE } from '../src/index.ts'

describe('ui-settings-mcp-servers host', () => {
  it('registers, validates, and updates the status-item preference', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    expect(plainConfig(configuration.fiber.config)).toEqual({ statusItem: DEFAULT_STATUS_ITEM })
    await configuration.update({ statusItem: false })
    expect(plainConfig(configuration.fiber.config)).toEqual({ statusItem: false })
    await expect(configuration.update({ statusItem: 'sometimes' })).rejects.toThrow()
    await configuration.fiber.dispose()
  })

  it('shows the status item by default', () => {
    expect(DEFAULT_STATUS_ITEM).toBe(true)
  })

  it('names its settings namespace after its Loader row', () => {
    expect(MCP_UI_SETTINGS_NAMESPACE).toBe('ui-settings-mcp-servers')
  })

  it('keeps its own fiber off the generated settings pages', async () => {
    await omitsGeneratedPage(ctx => ctx.plugin({ Config, apply }))
  })
})
