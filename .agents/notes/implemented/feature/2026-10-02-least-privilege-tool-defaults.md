# Agent Note: Least-privilege defaults for tools and outbound data

Status: implemented

English | [中文](2026-10-02-least-privilege-tool-defaults.zh.md)

## Problem

A five-area audit of this fork found that data leaves the machine, or reaches the model, without the person's say. Every MCP tool ran unprompted, even in a read-only session. `web_fetch` sent any URL the model chose, so a prompt-injected model could put conversation content into a query string. The model could read the harness's own credential file, cloud and SSH credentials, and secrets in the environment, and nothing removed them from tool output before the session log and the model provider received it. The raw session log, which carries more than the model sees, was uploaded with every DeepSeek request by default.

## Decision

Outbound actions ask first, credentials stay out of tool output, and uploads are opt-in.

**MCP tool calls follow a per-server policy.** `mcp-client` gains `toolPolicy`: a `default` mode and per-tool modes, each `allow`, `ask`, or `deny`, defaulting to `ask`. The gate is a `tools/pre-execute` listener the client registers for its own tools, so native, PTC, and subagent calls pass through it; it never relaxes a later listener's refusal. The GUI edits the server default in the server form and per-tool modes in the tools dialog.

**`web_fetch` asks before fetching a host outside an allow-list.** `tool-web` gains `fetchApproval` (`ask` by default) and `fetchAllowedHosts`. The approval prompt shows the exact URL.

**A Session with full access is not asked.** `danger-full-access` is the person's choice to run without prompts, so both gates allow there. A caller with no approval channel, such as a delegated child whose approval policy is pinned to `never`, is refused.

**Tool output is redacted.** `secret-redaction` replaces the values of credential-named environment variables, the values the credential provider holds, private keys, and well-known token formats with `[redacted: <name>]` in every tool result before it is logged.

**Credential stores are protected paths.** `sandbox-policy` gains `protectedPaths`, defaulting to SSH, GPG, cloud, container, and registry credential locations and the harness's credential file and `.env`. bwrap and Seatbelt hide them from confined commands; the sandboxed filesystem refuses them in every mode.

**The session-log upload is opt-in.** `session-log-deepseek.enabled` defaults to `false`.

**Stdio MCP servers inherit an allow-listed environment** instead of a name-pattern scrub.

First-party integrations whose tools are the feature being enabled, browser use and the computer-use driver, set `toolPolicy: { default: allow }` explicitly.

## Alternatives considered

**Trust MCP tool annotations (`readOnlyHint`).** Rejected as a default: a server controls its own annotations, so a malicious server would mark every tool read-only.

**One generic egress policy plugin for every tool.** Deferred: the owning plugin knows what a call sends (a URL, a server and tool), so each gate stays with its tool and shows a specific prompt.

**Redact by key-value heuristics (`NAME=value` lines).** Rejected: it corrupts code the model reads and writes back. Redaction matches known values and formats only, and protected paths cover stores whose values have no format.

**Deny protected paths only for the shell.** Rejected: the file tools and the GUI file endpoint read through the same filesystem, so the refusal lives there too.

## Consequences

Headless, SDK, and ACP runs that call MCP tools or fetch pages now need an approval channel, `toolPolicy`/`fetchApproval: allow`, or full access; ACP clients receive a permission request per call. Recorded scenarios and the Python smoke that call these tools set `allow` explicitly.

Landlock and the Windows ACL runner cannot hide protected paths, and a full-access shell is unconfined. Redaction cannot see a value another post-execute listener replaced, and a model that rewrites a file holding a redacted value writes the placeholder.

## Testing

`packages/mcp/mcp-client/tests/policy.spec.ts` and `packages/web/tool-web/tests/fetch-approval.spec.ts` drive the gates through the real tool registry with stub approval and sandbox-policy services. `packages/guard/secret-redaction/tests` cover every source and format. `packages/sandbox/sandbox-local/tests/bwrap.e2e.ts` runs a real bwrap confinement that cannot read a protected file or directory; `packages/fs/fs-sandbox/tests` cover refusals in every mode and through links. `apps/web/tests/mcp-servers.e2e.ts` sets a tool's mode in the browser against a real MCP server.
