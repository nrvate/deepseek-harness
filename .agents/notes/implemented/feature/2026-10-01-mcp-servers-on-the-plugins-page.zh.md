# Agent Note: 插件页面中的 MCP 服务器

Status: implemented

[English](2026-10-01-mcp-servers-on-the-plugins-page.md) | 中文

## 问题

用户通过在 profile 的 `cordis.patch.yml`、家目录补丁或 `--patch` 覆盖文件中手写 `@deepseek-ai/dsh-mcp-client` 条目来添加 MCP 服务器。[MCP 客户端](../../archived/feature/2026-07-07-mcp-client-plugin.md)的 schema 没有 `.volatile()` 字段，因此通用的[插件配置表单](../../archived/architecture/2026-09-16-plugin-configuration-on-the-plugins-page.md)无法编辑它。`ConfigEditor` 只能编辑已有条目的 `config`；没有任何写入路径可以插入或删除条目。客户端曾只记录连接状态而不对外暴露，因此保存后连接失败的服务器仍显示为活动插件，且没有工具。

## 决策

**插件页面列出、添加、编辑、启用、停用和删除当前 profile 补丁中的 MCP 服务器。**[设置页只保留只读清单](../../archived/architecture/2026-09-09-plugin-management-in-the-web-sidebar.md)，因此该页面是官方分组中的一个 `plugins.item` 条目，而不是设置页标签。

**所有写入由 Host 的 `mcpServers` Remote 负责。** `@deepseek-ai/dsh-api-mcp-controller` 继承 `TypertRemoteService`，提供 `list`、`upsert`、`setEnabled` 和 `removeServer`：

- `list` 由分层补丁组合出运行中 profile 的所有 MCP 行，并标出每行归 profile 补丁所有，还是只读（`unaddressable`、`custom-expression`、`embedded-credentials`）。
- 写入通过编辑 `cordis.patch.yml` 的 YAML AST 来插入、替换或删除一行，因此注释、`reconnect` 等未托管的键以及 `!!js` 标签得以保留。写入在 profile 文件锁和 `hmr.runExclusive` 下执行，报告 `applied` 或 `restart-required`，并在重载失败时恢复文件。新行的 id 为 `mcp-<serverName>`。
- 配置用 `mcp-client` 的 Config schema 和插件的加载时检查来校验，因此插件在加载时拒绝的内容，控制器在保存时就会拒绝。
- 每次写入都会发出 `plugin-manager/changed`，插件页面本来就会据此刷新。

**密钥是环境变量引用，且从不离开 Host。** 值可以是字面量、写成 `!!js process.env.NAME`（或 `Bearer` 模板）的环境变量引用、文件中已有的 `expression`，或 `kept`。环境变量引用必须指向保存变更时已设置的变量，因为未定义的 `env` 值会使插件拒绝其配置，而 `Bearer` 请求头会发送 `undefined`。形似凭证的名称下的字面量，以及含用户名或密码的 URL，都会以 `literal-secret` 被拒绝。已存储的字面量以 `kept` 返回，发送 `kept` 时保持原值。`expression` 仅在与该键下已存储的源码一致时才被接受，因此无法借 Remote 提交代码。列表摘要省略 URL 中的凭证和查询部分。

**只有用户信任了确切的命令之后，stdio 服务器才会被保存。** 第一次 `upsert` 返回 `confirmation-required` 以及 Host 的命令行；客户端显示这段文本，并以它作为 `confirmedCommand` 重复调用。Host 比较两者，因此用户读到的文本就是 Host 校验的文本。

**连接状态来自共享的状态服务。** `@deepseek-ai/dsh-mcp-status` 是一个 Cordis 服务，由 base bundle 像 `mcp-resources` 一样挂载一次，每个 `mcp-client` 向其中注册一个实时 handle：它的状态（连接中、已连接、带尝试次数的重连中、已失败）、最近错误、工具列表以及立即重连的操作。handle 读取监督器自己的变量，因此服务不保存可能与连接不一致的副本。变化会触发 `mcp-status/changed`，控制器把一阵连续的变化合并为一次防抖的 `plugin-manager/changed`，插件页面本来就会据此刷新。`list` 为每行附上状态，`tools` 返回服务器的工具，`reconnectServer` 请客户端立即连接。

**工具对话框是只读的帮助。** 它按模型看到的名称列出每个工具，提供筛选框，以及可展开的原生行，显示说明和由工具输入 schema 推导出的参数表。

**用量计数通过同一个 handle 提供，并由状态项显示。** 每个客户端统计自己的工具调用次数、失败次数、调用耗时，以及估算的输入和输出 Token 数（按每 Token 四个字符的文本长度计算，与上下文用量表采用的密度相同），还有其工具定义为每次请求增加的估算 Token 数。`overview` 一次调用返回所有服务器的状态和计数。`conversation.composer.dock` 中的一个条目显示已启用服务器中已连接的数量，并可打开这些数据的面板。计数随每次调用变化，因此不触发事件，面板只在打开期间轮询。该项默认开启，MCP 服务器页上的开关可将其关闭；这一偏好是伴生包 Host 部分的一个实时设置字段，与主题和聊天偏好采用的机制相同。

**浏览器部分是伴生包。** `@deepseek-ai/dsh-client-ui-settings-mcp-servers` 沿用其他 `ui-settings-*` 伴生包的做法：空的 Host `apply`、一个 `plugins.item` 条目和一份词典。它注入 `remote.mcpServers`，因此在没有该控制器的地方不会出现。结果提示注册到 `shell.overlay`，使其在插件面板关闭后依然存在。

## 备选方案

**设置页标签。** `settings.plugins.tab` 插槽允许这样做。否决：插件配置有意迁移到插件页面，第二个入口会分散可发现性。

**在 `plugin-manager` 上增加通用的添加和删除 Remote。** 否决：这会使本已庞大的服务继续膨胀，获得对任意条目的通用权限，且从 GUI Remote 修改 profile 的代码加载目前没有类似 `danger-full-access` 的门禁。

**在单个 hub 插件上使用 `mcpServers: McpServerSpec[]` 配置。** 否决：这会破坏所有现有的按条目配置，需要升级指南，并放弃按服务器隔离的 HMR。

**将 `mcp-client` 字段改为 `.volatile()`。** 否决：`apply` 只读取一次配置，volatile 字段会使编辑后不再重新连接，且配置是以 `transport` 为键的联合类型。

**由 `mcp-client` 解析凭据引用。** 暂缓：这是超出本界面的包级变更，而环境变量引用不需要它。

## 后果

用户无需编辑文件即可管理服务器，且每次写入都由插件加载时使用的同一套 schema 校验。没有挂载状态服务的地方，插件启动后该行显示**已加载**，且不显示连接状态。连接错误按 SDK 或传输层的原样显示，未经本地化。

用户仍可在 `args` 或 `command` 中键入明文令牌；文件权限为 0600，但未加密。查询字符串中带有令牌的 URL 按输入原样存储并显示在可编辑的 spec 中，而列表摘要省略查询部分。

用量计数以 Host 进程为单位：重启时清零，且 Token 数为估算值。[按会话选择](2026-10-02-per-session-mcp-server-selection.zh.md)把每次调用归属到它的会话。状态项只在对话有了消息之后才出现，因为空白会话的起始界面不渲染输入框下方的区域。

插件页面只挂载在 web-app bundle 中，不使用它的启动器没有 MCP 页面。来自 bundle、家目录补丁和覆盖文件的行会列出，但不能在此更改。

## 测试

`packages/api/mcp-controller/tests` 启动真实的 profile Include、Loader 和热重载，配合一个桩客户端插件，并在每次操作后断言补丁文件，包括回滚和拒绝。`packages/client/ui-settings-mcp-servers/tests` 通过真实控制器，在脚本化的 Remote 上驱动页面。`apps/web/tests/mcp-servers.e2e.ts` 在浏览器中针对真实 Host 运行页面，并回读补丁文件。
