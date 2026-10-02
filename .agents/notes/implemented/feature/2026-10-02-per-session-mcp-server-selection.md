# Agent Note: Per-Session MCP server selection

Status: implemented

English | [中文](2026-10-02-per-session-mcp-server-selection.zh.md)

## Problem

Every configured [MCP server](2026-10-01-mcp-servers-on-the-plugins-page.md) reached every Session. Each server adds its tool definitions and instructions to every model request, so a Session that needs one server paid for all of them. The only way to drop a server was to disable its entry, which removed it from every Session at once.

## Decision

A configured server is available to every Session, and each Session uses a subset. `@deepseek-ai/dsh-mcp-selection` owns the choice as `ctx.mcpSelection`.

**The selection is Session state.** One `mcp/servers` event carries the complete `active` list, and the `mcpServers` projection folds the last one. A model request's tool set is therefore reconstructable from the log. The event is required on read: a build that does not know it refuses the log, because skipping it would change what the model is offered.

**A Session with no event follows per-server defaults.** `mcp-client` gains `defaultActive` (default `true`), so headless, SDK, and ACP Sessions behave as before, and a user can keep a rarely used server configured but off for new Sessions. A logged list is matched against the servers configured now; a server added later stays off for a Session that has already selected.

**Enforcement is a tool-registry restriction.** The service creates one scope per agent and denies the public tool names of every server the Session does not use. The registry's single resolver feeds schemas, lookup, execution, and PTC bindings, so a denied tool is absent from the request and a direct call returns `UNKNOWN_TOOL`. `mcp-client` and `mcp-resources` ask `isActive` for the server instructions, the server-name section, and resource requests; the shared resource tools are hidden from a Session using no server.

**A child Session copies its parent's logged selection** at delegation, beside the sandbox and permission seed, so a child uses the servers its parent selected.

**The GUI offers two controls over one Remote method.** `mcpServers.setSessionServers` takes the complete list. The composer tool row has a selector before the model selector, with the model selector's trailing check, shown on the new-session screen and in a conversation. The status panel has one switch per server. Usage counters are also attributed to the calling Session, and the panel shows this Session beside all Sessions.

## Alternatives considered

**Connecting a server per Session.** Rejected: a stdio server would start once per Session, and the connection, its retry budget, and its status would multiply. Selection needs only visibility.

**Filtering tool schemas in a prompt-assembly listener.** Rejected: a direct or PTC call would still reach the tool. The registry restriction denies at execution.

**An opt-in default for every server.** Rejected: existing profiles and every non-GUI launcher would lose their MCP tools on upgrade.

**Storing the choice in client storage or settings.** Rejected: the choice changes model-visible input, so it must be in the Session log.

## Consequences

Changing a selection changes the tool schemas and system prompt of the Session's next request and starts a new cache prefix. Earlier tool calls stay in the history after their definitions are gone.

Renaming a server drops it from logged selections that named it. A running child does not follow a later change in its parent. Agent-scoped servers are selected by the same name as global ones.

Counters remain per Host process; a call made with no agent counts in the totals only.

## Testing

`packages/mcp/mcp-selection/tests` run the real agent loop with a mock adapter and assert the tool set of each model request, the `UNKNOWN_TOOL` refusal, the logged events, and mask disposal. `packages/mcp/mcp-client/tests` and `packages/mcp/mcp-resources/tests` cover per-Session counters, hidden instructions, and refused resource requests. `packages/subagent/subagent/tests/continuation-inheritance.spec.ts` covers the delegation seed. `packages/api/mcp-controller/tests` cover `defaultActive` in the profile patch, `overview(sessionId)`, and `setSessionServers`. `apps/web/tests/mcp-servers.e2e.ts` drives the selector and the panel switches in a browser against a real MCP server and asserts the Host's tool set.
