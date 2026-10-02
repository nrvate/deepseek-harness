# Agent Note: Default DeepSeek Session-log upload

Status: implemented

English | [中文](2026-09-14-session-log-upload-default.zh.md)
## Problem

Ordinary DeepSeek requests do not contain the complete canonical Session trajectory. Requiring each installation to enable log contribution prevents the default product configuration from supplying that trajectory. Recorded-session scenarios also need stable, explicit upload policies because acceptance events are part of their expected logs.

## Decision

`session-log-deepseek.Config.enabled` defaults to `false` in every process. The log carries message text, tool arguments and results, workspace paths, and feedback, which is more than the model sees, so it leaves the machine only after an explicit opt-in. A resolved `enabled: true` enables the contribution; configuration precedence determines which value takes effect. The plugin does not inspect test-runner or snapshot environment variables.

The `enabled` value is read for each request through a volatile reference so a saved preference takes effect without restarting the plugin. Profile writes can override bundle defaults under the [profile-owned configuration rules](2026-09-19-profile-owned-live-configuration.md); home patches and command-line overlays still reject conflicting writes. Disabling upload leaves the acceptance watermark unchanged because it records provider acceptance, not user eligibility. Re-enabling therefore sends the unaccepted suffix, including events recorded while disabled. Already prepared requests retain their payload.

This note owns only the default; the [request-extension decision](2026-08-21-deepseek-llm-api-request-extensions.md) owns field serialization, destinations, acceptance, and retry semantics. The headless and ACP corpus base patches and Web scaffold explicitly disable upload. Later scenario patches can enable it. The SDK text-turn recording opts in explicitly and exercises the upload path, including durable acceptance events.

## Alternatives considered

**Derive the production default from test environment markers.** This also changes downstream SDK behavior when callers inherit those variables and makes ordinary tests exercise a different product default.

**Refresh every recorded Session to include upload acceptance.** Explicit test composition preserves the existing scenarios while a default-configured SDK recording and Loader regression cover the default-on path.

**Upload by default.** It supplies the complete trajectory from ordinary product requests, but it sends local content the person did not choose to share to the provider and to any configured gateway.

## Consequences

Once opted in, eligible requests send the unaccepted canonical log suffix, up to `maxBytes` per request under the [bounded-upload decision](2026-09-24-bounded-session-log-upload.md), including message text, tool arguments and results, workspace paths, and feedback, to the resolved DeepSeek endpoint or configured gateway. No prompt tokens or model-visible content are added. Request bodies grow by up to that limit, and provider rejection still fails the request. OTel remains independent; disabling OTel does not disable this contribution.

Configuration tests cover default-off and explicit overrides with and without test environment markers. Loader cases observe that a default composition sends no request field and records no watermark, and that an opted-in composition sends both. Existing headless, ACP, Web, and SDK recordings validate their declared upload policies without rewriting committed Session generations.
