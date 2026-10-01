---
description: "mcpServers Remote 无需手工编辑文件，即可在当前 profile 补丁中列出、添加、编辑、启用和删除 MCP 服务器行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-controller

[English](README.md) | 中文

## 概述

`mcpServers` Remote 让 UI 管理当前 profile 的 `cordis.patch.yml` 中的 `@deepseek-ai/dsh-mcp-client` 行。每次写入都会保留注释和未托管的键；profile 支持热重载时通过热重载生效，重载失败则恢复文件。密钥以环境变量引用的形式写入，且不会被返回。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

[web bundle](../../bundle/web-app/README.zh.md) 将控制器挂载为 `mcp-servers-controller`；插件页面使用它。自定义 profile 需在 Loader、`app-boot` 的 profile 上下文（以及最好是 HMR）之后挂载 `@deepseek-ai/dsh-api-mcp-controller`。

| 方法 | 效果 |
|---|---|
| `list()` | 运行中 profile 的所有 MCP 行，包括来自 bundle、家目录补丁和命令行覆盖的行，附带 `owned`、`readOnlyReason`、`enabled`、实时的 `fiberPhase`，以及挂载[状态服务](../../mcp/mcp-status/README.zh.md)时客户端的 `status`（连接状态、最近错误、尝试次数、工具数）|
| `upsert(spec, { id?, confirmedCommand? })` | 添加 `mcp-<serverName>`，或替换 `id` 所指行中受托管的键 |
| `setEnabled(id, enabled)` | 在 profile 补丁所拥有的行上写入 `disabled` |
| `removeServer(id)` | 删除 profile 补丁所拥有的行 |
| `tools(id)` | 服务器当前提供的工具及其连接状态 |
| `reconnectServer(id)` | 请服务器的客户端立即连接；返回是否开始了尝试 |
| `overview()` | 一次调用返回每一行的连接状态和用量计数，以及读取时的 Host 时钟 |

每次写入都返回 `{ changed, application, target, error?, warnings? }`。`application` 为 `applied` 表示 Loader 已协调该变更，`restart-required` 表示 profile 没有热重载，`failed` 则带有 `error.code`：`invalid-config`、`duplicate-server`、`confirmation-required`、`literal-secret`、`unknown-server`、`read-only`、`unreadable-patch` 或 `operation-error`。失败的变更会让补丁文件保持原样。

stdio 服务器会以 Host 的权限运行命令。在 `confirmedCommand` 等于 Host 在 `confirmation-required` 错误中报告的命令行之前，`upsert` 拒绝添加或修改 stdio 服务器，因此调用方必须先把这段完全相同的文本展示给用户。

### 密钥

`env` 或 `headers` 的值可以是字面量、环境变量引用（`{ kind: 'env', name, scheme? }`，写为 `!!js process.env.NAME` 或 `Bearer` 模板）、文件中已有的 `expression`，或 `kept`。环境变量引用必须指向保存变更时 Host 环境中已设置的变量：Loader 会拒绝 `env` 值未定义的配置，`Bearer` 请求头则会发送文本 `undefined`，因此 `upsert` 会以 `invalid-config` 拒绝。形似凭证的键下的字面量会以 `literal-secret` 被拒绝（`env` 为 `KEY`、`PASSWORD`、`SECRET`、`TOKEN`；`headers` 除这些外还有 `authorization`、`cookie`），含用户名或密码的 URL 同样被拒绝。当手写文件中已存在此类字面量时，`list` 以 `kept` 代替返回，`upsert` 接受 `kept` 以保持已存储的值不变。`expression` 仅在与同一键下已存储的源码一致时才被接受，因此客户端无法提交代码。URL 内嵌凭证的行会以 `embedded-credentials` 只读列出，并显示不含凭证的 URL。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Remote：由分层补丁组合出各行，将写入与 HMR 和 profile 文件锁串行化，重载失败时回滚 |
| [`src/patch.ts`](src/patch.ts) | 对 YAML AST 做文本到文本的编辑，保留注释、未托管的键和 `!!js` 标签 |
| [`src/spec.ts`](src/spec.ts) | 凭证规则、`mcp-client` 的 Config schema 与加载时检查，以及脱敏 |
| [`src/types.ts`](src/types.ts) | 与客户端共享的记录 |

控制器只编辑 profile 补丁所插入的行。来自 bundle、家目录补丁和覆盖文件的行以只读方式列出，因为编辑 profile 补丁并不会改变其生效值。校验在检查写入时才导入 `@deepseek-ai/dsh-mcp-client`，因此没有该包的 profile 会以 `invalid-config` 使写入失败，而不是在加载时失败。写入之后，控制器会发出 `plugin-manager/changed`，使插件页面刷新。

不发布运行时 invariant 伴生包：各行由 Loader 读取的同一组补丁文件推导而来，没有需要对账的第二个观测值。

</details>

<a id="model-experience"></a>
## 模型体验

无，因为控制器只改变 profile 加载哪些 MCP 服务器，模型通过 [MCP 客户端](../../mcp/mcp-client/README.zh.md#model-experience)看到由此产生的工具和说明。

#### KV Cache effect

添加、删除或重新连接服务器的变更，会按 MCP 客户端所述改变后续请求的工具定义；控制器本身不增加 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 连接状态依赖状态服务：没有它时，行没有 `status`，首次连接失败的已保存服务器仍以 `fiberPhase: 'active'` 列出。
- 只有 profile 补丁所插入的行才能被编辑、启用、禁用或删除；`env` 和 `headers` 之外含有 `!!js` 值的行可以删除或切换启用状态，但不能编辑。
- 表单托管 `transport`、`serverName`、命令或 URL、`args`、`env`、`headers`、`cwd`、`toolCallTimeoutMs` 和 `failOnStartupError`。`reconnect` 等其他键保持文件中的原样。
- 查询字符串中带有令牌的 URL 按输入原样存储，并显示在可编辑的 `spec` 中；列表摘要省略查询部分。
- 没有 HMR 的 profile 在下次启动时才应用变更；此时 `list` 显示该行但没有实时阶段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

[插件页面中的 MCP 服务器](../../../.agents/notes/implemented/feature/2026-10-01-mcp-servers-on-the-plugins-page.zh.md)提案记录了设计和被否决的备选方案。

</details>
