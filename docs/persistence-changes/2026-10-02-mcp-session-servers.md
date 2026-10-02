---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-02-mcp-session-servers

English | [中文](2026-10-02-mcp-session-servers.zh.md)

## Summary

Adds the mcp/servers Session event, which records the MCP servers a Session selected for itself.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-mcp-session-servers
baseline: false
changes:
  - root: "event:mcp/servers"
    previous: null
    after: "4f94ea39cdc082c34c58d81bcf837bd62faf8440b9025a485f244ad80e0b526e"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The event is new and no existing record changes. A Session without it uses the servers configured as active by default, so every existing log keeps its behavior. The event is required on read: a build that does not know it refuses a log that contains it.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/mcp/mcp-selection: 16 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
