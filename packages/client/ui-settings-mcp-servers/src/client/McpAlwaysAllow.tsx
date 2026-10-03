/**
 * "Always allow" in the approval prompt of an MCP tool call: lets the tool run
 * without asking from now on, then allows the pending call. The change goes to
 * the MCP policy store, so the server keeps its connection; the tools dialog on
 * the MCP servers page changes it back. Renders nothing for other tools.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the approval panel's SlotMap merge (the 'conversation.approval.action' entry).
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'

/** The registration-side face the action injects. */
export interface McpAlwaysAllowFace {
  /** Allow one tool by its model-facing name from now on; resolves to whether the Host saved it. */
  allowTool: (publicName: string) => Promise<boolean>
}

/** Props the renderer binds for the action. */
export type McpAlwaysAllowProps =
  PropsRuntime<'conversation.approval.action'>
  & PropsLocale<'settings.mcpServers'>
  & InjectFace<McpAlwaysAllowFace>

/** Prefix of every MCP tool's model-facing name. */
const MCP_TOOL_PREFIX = 'mcp__'

/**
 * Render the action for an MCP tool call.
 * @param props - the pending request, its answer, the Host action, and locale.
 * @returns the button, or null for a tool that is not an MCP tool.
 */
export function McpAlwaysAllow({ t, toolName, disabled, answer, allowTool }: McpAlwaysAllowProps): ReactNode {
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return null
  const allow = (): void => {
    setSaving(true)
    setFailed(false)
    void allowTool(toolName).then((saved) => {
      // A policy that did not save leaves the decision to the person.
      if (saved) answer('allowed-once')
      else {
        setSaving(false)
        setFailed(true)
      }
    })
  }
  return (
    <Button
      variant="outline"
      disabled={disabled || saving}
      title={failed ? t('alwaysAllowFailed') : t('alwaysAllowHint')}
      onClick={allow}
    >
      {t('alwaysAllow')}
    </Button>
  )
}
