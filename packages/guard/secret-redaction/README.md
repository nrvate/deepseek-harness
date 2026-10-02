---
description: "Tool-output guard that replaces known credentials and well-known token formats in every tool result before the session log or the model sees it."
kind: "package-reference"
---

# @deepseek-ai/dsh-secret-redaction

English | [中文](README.zh.md)

## Summary

`dsh-secret-redaction` keeps credentials out of the conversation. Before a tool result is logged or sent to the model, it replaces every known secret value, and every private key or well-known token format, with `[redacted: <name>]`. Known secrets are the values of harness environment variables with credential-shaped names and the values the credential provider stores. Shipped profiles mount it after `spill-policy`, so spilled output is built from redacted content too.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

| Key | Default | Meaning |
|---|---|---|
| `environment` | `true` | Redact the values of harness environment variables whose names match `KEY`, `TOKEN`, `SECRET`, `PASSW`, `PWD`, `CREDENTIAL`, `AUTH`, `COOKIE`, `_PAT`, `DSN`, `CONNECTION_STRING`, or `DATABASE_URL`, and the password of any URL a variable holds |
| `credentials` | `true` | Redact what the credential provider holds: the `credentialRefs` it resolves, stored api keys and their environment values, and every string in stored grants |
| `credentialRefs` | `['DEEPSEEK_API_KEY']` | Credential references resolved on each call |
| `patterns` | `true` | Redact private keys and GitHub, GitLab, Slack, AWS, Google, npm, and `sk-` API key formats wherever they appear |
| `minLength` | `8` | Shortest known value redacted; shorter values would match ordinary text |
| `extraNames` | `[]` | Further environment variable names whose values are secrets |

Secrets are read on every call, so a credential stored after startup is covered by the next result. A project `.env` that the harness loads at startup becomes part of its environment, so its credential-named values are redacted as well.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Config, the secret sources, the text redaction, and the `tools/post-execute` listener |

The listener calls the rest of the waterfall first and redacts the decision it gets back: a replaced projection, a blocking listener's feedback, or the result's own content. Known values are replaced longest first, so a value that contains another is replaced whole. Only text blocks change; images and other blocks pass through.

No runtime invariant companion is published: the listener holds no state between calls.

</details>

<a id="model-experience"></a>
## Model Experience

### Redacted results

#### What the model sees

A secret in a tool result appears as `[redacted: <name>]`, where the name is the environment variable, credential reference, stored record, or token format, never the value. A result without secrets is unchanged. The package adds no prompt text and no tool.

#### Token effect

A redaction is usually shorter than the secret it replaces; results without secrets cost the same.

#### KV Cache effect

None: a result is redacted once, before it enters history, and is never rewritten afterwards.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only text the harness can recognize is redacted** — a credential with no credential-shaped name and no known format, such as a password inside a file, passes through; [protected paths](../../sandbox/sandbox-policy/README.md) keep the common credential stores unreadable instead.
- **A value replacement from another listener is not seen** — the registry renders content from a replaced value after this listener runs.
- **A model that reads a file with a redacted value and writes it back writes the placeholder** — redaction changes what the model sees, not the file.
- **Arguments the model sends are not redacted** — a secret the model types into a call reaches that tool.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
