// Web e2e scenario: the MCP servers page on the Plugins page, through the real
// wire down to the MCP manager's Settings entry. A server is added, confirmed,
// tested, disabled, edited, and removed from the browser, and the Host's Settings
// view is read back after each step. Zero model calls: everything is client state
// plus the profile settings on a blank frame, so there is no fixture and a stray
// stream would fail loud.
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-mcp-selection'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

/** The official reference MCP server, installed for the mcp-client package's own tests. */
const EVERYTHING = fileURLToPath(new URL('../../../packages/mcp/mcp-client/node_modules/.bin/mcp-server-everything', import.meta.url))

/** A Session with history: the composer dock, where the status item lives, renders only in a conversation. */
const SESSION_TITLE = 'MCP status session'
const SEEDED_HISTORY = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))

describe('web e2e: MCP servers page', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionId: SessionId

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
    })
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    sessionId = await seedSession(scaffold, await readFile(SEEDED_HISTORY, 'utf8'), 'mcp-status-session')
    await workspace.attachSession(sessionId)
    await scaffold.ctx.sessionController.rename({ sessionId, title: SESSION_TITLE })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** The profile patch as the Host has written it so far. */
  async function patch(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8').catch(() => '')
  }

  /** One profile entry's user section, as the Host's Settings view reports it. */
  function userSection(ns: string): Record<string, unknown> {
    const user = scaffold.ctx.settings.describe().find(row => row.ns === ns)?.user
    return typeof user === 'object' && user !== null ? user as Record<string, unknown> : {}
  }

  /** The MCP manager's user-layer server entries. */
  function servers(): Record<string, Record<string, unknown>> {
    return (userSection('mcp-manager').servers ?? {}) as Record<string, Record<string, unknown>>
  }

  /** Open the MCP servers page from the Plugins panel's Official group. */
  async function openPage(): Promise<Locator> {
    await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true }).click()
    const panel = page.locator('[data-plugin-panel]')
    await panel.waitFor({ timeout: 10_000 })
    while (await panel.getByRole('button', { name: /^返回/ }).count() > 0) {
      await panel.getByRole('button', { name: /^返回/ }).first().click()
    }
    await panel.getByRole('button', { name: '查看 MCP 服务器', exact: true }).click()
    await panel.locator('[data-plugin-config]').waitFor({ timeout: 10_000 })
    return panel
  }

  it('starts empty and adds an HTTP server whose token goes to the credentials store', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-add-http'))
    const panel = await openPage()
    await panel.getByText('尚未配置 MCP 服务器。', { exact: true }).waitFor({ timeout: 10_000 })

    await panel.getByRole('button', { name: '添加服务器', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加 MCP 服务器' })
    await dialog.getByLabel('名称', { exact: true }).fill('web')
    await dialog.getByRole('tab', { name: 'HTTP 端点' }).click()
    await dialog.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:9/mcp')
    await dialog.getByRole('button', { name: '添加一项', exact: true }).click()
    await dialog.getByLabel('条目名称').fill('Authorization')
    await dialog.getByLabel('取值类型').selectOption('bearer')
    // The form proposes a credential name from the server and header names.
    expect(await dialog.getByLabel('凭据名称', { exact: true }).inputValue()).toBe('MCP_WEB_AUTHORIZATION')
    await dialog.getByText('未设置', { exact: true }).waitFor({ timeout: 10_000 })
    await dialog.getByLabel('密钥值', { exact: true }).fill('e2e-only-value')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.waitFor({ state: 'detached', timeout: 15_000 })

    await expect.poll(() => servers().web, { timeout: 15_000 }).toMatchObject({
      transport: 'streamable-http', url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer ${credential:MCP_WEB_AUTHORIZATION}' },
    })
    // The secret itself went to the credentials store, never to the profile.
    expect(await patch()).not.toContain('e2e-only-value')
    const row = panel.getByRole('listitem').filter({ hasText: 'web' })
    await row.getByText('HTTP 端点', { exact: true }).waitFor({ timeout: 10_000 })
    // Nothing listens on that port, so the manager reports the failed attempt.
    await row.getByText(/^(重连中|未连接)/).first().waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('refuses a malformed credential name before writing anything', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-credential-name'))
    const panel = await openPage()
    const before = JSON.stringify(servers())
    await panel.getByRole('button', { name: '添加服务器', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加 MCP 服务器' })
    await dialog.getByLabel('名称', { exact: true }).fill('leaky')
    await dialog.getByRole('tab', { name: 'HTTP 端点' }).click()
    await dialog.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:9/leaky')
    await dialog.getByRole('button', { name: '添加一项', exact: true }).click()
    await dialog.getByLabel('条目名称').fill('X-Key')
    await dialog.getByLabel('取值类型').selectOption('credential')
    await dialog.getByLabel('凭据名称', { exact: true }).fill('9-not-a-name')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.getByRole('alert').getByText('凭据名称只能使用', { exact: false }).waitFor({ timeout: 10_000 })
    expect(JSON.stringify(servers())).toBe(before)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  }, 60_000)

  it('shows the manager\'s reason when it refuses an entry, in view beside the buttons', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-refused'))
    const panel = await openPage()
    const before = JSON.stringify(servers())
    await panel.getByRole('button', { name: '添加服务器', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加 MCP 服务器' })
    await dialog.getByLabel('名称', { exact: true }).fill('broken')
    await dialog.getByRole('tab', { name: 'HTTP 端点' }).click()
    await dialog.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:9/broken')
    await dialog.getByRole('button', { name: '添加一项', exact: true }).click()
    await dialog.getByLabel('条目名称').fill('X-Api-Version')
    // Text that looks like a template but is not one: the manager refuses it at the write.
    await dialog.getByLabel('值', { exact: true }).fill('${credential:}')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    const alert = dialog.getByRole('alert')
    await alert.getByText('servers.broken', { exact: false }).waitFor({ timeout: 10_000 })
    expect(await alert.isVisible()).toBe(true)
    expect(JSON.stringify(servers())).toBe(before)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  }, 60_000)

  it('shows the exact command and requires trust before saving a local server', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-confirm'))
    const panel = await openPage()
    await panel.getByRole('button', { name: '添加服务器', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加 MCP 服务器' })
    await dialog.getByLabel('名称', { exact: true }).fill('files')
    await dialog.getByLabel('命令', { exact: true }).fill('mcp-e2e-missing')
    await dialog.getByLabel('参数', { exact: true }).fill('--root\n/tmp')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()

    const confirm = page.getByRole('dialog', { name: '运行此命令？' })
    await confirm.getByText('mcp-e2e-missing --root /tmp', { exact: true }).waitFor({ timeout: 10_000 })
    const action = confirm.getByRole('button', { name: '保存服务器', exact: true })
    expect(await action.isDisabled()).toBe(true)
    expect(await patch()).not.toContain('mcp-e2e-missing')
    await confirm.getByLabel('我信任此命令').check()
    await action.click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15_000 })

    await expect.poll(() => servers().files, { timeout: 15_000 }).toMatchObject({
      transport: 'stdio', command: 'mcp-e2e-missing', args: ['--root', '/tmp'],
    })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('disables, edits, and removes a server, reading the file after each step', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-manage'))
    const panel = await openPage()
    const row = panel.getByRole('listitem').filter({ hasText: 'web' }).first()

    await row.getByRole('switch', { name: '启用 web' }).click()
    await expect.poll(() => servers().web?.enabled, { timeout: 15_000 }).toBe(false)
    await row.getByText('已关闭', { exact: true }).waitFor({ timeout: 15_000 })
    await row.getByRole('switch', { name: '启用 web' }).click()
    await expect.poll(() => servers().web?.enabled, { timeout: 15_000 }).toBe(true)

    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑 MCP 服务器' })
    expect(await dialog.getByLabel('名称', { exact: true }).inputValue()).toBe('web')
    // The stored credential is reported, and the field offers to keep it.
    await dialog.getByText('已存储', { exact: true }).waitFor({ timeout: 10_000 })
    await dialog.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:9/changed')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(() => servers().web, { timeout: 15_000 }).toMatchObject({
      url: 'http://127.0.0.1:9/changed', headers: { Authorization: 'Bearer ${credential:MCP_WEB_AUTHORIZATION}' },
    })

    await row.getByRole('button', { name: '移除', exact: true }).click()
    const removal = page.getByRole('dialog', { name: '移除此服务器？' })
    await removal.getByRole('button', { name: '移除服务器', exact: true }).click()
    await removal.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(() => Object.keys(servers()), { timeout: 15_000 }).toEqual(['files'])
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('reports a real server as connected and shows its tools with expandable help', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-tools'))
    const panel = await openPage()
    await panel.getByRole('button', { name: '添加服务器', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加 MCP 服务器' })
    await dialog.getByLabel('名称', { exact: true }).fill('everything')
    await dialog.getByLabel('命令', { exact: true }).fill(EVERYTHING)
    await dialog.getByLabel('参数', { exact: true }).fill('stdio')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '运行此命令？' })
    await confirm.getByLabel('我信任此命令').check()
    await confirm.getByRole('button', { name: '保存服务器', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15_000 })

    const row = panel.getByRole('listitem').filter({ hasText: 'everything' }).first()
    await row.getByText('已连接', { exact: true }).waitFor({ timeout: 60_000 })
    await row.getByRole('button', { name: /^工具（\d+）$/ }).click()

    const tools = page.getByRole('dialog', { name: 'everything 的工具' })
    const echo = tools.getByText('mcp__everything__echo', { exact: true })
    await echo.waitFor({ timeout: 10_000 })
    const details = tools.locator('details').filter({ has: page.getByText('mcp__everything__echo', { exact: true }) })
    expect(await details.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false)
    await echo.click()
    expect(await details.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true)
    await details.getByRole('columnheader', { name: '参数' }).waitFor()
    await details.getByText('message', { exact: true }).waitFor()

    // Calls ask first by default; this tool is allowed outright, and the profile patch records it.
    const mode = details.getByLabel('模型调用此工具时')
    expect(await mode.inputValue()).toBe('inherit')
    await mode.selectOption('allow')
    await expect.poll(() => userSection('mcp-policy').servers, { timeout: 15_000 }).toMatchObject({ everything: { tools: { echo: 'allow' } } })
    await expect.poll(() => details.locator('summary').textContent(), { timeout: 10_000 }).toContain('允许')

    await tools.getByLabel('筛选工具').fill('zzz-no-such-tool')
    await tools.getByText('没有匹配筛选条件的工具。').waitFor()
    await tools.getByLabel('筛选工具').fill('echo')
    await tools.getByText('mcp__everything__echo', { exact: true }).waitFor()
    await tools.getByRole('button', { name: '关闭', exact: true }).last().click()
    await tools.waitFor({ state: 'detached' })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('shows why a server that cannot connect is not connected, restarts it on request, and tests it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-failed-state'))
    const panel = await openPage()
    const row = panel.getByRole('listitem').filter({ hasText: 'files' }).first()
    // `mcp-e2e-missing` does not exist, so every attempt fails and the row says so.
    await row.getByText(/^(重连中|未连接)/).first().waitFor({ timeout: 30_000 })
    await row.getByRole('button', { name: '重新连接', exact: true }).waitFor()
    await row.getByRole('button', { name: '重新连接', exact: true }).click()
    await row.getByText(/^(连接中|重连中|未连接)/).first().waitFor({ timeout: 30_000 })

    // A test connects apart from the running instance and reports the stage that failed.
    await row.getByRole('button', { name: '测试', exact: true }).click()
    const probe = page.getByRole('dialog', { name: '测试 files' })
    await probe.getByRole('alert').waitFor({ timeout: 30_000 })
    await probe.getByRole('button', { name: '关闭', exact: true }).last().click()
    await probe.waitFor({ state: 'detached' })
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('selects the servers one session uses from the composer and the status panel, and offers the selector on a new session', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-session-selection'))
    const session = page.getByRole('treeitem').filter({ has: page.getByText(SESSION_TITLE, { exact: true }) })
    await session.click({ timeout: 20_000 })
    const chip = page.getByRole('button', { name: /^本会话使用的 MCP 服务器：/ })
    await chip.waitFor({ timeout: 20_000 })
    // Both configured servers are on for new sessions, and this session has chosen nothing.
    await expect.poll(() => chip.textContent(), { timeout: 20_000 }).toBe('MCP 2/2')
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('the seeded session has no live agent')
    const everythingTools = (): string[] =>
      scaffold.ctx.tools.schemas(agent).map(tool => tool.name).filter(name => name.startsWith('mcp__everything__'))
    expect(everythingTools()).toContain('mcp__everything__echo')

    await chip.click()
    const menu = page.getByRole('menu')
    await menu.getByText('本会话使用的 MCP 服务器', { exact: true }).waitFor()
    await menu.getByRole('menuitem', { name: 'everything', exact: true }).click()
    // The list stays open, and the session's next request carries none of the server's tools.
    await expect.poll(() => chip.textContent(), { timeout: 10_000 }).toBe('MCP 1/2')
    await expect.poll(() => scaffold.ctx.mcpSelection.active(agent.session), { timeout: 10_000 }).toEqual(['files'])
    expect(everythingTools()).toEqual([])
    expect(await menu.isVisible()).toBe(true)
    const refused = await executeToolFixture(scaffold.ctx, {
      name: 'mcp__everything__echo', arguments: { message: 'hidden' }, callId: ToolCallId('mcp-deselected'),
      signal: new AbortController().signal, agent,
    })
    expect(refused).toMatchObject({ isError: true, error: { info: { code: 'UNKNOWN_TOOL' } } })
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })

    // The status panel's switch turns the server back on for this session.
    await page.getByRole('button', { name: /^MCP 服务器：/ }).click()
    const panel = page.getByRole('dialog', { name: 'MCP 服务器', exact: true })
    const use = panel.getByRole('switch', { name: '在本会话中使用 everything' })
    await expect.poll(() => use.getAttribute('aria-checked'), { timeout: 10_000 }).toBe('false')
    await use.click()
    await expect.poll(() => scaffold.ctx.mcpSelection.active(agent.session), { timeout: 10_000 }).toEqual(['files', 'everything'])
    await expect.poll(() => chip.textContent(), { timeout: 10_000 }).toBe('MCP 2/2')
    expect(everythingTools()).toContain('mcp__everything__echo')
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached' })

    // A new session offers the same selector before its first prompt.
    await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
    const fresh = page.getByRole('button', { name: /^本会话使用的 MCP 服务器：/ })
    await fresh.waitFor({ timeout: 20_000 })
    await expect.poll(() => fresh.textContent(), { timeout: 20_000 }).toBe('MCP 2/2')
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('shows the status item below the prompt box with per-server stats, and hides it from the preference switch', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-status-item'))
    // Two real calls through the Host's tool registry, so the counters have something to show without a model.
    for (const callId of ['mcp-status-1', 'mcp-status-2']) {
      const result = await executeToolFixture(scaffold.ctx, {
        name: 'mcp__everything__echo', arguments: { message: 'counted' }, callId: ToolCallId(callId), signal: new AbortController().signal,
      })
      expect(result.isError).not.toBe(true)
    }
    // The item lives in the composer dock, which a conversation renders.
    const session = page.getByRole('treeitem').filter({ has: page.getByText(SESSION_TITLE, { exact: true }) })
    await session.click({ timeout: 20_000 })

    const trigger = page.getByRole('button', { name: /^MCP 服务器：/ })
    await trigger.waitFor({ timeout: 20_000 })
    // `everything` is connected; `files` names a command that does not exist.
    await expect.poll(() => trigger.textContent(), { timeout: 20_000 }).toBe('MCP 1/2')
    await trigger.click()
    const panel = page.getByRole('dialog', { name: 'MCP 服务器', exact: true })
    await panel.getByText('2 个中已连接 1 个', { exact: true }).waitFor({ timeout: 10_000 })
    const everything = panel.getByRole('listitem').filter({ hasText: 'everything' }).first()
    await everything.getByText('已连接', { exact: true }).waitFor()
    // Calls, errors as this session / all sessions: the two echo calls above ran outside any session, and none failed.
    await expect.poll(() => everything.locator('dd').nth(0).textContent(), { timeout: 10_000 }).toBe('0 / 2')
    expect(await everything.locator('dd').nth(1).textContent()).toBe('0 / 0')
    await panel.getByText('本会话', { exact: true }).waitFor()
    await panel.getByText('全部会话', { exact: true }).waitFor()
    await everything.getByText('详情', { exact: true }).click()
    await everything.getByText('本地命令', { exact: true }).waitFor()
    await everything.getByText('已连接时长', { exact: true }).waitFor()
    await everything.getByText('最常用的工具', { exact: true }).waitFor()
    await everything.getByText('echo', { exact: true }).waitFor()
    await panel.getByText(/^工具定义: 每次请求约 .+ Token$/).waitFor()
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached' })

    const plugins = await openPage()
    const toggle = plugins.getByRole('switch', { name: '在输入框下方显示 MCP 状态' })
    expect(await toggle.getAttribute('aria-checked')).toBe('true')
    await toggle.click()
    await expect.poll(patch, { timeout: 15_000 }).toContain('statusItem: false')
    await expect.poll(() => toggle.getAttribute('aria-checked'), { timeout: 10_000 }).toBe('false')

    await session.click()
    await page.locator('[data-composer-input]').first().waitFor({ timeout: 15_000 })
    await expect.poll(() => page.getByRole('button', { name: /^MCP 服务器：/ }).count(), { timeout: 10_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
