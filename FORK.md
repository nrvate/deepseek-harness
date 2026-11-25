# Fork changes

This repository is [nrvate's fork](https://github.com/nrvate/deepseek-harness) of DeepSeek Harness. It tracks upstream `master` and carries changes upstream does not have. This page is the fork's reference for every one of them: the defaults that differ, the packages that exist only here, how each behaves, and what changes for a deployment that adopts the fork. `git log --oneline master..nrvate` remains the authoritative commit list.

## Defaults that differ

These are the behavior changes a reader meets without configuring anything. Each row links the package that owns the behavior and the full contract.

| Surface | Upstream | This fork | Owner |
|---|---|---|---|
| MCP tool calls | run | ask first, per server or per tool | [mcp-client](packages/mcp/mcp-client/README.md#tool-call-policy) |
| `web_fetch` to a host outside the allow-list | fetch | ask, with the exact URL | [tool-web](packages/web/tool-web/README.md) |
| Credentials in a tool result | pass through | `[redacted: <name>]` | [secret-redaction](packages/guard/secret-redaction/README.md) |
| Credential stores under a confined command | readable | refused as protected paths | [sandbox-policy](packages/sandbox/sandbox-policy/README.md) |
| stdio MCP server environment | the harness environment minus credential-shaped names | an allow-list, plus the server's own `env` | [mcp-client](packages/mcp/mcp-client/README.md#stdio-environment) |
| Session-log upload | on | off until `enabled: true` | [session-log-deepseek](packages/session/session-log-deepseek/README.md) |
| Provider credential onboarding | on | off unless a deployment asks | [ui-settings-models](packages/client/ui-settings-models/README.md) |
| MCP servers a Session uses | every configured server | the ones it selected | [mcp-selection](packages/mcp/mcp-selection/README.md) |
| Per-model reasoning default | the route's level | the model's own `defaultReasoningEffort` | [llm-pi-ai](packages/llm/llm-pi-ai/README.md) |

## The MCP servers surface

Upstream connects MCP servers by configuration file and gives every Session every server. This fork adds a browser surface for the servers the manager runs, a per-Session choice of which servers reach the model, live per-call tool policy, and usage reporting. The model-facing contract lives in the [MCP subsystem](docs/subsystems/mcp.md); the packages below own the parts.

### Server registry and usage: `mcp-status`

`mcp-status` ([README](packages/mcp/mcp-status/README.md)) is the shared registry every MCP client publishes into. A client registers a handle whose reads are live closures over its own usage recorder, so the service keeps no state of its own and every answer is read from the owning client at call time. Registration is an effect, so it disappears with the client's fiber, including on a hot reload.

| Member | Returns |
|---|---|
| `tools(server)` | the tools registered from that server right now, with descriptions and parameters |
| `clientTools(server)` | the public names of the tools the client registers to serve the server, such as an on-demand server's loader |
| `servers()` | every registered server's name and its configured `defaultActive` |
| `stats(server, session?)` | the server's `McpServerStats`; with a Session id, only that Session's calls |

`McpServerStats` carries tool calls, failed calls (transport error, timeout, cancellation, or a result the server marked as an error), summed and maximum call time, the epoch time of the last call, estimated input and output tokens at four characters per token, the estimated tokens the server's tool definitions add to every request, successful connection count, the name and version the server reports, the negotiated protocol revision, the transport, and per-tool call counts. `mcp-status/changed` fires with the server name after every registration, removal, and tool-list change. Counters start when the client loads, survive a reconnect, reset per process, and fire no event, so a surface polls them while it is open.

### Per-Session server selection: `mcp-selection`

`mcp-selection` ([README](packages/mcp/mcp-selection/README.md)) lets each Session use a subset of the configured servers. A configured server is available everywhere; a Session carries only the tools and instructions of the ones it uses. With no selection of its own, a Session uses each server that is on by default: the volatile `defaultActive` map in this plugin's config, else the client's own `defaultActive`, which defaults to on. The map is a Settings field, so the page turns a server's default on or off without reconnecting it.

Enforcement is a tool-registry restriction the service creates on a scope per agent, denying the public names of every server the Session does not use. One registry resolver feeds tool schemas, lookup, execution, and PTC bindings, so an unused server's tools are absent from the request and a direct call returns `UNKNOWN_TOOL`; a resource request naming an inactive server fails with `MCP resource server "<name>" is not active in this session`. The restriction is recomputed on `agent/created`, `tools/change`, `mcp-status/changed`, and `select`, and replaced only when the denied set would differ. Its scope and restriction are disposed with the agent, so an unused server also loses its instruction section and its on-demand tool list.

`select(agent, servers)` takes the complete list, drops duplicates, throws `MCP server "<name>" is not configured` for an unknown name, and logs nothing when the list equals the servers already in use. An empty list uses none. Clients ask `isActive` before contributing instructions, `mcp-resources` asks it before naming a server or serving a request, and `mcp-resources` registers its three shared tools through `hideWhenNone`, so a Session using no server loses those too. A change applies from the Session's next model request.

### Live tool-call policy: `mcp-policy`

`mcp-policy` ([README](packages/mcp/mcp-policy/README.md)) holds the tool-call policy a person sets per server: a `default` mode (`ask`, `allow`, or `deny`; default `ask`) and per-tool modes under the server's own tool names. Its `servers` field is volatile, so a write through the profile patch reaches the running store without reloading anything. A policy cannot live as a field of the `mcp-client` entry itself: that config is a union over transports, and the Loader treats only fixed object paths as volatile, so any change there would reload the client and reconnect its server. Each client reads its server's entry at every call and falls back to its own configured `toolPolicy` when the store holds none. Policies are keyed by configured name, so a rename leaves the old entry behind; removing a server through the controller drops it.

### The `mcpServers` Remote: `api/mcp-controller`

`api/mcp-controller` ([README](packages/api/mcp-controller/README.md)) serves the operations a browser needs beyond the MCP manager and Settings: `tools(serverName)`, `overview(sessionId?)` (each running client's counters with that Session's share, plus the Host clock), `setSessionServers(sessionId, active)` delegating to `mcp-selection`, and `allowTool(publicName)`. `allowTool` writes the policy store through the config editor and answers `{ ok: true, serverName, tool }` or `{ ok: false, code, message }` with `unknown-tool`, `no-policy-store`, or `write-failed`. The controller keeps no state: every read is served from the status registry at call time. Its four methods are classified owner-only for liveshare.

### The MCP servers page: `client/ui-settings-mcp-servers`

`ui-settings-mcp-servers` ([README](packages/client/ui-settings-mcp-servers/README.md)) is the browser half: the page on **Plugins**, the status item below the prompt box, and the per-Session selector in the composer.

The page lists every server the manager runs with its name, type, live state, command or URL, and where it comes from (**From the profile**, **Changed from the profile**, **Registered by a plugin**). States read **Connected**, **Connecting**, **Reconnecting (attempt/limit)**, **Waiting for credentials**, **Not connected**, **Off**, or **Cleanup incomplete**, with the last error under the command. Actions are enable/disable, **Tools (n)**, **Reconnect**, **Test** (a probe that does not touch the running instance, reporting the server's name, version, connect and list timings, tool names, and the failing stage), **Edit**, **Remove**, **Restore default** for an inherited server, and **Add server**. A local command's save first shows the exact command and asks the person to trust it; a server's name and type cannot change afterwards.

The form takes a name (letters, digits, `_`, `-`, which prefixes its tool names), a transport, and either a command with one argument per line and optional working directory or a URL. Environment variables or headers are name/value pairs whose value is plain text, a credential reference, or a bearer credential; typing a secret stores it in the credentials store on save, and the settings keep only `${credential:NAME}`. The form also takes a tool-call timeout, **On for new sessions** (whether a Session with no choice uses it), and **Tool calls** — **Ask first** (the default), **Allow**, or **Block** for the whole server. Rows are tagged when calls are allowed or blocked.

The **Tools** dialog shows each tool under the name the model sees, with a filter, its description, a parameter table, and its mode; the expanded help offers **When the model calls this tool** to give one tool its own mode or return it to the server default, effective at the next call. **Always allow** in an MCP approval prompt sets that tool to Allow and then allows the call.

The status item reads **MCP n/m** — connected out of enabled, amber while connecting, red when one failed. Its panel shows calls, errors, and estimated tokens in and out for **This session** and **All sessions**, the estimated tokens the Session's servers add to every request, then each server's state, last error, a switch deciding whether this Session uses it, the same figures, and a **Details** row with reported name and version, protocol revision, type, time connected, connection count, tool count, average and slowest call, last call, and five most used tools. It refreshes every two seconds while open. **Manage servers** opens the page, and **Show MCP status below the prompt box** is the page's own preference, on by default and saved with the profile. The item never shows when no server is configured.

In the composer, between the permission and model selectors, an **MCP n/m** selector lists the servers with a check on each one in use; choosing a server switches it for this Session without closing the list, and clearing every check uses none. Both it and the panel switches send the complete selection and give way to the Session log's next selection or to a refusal.

The page reads three Settings namespaces through `settings.describe` — `mcp-manager` for entries, `mcp-policy` for tool modes, `mcp-selection` for defaults — and joins them with one manager watch stream shared by the page, the item, and the selector. A save stores typed secrets, writes `servers.<name>` at the revision it read, then the policy default and the Session default when they changed; enable, disable, remove, and restore write `servers.<name>.enabled` or unset the entry. It refreshes on `settings/document-updated` for those namespaces, `plugin-manager/changed`, and `connection/reset`, but only once the page has opened. It registers into the Plugins page's `plugins.item` slot, the shell overlay for toasts, the composer dock for the status item, and the composer's right inputs for the selector, and its page, item, and selector are absent unless the Host serves the `mcpManager`, `mcpServers`, `settings`, and `credentials` Remotes. Limits it states: inherited values cannot be dropped key by key, a profile `mcp-client` row outside the manager is not listed, names cannot change, connection errors show the server's own unlocalized text, the item needs a conversation, and the figures are per process and estimated.

### Client changes: `mcp-client`

`mcp-client` ([README](packages/mcp/mcp-client/README.md)) gained the policy gate, `defaultActive`, and the reporting the page reads. Every call to a server's tools passes `toolPolicy` in the `tools/pre-execute` waterfall, so native, PTC, and subagent calls are all covered: `deny` refuses with a reason the model can act on, `ask` routes through the approval service with the server and tool named, and `allow` leaves the call to the rest of the waterfall, so hooks and other policies still apply and a later refusal is never relaxed. A Session running with `danger-full-access` runs without asking, and a caller with no approval channel, such as a delegated child whose approval policy is pinned to `never`, is refused. A policy stored in `mcp-policy` wins over the configured one and is read at every call.

`defaultActive` (default `true`) marks whether a Session with no choice of its own uses the server, on both transports. Clients publish their registered tools, usage counters, and the tools they register themselves through the status handle, which is how an on-demand server's `load_tools` loader disappears for a Session that deselected it while the server's own tools do. Browser use and the computer-use CUA driver opt their own tools into `allow`, since enabling either is the person's consent to its tools. Saving a server whose URL query or command-line option value holds a credential is refused, and a hand-written row holding one is listed read-only with the value masked.

A stdio server now inherits only an allow-list of the harness environment: identity, shell, and executable lookup (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`), their Windows counterparts, locale and time zone (`LANG`, `LANGUAGE`, `LC_*`, `TZ`), scratch directories (`TEMP`, `TMP`, `TMPDIR`), XDG directories, and proxy and trust-root names (`ALL_PROXY`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_USE_ENV_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_DIR`, `SSL_CERT_FILE`). Names match in any casing, a value exported from a shell function (`()` prefix) is never inherited, and the configured `env` is merged last and wins. Any other ambient variable a server needs must be named there.

## Security and privacy

### `web_fetch` host approval: `tool-web`

`tool-web` ([README](packages/web/tool-web/README.md)) has `fetchApproval` (`ask` by default) and `fetchAllowedHosts` (default empty). A host entry is an exact name or `*.` plus a domain, matching subdomains but not the domain itself; entries are validated at load and rejected when empty or carrying a scheme, path, or port. With `ask`, a fetch to a host outside the list goes through the approval service in the `tools/pre-execute` waterfall, so PTC and subagent calls pass through it too, and the prompt shows the exact URL because a prompt-injected model can put conversation content into a query string. A Session with full access fetches without asking, a caller with no approval channel is refused, an unparsable URL is left to the fetch that refuses it, and a later listener's refusal is never relaxed.

### Credential redaction: `secret-redaction`

`secret-redaction` ([README](packages/guard/secret-redaction/README.md), [source](packages/guard/secret-redaction/src/index.ts)) is a `tools/post-execute` listener that runs the rest of the waterfall first and then redacts what comes back: a replaced content projection, a blocking listener's feedback, or the result's own content. It replaces every known secret value, longest first so a value containing another is replaced whole, then every well-known token format, with `[redacted: <name>]` naming the source, never the value. Only text blocks change; images and other blocks pass through. Secrets are read on every call, so a credential stored after startup is covered by the next result.

Known secrets come from three sources. Environment values whose names match `KEY`, `TOKEN`, `SECRET`, `PASSW`, `PWD`, `CREDENTIAL`, `AUTH`, `COOKIE`, `_PAT`, `DSN`, `CONNECTION_STRING`, or `DATABASE_URL`, plus the password inside any URL a variable holds and any names listed in `extraNames`. What the credential provider holds: the `credentialRefs` it resolves (default `DEEPSEEK_API_KEY`), stored api keys and their environment values, and every string leaf of stored grants. Values shorter than `minLength` (default 8) are left alone because they would match ordinary text. Token formats cover private keys, GitHub, GitLab, Slack, AWS access and secret keys, Google API keys, npm tokens, and `sk-` keys.

Its stated limits matter as much as its coverage: a credential with no credential-shaped name, no known format, and no stored record, such as a password inside a file, passes through, which is what protected paths exist for; a value another listener replaces is not seen; arguments the model sends are not redacted; and a model that reads a redacted value and writes it back writes the placeholder. The plugin is mounted after `spill-policy`, so spilled output is built from redacted content.

### Protected paths: `sandbox-policy`

`sandbox-policy` ([README](packages/sandbox/sandbox-policy/README.md)) gained `protectedPaths`, a list of paths no confined execution and no sandboxed filesystem operation may read or write. The default list is `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.kube`, `~/.docker/config.json`, `~/.netrc`, `~/.npmrc`, `~/.pypirc`, `~/.git-credentials`, `~/.config/gh/hosts.yml`, `$DSH_HOME/.credentials.yaml`, and `$DSH_HOME/.env`. Entries are absolute or start with `~/` or `$DSH_HOME/`; an empty list protects nothing.

Three enforcement points consume it. bwrap hides each existing protected path after every other mount, a directory behind an empty tmpfs and a file behind `/dev/null`, and a missing path is skipped because there is nothing to hide and bwrap cannot mount over it. The Seatbelt profile appends a `deny file-read* file-write*` rule after every grant, in both the configured and the canonical spelling (`/var` is `/private/var`), because later SBPL rules win. `fs-sandbox` refuses a protected target in `resolve()` with `FS_PERMISSION_DENIED` in every mode, so no read, listing, or mutation starts and no escalation lifts it. On the Landlock rung a protected path under the readable root stays readable, because Landlock expresses grants rather than denials.

### Session-log upload: `session-log-deepseek`

`session-log-deepseek` ([README](packages/session/session-log-deepseek/README.md)) attached the raw session log — message text, tool arguments and results, workspace paths, feedback — to every DeepSeek request unless a person found the switch and turned it off. Upload is opt-in now: `enabled` defaults to `false`, and the General settings switch or `enabled: true` turns it on. A deployment that keeps the log on the machine changes nothing; one that wants the log must say so.

## Models and provider settings

### Per-model reasoning default: `llm-pi-ai`

A model entry's `defaultReasoningEffort` names the level its requests use when a caller names none, winning over the route's `reasoning` for that model alone. It is refused at resolution, not at the first request, when the model declares no reasoning, when the level is not one the materialized model offers, or when the key exists without a value. Omission inherits the route level. The Models page shows a **Default effort** select under a model's levels; the default follows a renamed level and is dropped when its level is removed or reasoning is switched off, and turning reasoning on seeds every level the protocol accepts.

### Hand-declared reasoning

A hand-declared model, one the installed catalog does not describe, that declares no `reasoningEfforts` now offers every level instead of none: each thinking level is sent under its own name, and Off is left to the protocol's own dispatch. A model whose entry and route name no level defaults to `high` where the model offers it; a configured level the model does not offer is never silently replaced by that fallback. Declaring `reasoningEfforts` still names exactly the levels a selector offers and the spelling dispatch sends, and `false` declares a non-reasoning model.

### Gemini tool results

Gateways fronting Gemini through `openai-completions` run lenient JSON repair on plain tool-result strings and drop surrounding text whenever the output contains braces. For a route whose base URL is `generativelanguage.googleapis.com`, or a model id that names Gemini or Google, `llm-pi-ai` sends tool results as the same `{ output }` / `{ error }` envelope the native Google routes use.

### Provider request headers: `ui-settings-models`

The provider editor's customized-settings fold gained a **Request headers** group after the retry policy, for a profile whose schema declares `headers`. Rows are name and value pairs written as one path op per changed header: a name must be an HTTP field name (RFC 9110 token), a value one non-empty line of bytes without NUL, and a name may appear once in any capitalization. A refused row keeps its typed text and shows the Host's reason, and emptying the group deletes the key.

### Credential onboarding and the reasoning switch

`credentialOnboarding` now defaults to `false`, so the API-key and sign-in dialog opens on start only for a deployment that sets it. The reasoning switch matches hand-declared models: a model the installed catalog does not describe reasons at every level while its `reasoningEfforts` is absent, so the switch reads on there and shows the level rows it would start from, storing them once one is edited; switching it off stores `false`, which declares the model non-reasoning, because removing the field would leave it reasoning. A model the catalog describes is unchanged: switching off removes the field and the catalog's levels apply.

## Approval prompts: the extra-action slot

`ui-approval` ([README](packages/client/ui-approval/README.md)) declares a `conversation.approval.action` list slot beside Reject and Allow once. An action receives the requesting tool's name, the correlated call id when there is one, whether the request is already being answered, and an `answer` callback; it does its own work and then answers, renders nothing for requests it does not concern, and the panel ignores a second answer. The MCP **Always allow** action is its first consumer.

## Session and delegation

### The `mcp/servers` event

A selection is one `mcp/servers` Session event holding the complete `active` list, folded by the `mcpServers` projection, whose last event wins and whose `active` is `null` while the Session has logged none. Because the choice is logged, it survives a restart. A logged name whose server is no longer configured is ignored and counts again if the server returns; a server added after a Session selected stays off for that Session until it is selected there.

An `mcp/servers` event is new to the format but does not change any existing record ([record](docs/persistence-changes/2026-10-02-mcp-session-servers.md)). A Session without it uses the configured defaults, so an existing log behaves as it did; the event is required on read, so an upstream build refuses a log that contains it.

### Delegated children

The subagent package copies the parent's logged selection onto a child at delegation, so a child uses the servers its parent selected. The copy happens once: a later change in the parent does not reach a running child, and a child with no parent selection uses the same defaults as any other Session.

## Profile wiring

`bundle/base` mounts `secret-redaction` after `spill-policy`, and `mcp-status`, `mcp-selection`, and `mcp-policy` beside `mcp-resources`. `bundle/web-app` mounts `mcp-servers-controller` before `mcp-account` and `ui-settings-mcp-servers` before `ui-plan`. The new packages are registered in the workspace `tsconfig.base.json` paths, the client tsconfig aggregates, the `api/remotes` client row, and the generated `tool-cordis` API catalog.

The fork also adds the [MCP subsystem reference](docs/subsystems/mcp.md), the `mcp/servers` persistence record, and regenerated persistence, capability-seam, module-graph, and config catalog entries, plus three Agent Notes under `.agents/notes/implemented/feature/` and updated package tables in the `dsh-doc` skill. Tests it adds or extends: a full [MCP servers browser scenario](apps/web/tests/mcp-servers.e2e.ts), the plugin-config and plugin-manager expectations, the session-log-upload expectation, and recorded fixtures for the profiles that now mount the new rows.

## Packages that exist only here

- `mcp-status` — the registry of running clients, their tool lists, and their usage.
- `mcp-selection` — the per-Session choice, its `mcp/servers` event and `mcpServers` projection, and the registry restriction that enforces it.
- `mcp-policy` — the volatile per-server tool-call policy the clients read at every call.
- `api/mcp-controller` — the `mcpServers` Remote for tool lists, usage, selection, and one-click allowance.
- `secret-redaction` — the tool-result guard that redacts known credentials and token formats.
- `client/ui-settings-mcp-servers` — the MCP servers page, the status item, and the composer selector.

## Compatibility notes

- A deployment upgrading to this fork keeps its configuration, but the defaults above change what runs without asking. A stdio MCP server that relied on an ambient variable must name it in `env`; a command that read a credential store now fails on that path; the session-log switch starts off; the credential dialog waits for a deployment to ask for it.
- MCP servers are per Session, and a Session with no choice uses every server that is on by default, so an existing conversation behaves as before until someone changes its selection.
- Policies and selections are keyed by configured server name; renaming a server drops both.
- Usage counters and token figures are per process and estimated; they are not a billing measurement.

## Maintaining this page

A difference upstream later adopts disappears from this page when the merge that adopts it lands: recheck `git log --oneline master..nrvate` after merging upstream, and delete what no longer names a difference. The package READMEs remain the contract for each behavior; this page is the fork's map of them.
