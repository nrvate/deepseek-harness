---
description: "The MCP servers page on the dsh web client's Plugins page and the MCP status item below the prompt box: manage servers and watch their state and usage."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp-servers

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **MCP servers** in the Official group to add, edit, enable, disable, and remove the MCP servers of the current profile without editing files. Each server is a local command or an HTTP endpoint. Secrets are chosen as environment variables and never typed into the profile file. A status item below the prompt box shows how many servers are connected and opens their usage figures. The page and the item exist while the Host serves the `mcpServers` Remote.

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

The form asks for a **Name** (letters, digits, `_` and `-`; it prefixes the server's tool names), a type, and either a command with one argument per line and an optional working directory, or a URL. A local command starts with a minimal environment (its path, home directory, locale, and proxy settings), so any other variable it needs must be listed. **Environment variables** (local command) or **Headers** (HTTP) list name and value pairs; each value is a **Variable** read from the harness environment when the server starts (the variable must already be set), a **Bearer variable** sent as `Bearer <value>`, or plain **Text**. A credential-shaped name such as `TOKEN` or `Authorization` refuses plain text. A value already stored in the file shows as **Stored value**, and an expression the file already holds shows as **Expression**; both stay as they are. The form also takes a tool-call timeout, whether the server must connect for the plugin to start, **On for new sessions** (when off, the server stays available and a session uses it only after it is selected there), and **Tool calls**: **Ask first** (the default), **Allow**, or **Block** for every tool the server offers. A row tags a server whose calls are allowed or blocked.

Saving a local command first shows the exact command the harness will run and asks the person to trust it. A server can be edited, but its type cannot change.

The **Tools** dialog lists every tool under the name the model sees, with its first description line and a filter box. Select a tool to read its full description and a table of its parameters with their types and whether each is required. The list updates while the dialog is open. Each tool shows the mode it runs under, and its expanded help has a **When the model calls this tool** select that gives it its own mode or returns it to the server default; these changes take effect at the next call without reconnecting the server. In the approval prompt of an MCP tool call, **Always allow** sets that tool to Allow the same way and then allows the call.

### Status item

In a conversation, an **MCP 2/3** item sits below the prompt box beside the other readings: connected servers out of enabled ones, with a dot that turns amber while a server is connecting and red when one has failed. Selecting it opens a panel. The top shows calls, errors, and estimated tokens in and out for **This session** and for **All sessions**, then the estimated tokens the tool definitions of the servers this session uses add to every request. Each server then has its state, a switch that decides whether this session uses it, the same four figures as this session / all sessions, and a **Details** row with the server's reported name and version, protocol revision, type, time connected, connection count, tool count, average and slowest call, last call, and its five most used tools. The figures refresh every two seconds while the panel is open. **Manage servers** opens the Plugins page.

**Show MCP status below the prompt box** on the MCP servers page turns the item on or off. The choice is saved with the profile's settings and is on by default. The item never shows when no server is configured.

### Servers per session

Adding a server makes it available; each session decides which servers it uses. In the composer tool row, between the permission and model selectors, an **MCP 2/3** selector shows how many of the enabled servers this session uses. It opens a list of the servers with a check on each one in use; choosing a server switches it for this session and keeps the list open, and clearing every check uses none. The switches in the status panel do the same. The selector appears on the new-session screen and in a conversation, and a change applies from the session's next request.

A session that has not chosen uses every server whose **On for new sessions** is on. A session's choice is saved with the session, so it survives a restart, and a sub-agent starts with its parent's choice. A server that is not connected can still be selected and says so beside its name.

A change applies right away on a profile with hot reload, and the toast says to restart otherwise. Rows that come from bundles, the home patch, or command-line overlays are listed but cannot be changed here; a row that uses expressions or a URL with credentials can be removed or switched but not edited.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half keeps the page in `McpServersController`: it reads `mcpServers.list`, stages the form as an `EditorDraft`, and turns the draft into an `McpServerSpec` with `specFromDraft`. A refused save returns to the form with a localized sentence for the Host's error code and the Host's own explanation beside it. A local command is saved twice: the first call is refused with `confirmation-required` and the Host's command line, and the second repeats the spec with that exact text as `confirmedCommand` once the person trusts it, so the text the person reads is the text the Host checks. The controller re-reads after every change and on `plugin-manager/changed` and `connection/reset`, but only once the page has opened.

The page registers `McpServersCard` into the Plugins page's `plugins.item` slot, and `McpServersToast` into `shell.overlay` so outcome toasts outlive the Plugins panel. The status item is `McpStatusItem` in the composer's `conversation.composer.dock` slot and the selector is `McpServerSelect` in `conversation.input.right`, both backed by one `McpTrayController`: it reads `mcpServers.overview` for the Session on screen when either mounts and when the Host reports a change, and polls it only while the panel is open, because usage counters fire no event. Both read the Session's `mcpServers` projection and resolve the servers in use with `useSessionServers`: the logged selection, or each server's default while there is none. A toggle shows at once, sends the complete selection through `mcpServers.setSessionServers`, and gives way to the Session log's next selection or to a refusal. Without the projection, which means the Host mounts no selection service, the selector and the switches are absent. The preference is the `statusItem` field of this package's Host half, a live settings field read and written through `ctx.configForms` under the namespace `ui-settings-mcp-servers`.

The package injects `remote.mcpServers`, so the page, the item, and the selector are absent from deployments without the controller.

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
- **The status item needs a conversation** — the composer dock is not rendered on a blank session's start screen, so the item appears once a conversation has a message.
- **Usage figures are per process and estimated** — counters reset when the harness restarts and are not split by Session; token figures are text length at four characters per token.
- **Runtime invariant:** No companion is published. The page holds no owned relationship of its own: what it shows derives from `mcpServers.list`, and what it writes the Host validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
