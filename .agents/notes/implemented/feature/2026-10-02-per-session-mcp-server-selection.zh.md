# Agent Note: 按会话选择 MCP 服务器

Status: implemented

[English](2026-10-02-per-session-mcp-server-selection.md) | 中文

## 问题

每个已配置的 [MCP 服务器](2026-10-01-mcp-servers-on-the-plugins-page.zh.md)都会到达每个会话。每个服务器都把它的工具定义和指令加入每次模型请求，因此只需要一个服务器的会话要为全部服务器付出开销。去掉某个服务器的唯一办法是停用它的条目，而这会让它同时从所有会话中消失。

## 决策

已配置的服务器对每个会话可用，每个会话使用其中一部分。`@deepseek-ai/dsh-mcp-selection` 以 `ctx.mcpSelection` 拥有这一选择。

**选择是会话状态。** 一条 `mcp/servers` 事件携带完整的 `active` 列表，`mcpServers` 投影折叠最后一条。因此模型请求的工具集可以从日志重建。该事件在读取时为必需：不识别它的构建会拒绝该日志，因为跳过它会改变提供给模型的内容。

**没有该事件的会话遵循各服务器的默认值。** `mcp-client` 新增 `defaultActive`（默认 `true`），因此 headless、SDK 和 ACP 会话的行为与之前相同，用户也可以保留一个很少使用的服务器的配置，但让它对新会话关闭。已记录的列表与当前配置的服务器进行匹配；之后添加的服务器对已经做过选择的会话保持关闭。

**强制执行依靠工具注册表的限制。** 服务为每个 agent 创建一个作用域，并拒绝会话未使用的每个服务器的公开工具名称。注册表唯一的解析器供给 schema、查找、执行和 PTC 绑定，因此被拒绝的工具不出现在请求中，直接调用会返回 `UNKNOWN_TOOL`。`mcp-client` 和 `mcp-resources` 在服务器指令、服务器名称小节和资源请求处询问 `isActive`；不使用任何服务器的会话看不到共享资源工具。

**子会话复制父会话已记录的选择**，在委派时与沙箱和权限种子一起写入，因此子会话使用父会话所选的服务器。

**GUI 通过同一个 Remote 方法提供两个控件。** `mcpServers.setSessionServers` 接收完整列表。输入框工具行在模型选择器之前有一个选择器，使用与模型选择器相同的尾部勾选标记，在新会话界面和对话中都会显示。状态面板为每个服务器提供一个开关。用量计数也归属到发起调用的会话，面板并列显示本会话和全部会话。

## 备选方案

**为每个会话单独连接服务器。** 否决：stdio 服务器会在每个会话启动一次，连接、重试预算和状态都会成倍增加。选择只需要控制可见性。

**在提示词组装监听器中过滤工具 schema。** 否决：直接调用或 PTC 调用仍能到达该工具。注册表限制在执行时拒绝。

**所有服务器默认需要手动启用。** 否决：现有 profile 和所有非 GUI 启动方式在升级后会失去 MCP 工具。

**把选择保存在客户端存储或设置中。** 否决：该选择会改变模型可见的输入，因此必须写入会话日志。

## 后果

更改选择会改变会话下一次请求的工具 schema 和系统提示，并开始新的缓存前缀。更早的工具调用在其定义消失后仍留在历史中。

重命名服务器会使它从指名它的已记录选择中消失。正在运行的子会话不会跟随父会话之后的更改。agent 作用域内的服务器与全局服务器按相同名称选择。

计数仍以 Host 进程为单位；没有 agent 的调用只计入合计。

## 测试

`packages/mcp/mcp-selection/tests` 用 mock adapter 运行真实的 agent loop，断言每次模型请求的工具集、`UNKNOWN_TOOL` 拒绝、已记录的事件以及限制的清理。`packages/mcp/mcp-client/tests` 和 `packages/mcp/mcp-resources/tests` 覆盖按会话的计数、被隐藏的指令和被拒绝的资源请求。`packages/subagent/subagent/tests/continuation-inheritance.spec.ts` 覆盖委派种子。`packages/api/mcp-controller/tests` 覆盖 profile 补丁中的 `defaultActive`、`overview(sessionId)` 和 `setSessionServers`。`apps/web/tests/mcp-servers.e2e.ts` 在浏览器中针对真实的 MCP 服务器操作选择器和面板开关，并断言 Host 的工具集。
