---
description: "Live store of the MCP tool-call policies a person sets, read by every MCP client at each call so a change never reconnects a server."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-policy

English | [中文](README.zh.md)

## Summary

`dsh-mcp-policy` holds the tool-call policy the person sets for each MCP server: whether each tool runs, asks first, or is refused. Its `servers` field is volatile, so a change written to the profile patch reaches the running store without reloading anything. Each [MCP client](../mcp-client/README.md) reads its server's entry at every call and uses the `toolPolicy` in its own configuration when the store holds none. Shipped profiles mount it once as `mcp-policy`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The MCP servers page writes the store; a hand-written profile patch can too:

```yaml
- id: mcp-policy
  config:
    servers:
      docs:
        default: ask
        tools:
          search: allow
          delete_page: deny
```

| Key | Default | Meaning |
|---|---|---|
| `servers` | `{}` | Policies by configured server name: `default` (`ask`, `allow`, or `deny`; default `ask`) and `tools`, the server's own tool names mapped to their own modes. Changes apply to the next call without a reload |

Read it as `ctx.mcpPolicy.policyOf(server)`, which returns the stored policy or undefined.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `McpPolicyStore` service and its volatile config |
| [`src/types.ts`](src/types.ts) | `McpToolMode` and `McpToolPolicy` |

A policy cannot live as a volatile field of the `mcp-client` entry itself: that plugin's config is a union over transports, and the Loader treats only fixed object paths as volatile, so any change there reloads the client and reconnects its server. A separate entry with one volatile field keeps policy edits live. The [MCP controller](../../api/mcp-controller/README.md) writes it through the config editor.

No runtime invariant companion is published: the store holds only configuration, read on demand.

</details>

<a id="model-experience"></a>
## Model Experience

None, as the store only holds configuration; the [MCP client](../mcp-client/README.md#tool-call-policy) owns the gate and the refusals the model reads.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Policies are keyed by server name** — renaming a server leaves its stored policy under the old name; removing a server through the MCP controller drops its entry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
