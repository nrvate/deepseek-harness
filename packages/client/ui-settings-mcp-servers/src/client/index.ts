/**
 * The MCP servers page, browser half: the add, edit, enable, and remove
 * controls over the `mcpServers` Remote. The page registers into the Plugins
 * page's `plugins.item` slot only while the Host serves that namespace, so a
 * deployment without the controller shows no trace of it. Outcome toasts live
 * in `shell.overlay`, which outlives the Plugins panel.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { McpServersCard } from './McpServersCard.tsx'
import { McpServersToast, type McpServersToastFace } from './McpServersToast.tsx'
import { McpServersController } from './mcp-servers-controller.ts'
import { en, zh, type McpServersLocaleKey } from './locales.ts'

export type { McpServersCardProps } from './McpServersCard.tsx'
export type { McpServersToastProps } from './McpServersToast.tsx'
export type { McpServersFace, McpServersState } from './mcp-servers-controller.ts'
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
export const inject = ['slots', 'locale', 'remote', 'remote.mcpServers']

/**
 * Mount the MCP servers page while the Host serves its Remote, and keep it
 * current on the Host's change events.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp-servers: dictionaries')
  const controller = new McpServersController(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'ui-settings-mcp-servers: controller')
  // The Host says when the profile's plugins changed, from this page, the CLI,
  // or another browser.
  ctx.effect(() => {
    const refresh = (): void => { controller.refresh() }
    const disposers = [ctx.remote.$on('plugin-manager/changed', refresh), ctx.on('connection/reset', refresh)]
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
}
