/**
 * MCP servers page, node half. The browser half owns the page and the status
 * item through exports["./client"], discovered from the package.json dsh.client
 * declaration. This half registers the page's preferences so the browser reads
 * and writes them through the configuration form projection. The `mcpServers`
 * Remote the page calls is registered by `@deepseek-ai/dsh-api-mcp-controller`.
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_STATUS_ITEM, STATUS_ITEM_FIELD } from './mcp-ui-settings.ts'

export {
  DEFAULT_STATUS_ITEM, MCP_UI_SETTINGS_NAMESPACE, STATUS_ITEM_FIELD, type McpUiSettings,
} from './mcp-ui-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Whether the MCP status item shows below the prompt box. */
  statusItem: Volatile<boolean>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [STATUS_ITEM_FIELD]: z.boolean().default(DEFAULT_STATUS_ITEM).volatile(),
})

/**
 * Host preferences are consumed through the configuration form projection.
 * @param ctx - plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
