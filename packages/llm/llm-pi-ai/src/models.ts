/** pi-ai model helpers assembled from public narrow entry points. */

import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type {
  Api,
  CreateModelsOptions,
  Model,
  MutableModels,
  Provider,
  ProviderAuth,
  ProviderStreams,
} from '@earendil-works/pi-ai'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'

/** Input accepted by the static, single-protocol providers this package builds. */
interface StaticProviderOptions {
  id: string
  name: string
  baseUrl?: string
  auth: ProviderAuth
  models: readonly Model<Api>[]
  api: ProviderStreams
}

/**
 * Create an empty pi-ai collection without importing its aggregate entry point.
 * @param options - credential storage and ambient authentication integrations.
 * @returns a mutable collection with no registered providers.
 */
export function createModels(options?: CreateModelsOptions): MutableModels {
  const models = builtinModels(options)
  models.clearProviders()
  return models
}

/**
 * Create the static, single-protocol provider used by configured custom routes.
 * @param input - provider identity, models, authentication, and protocol implementation.
 * @returns a provider that delegates each operation to the supplied protocol.
 */
export function createProvider(input: StaticProviderOptions): Provider {
  return {
    id: input.id,
    name: input.name,
    ...input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl },
    auth: input.auth,
    getModels: () => input.models,
    stream: (model, context, options) => input.api.stream(model, context, options),
    streamSimple: (model, context, options) => input.api.streamSimple(model, context, options),
  }
}

/**
 * Selectable reasoning levels for one model, re-exported from pi-ai.
 *
 * One implementation, not a copy: config resolution decides whether a
 * configured default is offerable with the same predicate dispatch uses, so a
 * pi-ai change to which levels a model supports cannot make resolution accept
 * a default that dispatch then refuses mid-turn.
 * @param model - model descriptor carrying reasoning support and wire mappings.
 * @returns supported levels in pi-ai's escalation order.
 */
export { getSupportedThinkingLevels } from '@earendil-works/pi-ai'

/**
 * Resolve transcript update modes from the exact model's protocol capabilities.
 * @param model - Materialized pi-ai model, including catalog compatibility flags.
 * @returns Update modes consumed by prompt admission and tool-history projection.
 */
export function conversationUpdates(model: Model<Api>): Pick<LlmResolvedModelInfo, 'systemPromptUpdate' | 'toolUpdate'> {
  const compat = model.compat
  if (compat === undefined || !('supportsMidConvoSystemMessages' in compat)
    || !compat.supportsMidConvoSystemMessages) return {}
  const updates: Pick<LlmResolvedModelInfo, 'systemPromptUpdate' | 'toolUpdate'> = { systemPromptUpdate: 'in-history' }
  if (model.api === 'anthropic-messages'
    && 'supportsMidConvoToolChanges' in compat && compat.supportsMidConvoToolChanges) {
    updates.toolUpdate = 'in-history'
  } else if (model.api === 'openai-completions'
    && 'supportsMidConvoToolAdditions' in compat && compat.supportsMidConvoToolAdditions) {
    updates.toolUpdate = 'addition-only'
  } else if ((model.api === 'openai-responses' || model.api === 'azure-openai-responses' || model.api === 'openai-codex-responses')
    && (('supportsAdditionalTools' in compat && compat.supportsAdditionalTools)
      || ('supportsToolSearch' in compat && compat.supportsToolSearch))) {
    updates.toolUpdate = 'addition-only'
  }
  return updates
}

/**
 * Whether Chat Completions tool results must travel wrapped in a `{ output }` /
 * `{ error }` JSON object string.
 *
 * Gemini's native `FunctionResponse.response` is a `google.protobuf.Struct` and
 * rejects bare strings. Direct `google-generative-ai` and `google-vertex` routes
 * wrap tool text in `{ output }` / `{ error }` inside pi-ai, whereas
 * `openai-completions` gateways fronting Gemini (such as OpenRouter) coerce plain
 * `role: "tool"` strings with lenient JSON repair/extraction — silently dropping
 * surrounding YAML, Markdown, or source code whenever `{...}` appears inside
 * non-JSON tool output. Sending the same `{ output }` / `{ error }` JSON object
 * envelope satisfies strict top-level JSON parsing without invoking repair.
 * @param model - Materialized pi-ai model descriptor.
 * @returns `true` when `model` speaks `openai-completions` to a Google/Gemini target.
 */
export function wrapsToolResultAsJsonObject(
  model: Pick<Model<Api>, 'api' | 'id' | 'baseUrl'>,
): boolean {
  if (model.api !== 'openai-completions') return false
  if (model.baseUrl.toLowerCase().includes('generativelanguage.googleapis.com')) return true
  return /^(?:~?google\/|(?:[\w.~-]+\/)*gemini(?:-|$))/i.test(model.id)
}
