---
description: "Live connection state and tool lists of configured MCP servers, registered by their clients and read by management surfaces."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-status

English | [中文](README.zh.md)

## Summary

`dsh-mcp-status` keeps one live record per configured MCP server: whether it is connecting, connected, reconnecting, or failed, the last error, and the tools it offers. Shipped profiles mount it once. Each [MCP client](../mcp-client/README.md) registers itself, so there is nothing to configure. It adds no model-visible text.

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
| `list()` | The status of every registered server |
| `get(server)` | One server's `McpServerStatus`, or undefined |
| `tools(server)` | The tools registered from the server right now |
| `stats(server)` | The server's `McpServerStats`: usage counters and connection facts, or undefined |
| `reconnect(server)` | Whether a new attempt started |

An `McpServerStatus` carries `state` (`connecting`, `connected`, `reconnecting`, `failed`), the failed `attempt` count and the configured `maxAttempts`, the last `error`, `connectedAt`, and `toolCount`. `failed` means no attempt is pending: the retry budget is spent, reconnecting is disabled, or a failed connection could not be closed. `reconnect` connects now, skips a pending retry delay, and restarts the retry budget; it does nothing while a connection is live or being made.

An `McpServerStats` counts tool calls and failed calls, sums and maxes call time, and estimates the tokens of the arguments sent and the result text returned, at four characters per token. It also carries the estimated tokens the server's tool definitions add to every model request, the number of connections made, the name and version the server reports, the negotiated protocol revision, the transport, and per-tool call counts. Counters start when the client loads, survive a reconnect, and are read on demand; they fire no event.

The `mcp-status/changed` event fires with the server name after every registration, removal, state change, and tool-list change.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `McpStatusRuntime` service: registrations as effects, reads, and the event relay |
| [`src/types.ts`](src/types.ts) | `McpServerStatus`, `McpToolInfo`, and the `McpServerHandle` a client registers |

A client registers a handle whose reads are live closures over its supervisor, so the service stores no state of its own and cannot disagree with the connection. The service subscribes to each handle and relays its changes as one event. A registration is an effect, so it disappears with the client's fiber, including on a hot reload.

No runtime invariant companion is published: the service holds only registrations, and each answer is read from the owning client.

</details>

<a id="model-experience"></a>
## Model Experience

None, as the service only reports connection state to management surfaces and registers no tool, prompt, or session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Servers are keyed by their configured name only** — two Agent scopes that reuse one `serverName` both register, and the readers return the first.
- **The error is the SDK's or the transport's message** — it is not localized and can be long.
- **Counters are per process** — they reset when the Host restarts or the client plugin reloads, and they are not attributed to a Session.
- **Token figures are estimates** — text length at four characters per token; images and other binary blocks count as zero.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
