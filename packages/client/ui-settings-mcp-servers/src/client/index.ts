/**
 * The MCP servers page, browser half: the add, edit, enable, test, and remove
 * controls over the MCP manager's Settings entries and its `mcpManager`
 * Remote, the status item below the prompt box, and the per-Session server
 * selector in the composer tool row. The page registers into the Plugins
 * page's `plugins.item` slot, the item into `conversation.composer.dock`, and
 * the selector into `conversation.input.right`, all only while the Host serves
 * the `mcpManager`, `mcpServers`, `settings`, and `credentials` namespaces, so
 * a deployment without them shows no trace of the page.
 * Outcome toasts live in `shell.overlay`, which outlives the Plugins panel.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the ctx.configForms Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the composer's SlotMap merge (the 'conversation.composer.dock' entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the approval panel's SlotMap merge (the 'conversation.approval.action' entry).
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { McpServersCard } from './McpServersCard.tsx'
import { McpServersToast, type McpServersToastFace } from './McpServersToast.tsx'
import { McpServersController } from './mcp-servers-controller.ts'
import { McpFleet } from './fleet.ts'
import { MANAGER_NS, POLICY_NS, SELECTION_NS } from './entries.ts'
import { McpStatusItem } from './McpStatusItem.tsx'
import { McpServerSelect } from './McpServerSelect.tsx'
import { McpAlwaysAllow, type McpAlwaysAllowFace } from './McpAlwaysAllow.tsx'
import { McpTrayController } from './mcp-tray-controller.ts'
import { MCP_UI_SETTINGS_NAMESPACE, type McpUiSettings } from '../mcp-ui-settings.ts'
import { en, ja, es, fr, de, ru, pt, zh, type McpServersLocaleKey } from './locales.ts'

export type { McpServersCardProps } from './McpServersCard.tsx'
export type { McpServersToastProps } from './McpServersToast.tsx'
export type { McpServerRow, McpServerSource, McpServersFace, McpServersState } from './mcp-servers-controller.ts'
export type { McpFleetState } from './fleet.ts'
export type { McpStatusItemProps } from './McpStatusItem.tsx'
export type { McpServerSelectProps } from './McpServerSelect.tsx'
export type { McpAlwaysAllowFace, McpAlwaysAllowProps } from './McpAlwaysAllow.tsx'
export type { McpTrayFace, McpTrayServer, McpTrayState } from './mcp-tray-controller.ts'
export type { McpServersLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP servers page copy. */
    'settings.mcpServers': McpServersLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.mcpServers'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'locale', 'remote', 'remote.mcpServers', 'remote.mcpManager', 'remote.settings', 'remote.credentials', 'configForms', 'layout',
]

/** Settings namespaces whose changes the page re-reads. */
const WATCHED_NAMESPACES: ReadonlySet<string> = new Set([MANAGER_NS, POLICY_NS, SELECTION_NS])

/**
 * Mount the MCP servers page while the Host serves its Remotes, and keep it
 * current on the Host's change events.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-settings-mcp-servers: dictionaries')
  const form = ctx.configForms.get<McpUiSettings>(MCP_UI_SETTINGS_NAMESPACE)
  const fleet = new McpFleet(ctx)
  ctx.effect(() => () => { fleet.dispose() }, 'ui-settings-mcp-servers: server list')
  const controller = new McpServersController(ctx, form, fleet)
  ctx.effect(() => () => { controller.dispose() }, 'ui-settings-mcp-servers: controller')
  const tray = new McpTrayController(ctx, form, fleet)
  ctx.effect(() => () => { tray.dispose() }, 'ui-settings-mcp-servers: status item')
  // The Host says when Settings or the profile's plugins changed, from this
  // page, the CLI, or another browser; a reset connection reopens the server list.
  ctx.effect(() => {
    const refresh = (): void => {
      fleet.refresh()
      controller.refresh()
      tray.refresh()
    }
    const disposers = [
      ctx.remote.$on('plugin-manager/changed', refresh),
      ctx.remote.$on('settings/document-updated', (ns) => { if (WATCHED_NAMESPACES.has(ns)) controller.refresh() }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-mcp-servers: host invalidations')
  const face = controller.inject()
  ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'mcp-servers', order: 50, label: () => t('title'), locale: NS, inject: () => face,
  }, McpServersCard))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'mcp-servers-toast', locale: NS,
    inject: (): McpServersToastFace => ({ hooks: { mcpServers: face.hooks.mcpServers }, dismissNotice: face.dismissNotice }),
  }, McpServersToast))
  const trayFace = tray.inject()
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'mcp-status', order: 20, locale: NS, inject: () => trayFace,
  }, McpStatusItem))
  // The tool row's right group ends at the model selector, so this entry sits between the permission and model controls.
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'mcp-servers', order: 90, locale: NS, inject: () => trayFace,
  }, McpServerSelect))
  const alwaysAllow: McpAlwaysAllowFace = {
    allowTool: async (publicName) => {
      const result = await ctx.remote.mcpServers.allowTool(publicName)
      return result.ok && result.value.ok
    },
  }
  ctx.slots.inject('conversation.approval.action', () => ctx.slots.register({
    name: 'conversation.approval.action', id: 'mcp-always-allow', locale: NS, inject: () => alwaysAllow,
  }, McpAlwaysAllow))
}
