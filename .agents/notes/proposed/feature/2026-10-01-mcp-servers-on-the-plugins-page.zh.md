# Agent Note: 插件页面中的 MCP 服务器

Status: proposed

[English](2026-10-01-mcp-servers-on-the-plugins-page.md) | 中文

## 问题

用户通过在 profile 的 `cordis.patch.yml`、家目录补丁或 `--patch` 覆盖文件中手写 `@deepseek-ai/dsh-mcp-client` 条目来添加 MCP 服务器。[MCP 客户端](../../implemented/feature/2026-07-07-mcp-client-plugin.zh.md)的 schema 没有 `.volatile()` 字段，因此通用的[插件配置表单](../../implemented/architecture/2026-09-16-plugin-configuration-on-the-plugins-page.zh.md)无法编辑它。`ConfigEditor` 只能编辑已有条目的 `config`；没有任何写入路径可以插入或删除条目。客户端只记录连接状态而不对外暴露，因此保存后连接失败的服务器仍显示为活动插件，且没有工具。

## 提案

在侧边栏的插件页面中增加 MCP 区域，用于列出、添加、编辑和删除当前 profile 补丁中的 MCP 服务器。[设置页只保留只读清单](../../implemented/architecture/2026-09-09-plugin-management-in-the-web-sidebar.zh.md)，因此本提案不增加设置页标签。

### Host：`mcpServers` Remote

新增一个 Host 服务，继承 `TypertRemoteService`，命名空间为 `mcpServers`：

- `list` 返回所有活动的 `@deepseek-ai/dsh-mcp-client` 条目：id、`serverName`、传输方式、命令或 URL、启用状态；当该行来自家目录补丁、覆盖文件或 bundle 时，附带只读原因（沿用 `listPlugins` 已有的 `unaddressable` 规则）。
- `upsert` 用 `mcp-client` 的 schema 校验配置，然后插入或替换一行。
- `remove` 删除 profile 补丁所拥有的一行。
- `setEnabled` 通过现有的 `writePluginEnabled` 切换 `disabled`。

行 id 使用前缀 `mcp-<serverName>`。写入使用 `ConfigEditor` 与 `plugin-manager` 已在使用的 `yaml` AST，因此注释和 `!!js` 表达式得以保留。写入在 `withFileLock` 与 `hmr.runExclusive` 下执行，协调失败时回滚文件，并报告变更是已应用还是需要重启（未启用 HMR 的 profile）。插入和删除是新增原语；对已有条目的编辑由 `ConfigEditor.edit` 处理。

### 客户端：伴生包

新增仅客户端的包 `ui-plugin-mcp-servers`，注册到 `plugins.item`，参照 `ui-settings-web-search`，提供服务器列表以及每种传输方式各自的添加/编辑对话框。所有文案位于 `locales.ts`。该包挂载在 `packages/bundle/web-app/cordis.patch.yml` 中，紧邻 `ui-plugin-manager`。

### 密钥

表单只接受环境变量引用。对于 `env` 和 `headers` 的值，写入 `!!js process.env.NAME`（或 `Bearer` 模板形式），从不存储或返回明文密钥。`mcp-client` 的凭据引用支持不在范围内。

### 信任门禁

stdio 条目会以 Host 权限运行任意命令。Remote 在写入 stdio 行之前，要求对命令行进行显式确认，对话框展示完整命令。

### 首次变更的范围之外

实时连接状态需要在 `mcp-client` 中新增可观察服务、一个 Remote 方法，以及 `remote-events.ts` 中的条目。它作为单独的变更交付；在此之前，列表仅显示插件阶段，且对话框说明保存成功并不代表服务器已连接。

## 备选方案

**设置页标签。** `settings.plugins.tab` 插槽允许这样做。否决：插件配置有意迁移到插件页面，第二个入口会分散可发现性。

**在 `plugin-manager` 上增加通用的添加/删除 Remote。** 暂不采用：这会使本已庞大的服务继续膨胀，获得对任意条目的通用权限，且从 GUI Remote 修改 profile 的代码加载目前没有类似 `danger-full-access` 的门禁。

**在单个 hub 插件上使用 `mcpServers: McpServerSpec[]` 配置。** 否决：这会破坏所有现有的按条目配置，需要升级指南，并放弃按服务器隔离的 HMR。

**将 `mcp-client` 字段改为 `.volatile()`。** 否决：`apply` 只读取一次配置，volatile 字段会使编辑后不再重新连接，且配置是以 `transport` 为键的联合类型。

## 验收标准

- 在页面中添加服务器会向 profile 补丁写入一行 `mcp-<serverName>`，保留已有注释和 `!!js` 值；启用 HMR 时无需重启即可看到该服务器的工具，未启用 HMR 时对话框报告需要重启。
- 重复的 `serverName`、无效的 URL 和超出范围的超时值在任何文件写入之前被拒绝，文件保持不变。
- 协调失败会恢复之前的文件。
- 来自覆盖文件、家目录补丁和 bundle 的行以只读方式列出并附带原因。
- 任何响应、事件或日志行都不包含明文密钥。
- 格式错误的补丁文件永远不会被覆盖。
- 客户端每个文件的覆盖率为 100%；一个 web e2e 测试通过真实 Remote 完成添加、编辑、禁用和删除；`verify-client-ui-i18n` 通过。

## 风险

- **明文值。** 用户仍可在 `args` 或 `command` 中键入明文令牌；文件权限为 0600，但未加密。
- **首次变更不含连接状态。** 用户无法从页面看出服务器是否已连接。
- **仅 web-app bundle。** 插件页面只挂载在 web-app bundle 中，不使用它的启动器没有 MCP 页面。
- **流程成本。** 新增 Remote 会重新生成 API 汇总文件，变更还需要中英文文档、PR 中的 GIF，以及在行 id 前缀规则影响现有条目时的升级指南。
