// Web e2e scenario: the MCP servers page on the Plugins page, through the real
// wire down to the profile's `cordis.patch.yml`. A server is added, confirmed,
// disabled, edited, and removed from the browser, and the file is read back after
// each step. Zero model calls: everything is client state plus the profile patch on
// a blank frame, so there is no fixture and a stray stream would fail loud.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

/** The official reference MCP server, installed for the mcp-client package's own tests. */
const EVERYTHING = fileURLToPath(new URL('../../../packages/mcp/mcp-client/node_modules/.bin/mcp-server-everything', import.meta.url))

describe('web e2e: MCP servers page', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    // The Host evaluates `process.env` references in its own process, so the referenced variable must exist here.
    process.env.E2E_MCP_TOKEN = 'e2e-only-value'
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    Reflect.deleteProperty(process.env, 'E2E_MCP_TOKEN')
    await browser?.close()
    await scaffold?.close()
  })

  /** The profile patch as the Host has written it so far. */
  async function patch(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8').catch(() => '')
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

  it('starts empty and adds an HTTP server whose token is an environment reference', async () => {
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
    await dialog.getByLabel('值', { exact: true }).fill('E2E_MCP_TOKEN')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.waitFor({ state: 'detached', timeout: 15_000 })

    const saved = await patch()
    expect(saved).toContain('id: mcp-web')
    expect(saved).toContain('serverName: web')
    expect(saved).toContain('url: http://127.0.0.1:9/mcp')
    expect(saved).toContain('Authorization: !!js "`Bearer ${process.env.E2E_MCP_TOKEN}`"')
    const row = panel.getByRole('listitem').filter({ hasText: 'web' })
    await row.getByText('HTTP 端点', { exact: true }).waitFor({ timeout: 10_000 })
    // Nothing listens on that port, so the client reports the failed attempt instead of "loaded".
    await row.getByText(/^(重连中|未连接)/).first().waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('refuses a typed credential and leaves the file as it was', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-secret'))
    const panel = await openPage()
    const before = await patch()
    await panel.getByRole('button', { name: '添加服务器', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加 MCP 服务器' })
    await dialog.getByLabel('名称', { exact: true }).fill('leaky')
    await dialog.getByRole('tab', { name: 'HTTP 端点' }).click()
    await dialog.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:9/leaky')
    await dialog.getByRole('button', { name: '添加一项', exact: true }).click()
    await dialog.getByLabel('条目名称').fill('Authorization')
    await dialog.getByLabel('取值类型').selectOption('literal')
    await dialog.getByLabel('值', { exact: true }).fill('Bearer hunter2')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.getByRole('alert').getByText('不能在此直接输入凭证', { exact: false }).waitFor({ timeout: 10_000 })
    expect(await patch()).toBe(before)
    expect(await patch()).not.toContain('hunter2')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  }, 60_000)

  it('refuses a reference to a variable the harness has not set, in view beside the buttons', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-unset-variable'))
    const panel = await openPage()
    const before = await patch()
    await panel.getByRole('button', { name: '添加服务器', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加 MCP 服务器' })
    await dialog.getByLabel('名称', { exact: true }).fill('unset')
    await dialog.getByRole('tab', { name: 'HTTP 端点' }).click()
    await dialog.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:9/unset')
    await dialog.getByRole('button', { name: '添加一项', exact: true }).click()
    await dialog.getByLabel('条目名称').fill('X-Api-Version')
    await dialog.getByLabel('取值类型').selectOption('env')
    await dialog.getByLabel('值', { exact: true }).fill('E2E_MCP_NEVER_SET')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    const alert = dialog.getByRole('alert')
    await alert.getByText('E2E_MCP_NEVER_SET', { exact: false }).waitFor({ timeout: 10_000 })
    expect(await alert.isVisible()).toBe(true)
    expect(await patch()).toBe(before)
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

    const saved = await patch()
    expect(saved).toContain('id: mcp-files')
    expect(saved).toContain('command: mcp-e2e-missing')
    expect(saved).toContain('- --root')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('disables, edits, and removes a server, reading the file after each step', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-manage'))
    const panel = await openPage()
    const row = panel.getByRole('listitem').filter({ hasText: 'web' }).first()

    await row.getByRole('switch', { name: '启用 web' }).click()
    await expect.poll(patch, { timeout: 15_000 }).toContain('disabled: true')
    await row.getByText('已关闭', { exact: true }).waitFor({ timeout: 15_000 })
    await row.getByRole('switch', { name: '启用 web' }).click()
    await expect.poll(async () => (await patch()).includes('disabled: true'), { timeout: 15_000 }).toBe(false)

    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑 MCP 服务器' })
    expect(await dialog.getByLabel('名称', { exact: true }).inputValue()).toBe('web')
    await dialog.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:9/changed')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await patch()).toContain('url: http://127.0.0.1:9/changed')
    expect(await patch()).toContain('Bearer ${process.env.E2E_MCP_TOKEN}')

    await row.getByRole('button', { name: '移除', exact: true }).click()
    const removal = page.getByRole('dialog', { name: '移除此服务器？' })
    await removal.getByRole('button', { name: '移除服务器', exact: true }).click()
    await removal.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(async () => (await patch()).includes('id: mcp-web'), { timeout: 15_000 }).toBe(false)
    expect(await patch()).toContain('id: mcp-files')
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

    await tools.getByLabel('筛选工具').fill('zzz-no-such-tool')
    await tools.getByText('没有匹配筛选条件的工具。').waitFor()
    await tools.getByLabel('筛选工具').fill('echo')
    await tools.getByText('mcp__everything__echo', { exact: true }).waitFor()
    await tools.getByRole('button', { name: '关闭', exact: true }).last().click()
    await tools.waitFor({ state: 'detached' })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('shows why a server that cannot connect is not connected, and reconnects on request', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-servers-failed-state'))
    const panel = await openPage()
    const row = panel.getByRole('listitem').filter({ hasText: 'files' }).first()
    // `mcp-e2e-missing` does not exist, so every attempt fails and the row says so.
    await row.getByText(/^(重连中|未连接)/).first().waitFor({ timeout: 30_000 })
    await row.getByRole('button', { name: '重新连接', exact: true }).waitFor()
    await row.getByRole('button', { name: '重新连接', exact: true }).click()
    await row.getByText(/^(连接中|重连中|未连接)/).first().waitFor({ timeout: 30_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)
})
