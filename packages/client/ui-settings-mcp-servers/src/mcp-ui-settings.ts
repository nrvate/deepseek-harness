/** Preferences of the MCP servers page stored in the Host user-settings document. */

/** Settings namespace owned by this plugin: its Loader row id. */
export const MCP_UI_SETTINGS_NAMESPACE = 'ui-settings-mcp-servers'

/** Field carrying whether the MCP status item shows below the prompt box. */
export const STATUS_ITEM_FIELD = 'statusItem'

/** Whether the status item shows when the user-settings document has no override. */
export const DEFAULT_STATUS_ITEM = true

/** Preference fields projected to the browser. */
export interface McpUiSettings {
  /** Whether the MCP status item shows below the prompt box. */
  statusItem: boolean
}
