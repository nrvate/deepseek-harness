---
description: "Per-Session choice of which configured MCP servers reach the model, logged on the Session and enforced through the tool registry."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-selection

English | [中文](README.zh.md)

## Summary

`dsh-mcp-selection` lets each Session use a subset of the configured MCP servers. A configured server is available to every Session; a Session carries the tools and instructions of only the servers it uses. Shipped profiles mount it once as `mcp-selection`. Until a Session selects for itself, it uses every server whose [`mcp-client`](../mcp-client/README.md) entry leaves `defaultActive` on.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Shipped profiles already mount the service; a custom profile adds `@deepseek-ai/dsh-mcp-selection` next to `@deepseek-ai/dsh-mcp-status`. A profile without it gives every Session every configured server. Read it as `ctx.mcpSelection`:

| Member | Returns |
|---|---|
| `active(session)` | The server names the Session uses now, in configured order |
| `logged(session)` | The selection the Session logged, or undefined while it follows the defaults |
| `isActive(server, agent)` | Whether the server reaches the agent's model requests; true for a caller with no agent |
| `select(agent, servers)` | The servers in use after replacing the Session's selection |
| `hideWhenNone(names)` | The disposer of a rule that hides the named tools from a Session using no server |

`select` takes the complete list, drops duplicates, throws `MCP server "<name>" is not configured` for an unknown name, and logs nothing when the list equals the servers already in use. An empty list uses no server. A selection applies from the Session's next model request.

A selection is one `mcp/servers` Session event holding the complete `active` list. The `mcpServers` projection carries the last logged list to clients, or `active: null` while the Session has logged none. A logged name whose server is no longer configured is ignored, and counts again if the server returns. A server added after a Session selected stays off for that Session until it is selected there.

A delegated child Session starts with a copy of its parent's logged selection, written by the [subagent](../../subagent/subagent/README.md) package at delegation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `McpSelection` service, the `mcp/servers` event, and the `mcpServers` projection |
| [`src/types.ts`](src/types.ts) | The projection value and its key declarations |
| [`src/client.ts`](src/client.ts) | The same types for client programs |

Enforcement is a tool-registry restriction on a scope the service creates per agent. The restriction denies the tools of every server the Session does not use, by the public names [`mcp-status`](../mcp-status/README.md) reports. One registry resolver feeds tool schemas, lookup, execution, and PTC bindings, so a denied tool is absent from the request and a direct call to it returns `UNKNOWN_TOOL`.

A restriction names tools one by one, so the service recomputes on `agent/created`, `tools/change`, `mcp-status/changed`, and `select`. It replaces an agent's restriction only when the denied set would differ. The agent's scope and restriction are disposed with the agent.

[`mcp-client`](../mcp-client/README.md) asks `isActive` before contributing a server's instructions, and [`mcp-resources`](../mcp-resources/README.md) asks it before naming a server or serving a resource request. `mcp-resources` also registers its three shared tools with `hideWhenNone`.

No runtime invariant companion is published: the selection is one fold of the Session log, and the restriction is derived from it on every change.

</details>

<a id="model-experience"></a>
## Model Experience

### Servers a Session does not use

#### What the model sees

Nothing from an unused server: its tools are absent from the tool schemas and PTC bindings, its instructions are absent from the system prompt, and its name is absent from the `MCP resource servers` section. A call to one of its tools returns the registry's `UNKNOWN_TOOL` error, and a resource request naming it returns `MCP resource server "<name>" is not active in this session`. A Session using no server also loses the three shared resource tools. The package adds no text of its own.

#### Token effect

Each unused server removes its tool definitions and instructions from every request of that Session. A Session using every server pays what it paid before this package.

#### KV Cache effect

Changing a Session's selection changes the tool schemas and the system prompt of its next request, so that request starts a new cache prefix. Requests between two selections share a stable prefix. A Session that never selects sees a prefix change only when the configured servers or their defaults change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Servers are selected by configured name** — renaming a server drops it from every logged selection that named it.
- **A selection is per Session, not per turn** — a change mid-conversation leaves earlier tool calls in the history while their definitions are gone.
- **A child Session copies the selection once** — a later change in the parent does not reach a running child.
- **Agent-scoped servers are not distinguished** — a server registered in one agent's scope is selected by the same name as a global one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
