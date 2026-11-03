---
description: "Live tool lists and usage counters of running MCP clients, registered by the clients and read by management surfaces."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-status

English | [中文](README.zh.md)

## Summary

`dsh-mcp-status` keeps one live record per running MCP client: the tools it registered and how its tools have been used. Connection state is not recorded here: each client publishes it through `connectionStatusOf`, and the [MCP manager](../mcp-manager/README.md) lists it for managed servers. Shipped profiles mount the service once. Each [MCP client](../mcp-client/README.md) registers itself, so there is nothing to configure. It adds no model-visible text.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Shipped profiles already mount the service as `mcp-status`; a custom profile adds `@deepseek-ai/dsh-mcp-status` before its MCP client entries. Read it as `ctx.mcpStatus`:

| Member | Returns |
|---|---|
| `tools(server)` | The tools registered from the server right now |
| `servers()` | Every registered server's name and whether new Sessions use it by default |
| `stats(server, session?)` | The server's `McpServerStats`: usage counters and connection facts, or undefined; with a Session id, only that Session's calls |

An `McpServerStats` counts tool calls and failed calls, sums and maxes call time, and estimates the tokens of the arguments sent and the result text returned, at four characters per token. It also carries the estimated tokens the server's tool definitions add to every model request, the number of connections made, the name and version the server reports, the negotiated protocol revision, the transport, and per-tool call counts. Counters start when the client loads, survive a reconnect, and are read on demand; they fire no event.

The `mcp-status/changed` event fires with the server name after every registration, removal, and tool-list change. `servers()` reports each client's own `defaultActive`; [mcp-selection](../mcp-selection/README.md) applies its overrides on top.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `McpStatusRuntime` service: registrations as effects, reads, and the event relay |
| [`src/types.ts`](src/types.ts) | `McpToolInfo`, `McpServerStats`, `McpCallRecord`, and the `McpServerHandle` a client registers |

A client registers a handle whose reads are live closures over its usage recorder (`mcp-client/src/usage.ts`), so the service stores no state of its own and cannot disagree with the client. The service subscribes to each handle and relays its changes as one event. A registration is an effect, so it disappears with the client's fiber, including on a hot reload.

No runtime invariant companion is published: the service holds only registrations, and each answer is read from the owning client.

</details>

<a id="model-experience"></a>
## Model Experience

None, as the service only reports tool lists and usage to management surfaces and registers no tool, prompt, or session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Servers are keyed by their configured name only** — two Agent scopes that reuse one `serverName` both register, and the readers return the first.
- **Counters are per process** — they reset when the Host restarts or the client plugin reloads. A call made with no agent counts in the totals only.
- **Token figures are estimates** — text length at four characters per token; images and other binary blocks count as zero.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
