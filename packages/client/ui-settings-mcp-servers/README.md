---
description: "The MCP servers page on the dsh web client's Plugins page: add, edit, enable, disable, and remove the servers the model's MCP tools come from."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp-servers

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **MCP servers** in the Official group to add, edit, enable, disable, and remove the MCP servers of the current profile without editing files. Each server is a local command or an HTTP endpoint. Secrets are chosen as environment variables and never typed into the profile file. The page exists while the Host serves the `mcpServers` Remote.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The **MCP servers** card opens the list. Each row shows the server's name, type, connection state, and command or URL. The state reads **Connected**, **Connecting**, **Reconnecting (attempt/limit)**, or **Not connected**, and a server that is not connected shows its last error under the command. The switch enables or disables a server, **Tools (n)** opens the server's tools, **Reconnect** connects now instead of waiting out the retry delay, **Edit** opens the form, and **Remove** asks first. **Add server** opens the same form for a new server.

The form asks for a **Name** (letters, digits, `_` and `-`; it prefixes the server's tool names), a type, and either a command with one argument per line and an optional working directory, or a URL. **Environment variables** (local command) or **Headers** (HTTP) list name and value pairs; each value is a **Variable** read from the harness environment when the server starts (the variable must already be set), a **Bearer variable** sent as `Bearer <value>`, or plain **Text**. A credential-shaped name such as `TOKEN` or `Authorization` refuses plain text. A value already stored in the file shows as **Stored value**, and an expression the file already holds shows as **Expression**; both stay as they are. The form also takes a tool-call timeout and whether the server must connect for the plugin to start.

Saving a local command first shows the exact command the harness will run and asks the person to trust it. A server can be edited, but its type cannot change.

The **Tools** dialog lists every tool under the name the model sees, with its first description line and a filter box. Select a tool to read its full description and a table of its parameters with their types and whether each is required. The list updates while the dialog is open.

A change applies right away on a profile with hot reload, and the toast says to restart otherwise. Rows that come from bundles, the home patch, or command-line overlays are listed but cannot be changed here; a row that uses expressions or a URL with credentials can be removed or switched but not edited.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half keeps the page in `McpServersController`: it reads `mcpServers.list`, stages the form as an `EditorDraft`, and turns the draft into an `McpServerSpec` with `specFromDraft`. A refused save returns to the form with a localized sentence for the Host's error code and the Host's own explanation beside it. A local command is saved twice: the first call is refused with `confirmation-required` and the Host's command line, and the second repeats the spec with that exact text as `confirmedCommand` once the person trusts it, so the text the person reads is the text the Host checks. The controller re-reads after every change and on `plugin-manager/changed` and `connection/reset`, but only once the page has opened.

The page registers `McpServersCard` into the Plugins page's `plugins.item` slot, and `McpServersToast` into `shell.overlay` so outcome toasts outlive the Plugins panel. The package injects `remote.mcpServers`, so the page is absent from deployments without the controller.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [api-mcp-controller](../../api/mcp-controller/README.md) — the Host Remote the page calls and the rules it enforces.
- [mcp-client](../../mcp/mcp-client/README.md) — the plugin each row configures.
- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-primitives](../ui-primitives/README.md) — the dialog, switch, and field components the page renders.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Connection state needs the status service** — shipped profiles mount it; without it a row reads **Loaded** when the plugin started, even if the server never connected.
- **Errors are the server's own text** — a connection error shows as the SDK or transport reported it, unlocalized.
- **Not every value is editable** — rows with expressions outside `env` and `headers`, or a URL that embeds credentials, can be removed or switched but not edited.
- **Browser-side validation is minimal** — the Host validates the whole configuration and the form shows what it refuses.
- **Runtime invariant:** No companion is published. The page holds no owned relationship of its own: what it shows derives from `mcpServers.list`, and what it writes the Host validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
