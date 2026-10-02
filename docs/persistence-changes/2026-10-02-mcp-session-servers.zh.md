---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-02-mcp-session-servers

[English](2026-10-02-mcp-session-servers.md) | 中文

## 概述

新增 mcp/servers 会话事件，记录会话为自己选择的 MCP 服务器。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

该事件为新增事件，已有记录不变。没有该事件的会话使用配置为默认启用的服务器，因此已有日志的行为不变。该事件在读取时为必需：不识别它的构建会拒绝包含它的日志。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/mcp/mcp-selection：16 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
