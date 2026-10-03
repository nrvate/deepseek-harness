// @vitest-environment jsdom
/** The approval prompt's "Always allow" action for MCP tool calls. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { McpAlwaysAllow, type McpAlwaysAllowProps } from '../src/client/McpAlwaysAllow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en) as McpAlwaysAllowProps['t']

function mount(toolName: string, saved = true, disabled = false) {
  const allowTool = vi.fn((_name: string) => Promise.resolve(saved))
  const answer = vi.fn()
  const props = { t, toolName, disabled, answer, allowTool } as McpAlwaysAllowProps
  const view = render(<McpAlwaysAllow {...props} />)
  return { ...view, allowTool, answer }
}

describe('McpAlwaysAllow', () => {
  it('renders nothing for a tool that is not an MCP tool', () => {
    expect(mount('bash').container.textContent).toBe('')
  })

  it('allows the tool from now on, then allows the pending call', async () => {
    const { allowTool, answer } = mount('mcp__docs__search')
    const button = screen.getByRole('button', { name: en.alwaysAllow })
    expect(button.getAttribute('title')).toBe(en.alwaysAllowHint)
    fireEvent.click(button)
    expect(button).toHaveProperty('disabled', true)
    expect(allowTool).toHaveBeenCalledExactlyOnceWith('mcp__docs__search')
    await waitFor(() => { expect(answer).toHaveBeenCalledExactlyOnceWith('allowed-once') })
  })

  it('leaves the decision to the person when the policy did not save', async () => {
    const { answer } = mount('mcp__docs__search', false)
    const button = screen.getByRole('button', { name: en.alwaysAllow })
    fireEvent.click(button)
    await waitFor(() => { expect(button.getAttribute('title')).toBe(en.alwaysAllowFailed) })
    expect(button).toHaveProperty('disabled', false)
    expect(answer).not.toHaveBeenCalled()
  })

  it('is disabled while the prompt is being answered', () => {
    mount('mcp__docs__search', true, true)
    expect(screen.getByRole('button', { name: en.alwaysAllow })).toHaveProperty('disabled', true)
  })
})
