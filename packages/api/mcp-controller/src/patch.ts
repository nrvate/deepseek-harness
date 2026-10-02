/**
 * Comment-preserving edits of the MCP server rows a profile patch inserts.
 * Every function maps patch text to patch text, so callers own file access,
 * locking, and rollback.
 * @module
 */
import { isMap, isScalar, isSeq, parseDocument, Scalar, YAMLMap, YAMLSeq, type Document } from 'yaml'
import type { McpServerSpec, McpValue } from './types.ts'

/** Module specifier of the MCP client plugin. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

const JS_TAG = 'tag:yaml.org,2002:js'
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENV_EXPRESSION = /^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/
const BEARER_EXPRESSION = /^`Bearer \$\{process\.env\.([A-Za-z_][A-Za-z0-9_]*)\}`$/

/** One MCP row the profile patch inserts. */
export interface OwnedRow {
  id: string
  disabled: boolean
  /** Editable configuration; absent when the row holds anything the form cannot represent. */
  spec?: McpServerSpec
  /** Name the row configures, when readable; used to detect duplicates even for rows without a spec. */
  serverName?: string
}

function parse(text: string): Document.Parsed {
  const document = parseDocument(text, { customTags: [{ tag: JS_TAG, resolve: (value: string) => value }] })
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  return document
}

function isExpression(node: unknown): node is Scalar<string> {
  return isScalar(node) && node.tag === JS_TAG
}

/** Source text of the environment reference a value writes, or the arbitrary expression it holds. */
function readValue(node: unknown): McpValue | undefined {
  if (isExpression(node)) {
    const source = node.value
    const plain = ENV_EXPRESSION.exec(source)
    if (plain !== null) return { kind: 'env', name: plain[1] as string }
    const bearer = BEARER_EXPRESSION.exec(source)
    if (bearer !== null) return { kind: 'env', name: bearer[1] as string, scheme: 'Bearer' }
    return { kind: 'expression', source }
  }
  if (isScalar(node) && typeof node.value === 'string') return { kind: 'literal', value: node.value }
  return undefined
}

function readValueMap(node: unknown): Record<string, McpValue> | undefined {
  if (node === undefined) return {}
  if (!isMap(node)) return undefined
  const values: Record<string, McpValue> = {}
  for (const pair of node.items) {
    const value = readValue(pair.value)
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || value === undefined) return undefined
    values[pair.key.value] = value
  }
  return values
}

function plainString(map: YAMLMap, key: string): string | undefined | null {
  const node = map.get(key, true)
  if (node === undefined) return undefined
  return isScalar(node) && !isExpression(node) && typeof node.value === 'string' ? node.value : null
}

function readSpec(config: YAMLMap): McpServerSpec | undefined {
  const serverName = plainString(config, 'serverName')
  const transport = plainString(config, 'transport')
  const timeout = config.get('toolCallTimeoutMs', true)
  const fail = config.get('failOnStartupError', true)
  const active = config.get('defaultActive', true)
  if (typeof serverName !== 'string') return undefined
  const common = {
    serverName,
    ...isScalar(timeout) && typeof timeout.value === 'number' ? { toolCallTimeoutMs: timeout.value } : {},
    ...isScalar(fail) && typeof fail.value === 'boolean' ? { failOnStartupError: fail.value } : {},
    ...isScalar(active) && typeof active.value === 'boolean' ? { defaultActive: active.value } : {},
  }
  if (isScalar(timeout) && typeof timeout.value !== 'number') return undefined
  if (isScalar(fail) && typeof fail.value !== 'boolean') return undefined
  if (isScalar(active) && typeof active.value !== 'boolean') return undefined
  if (transport === 'streamable-http') {
    const url = plainString(config, 'url')
    const headers = readValueMap(config.get('headers', true))
    if (typeof url !== 'string' || headers === undefined) return undefined
    return { transport, url, headers, ...common }
  }
  if (transport === 'stdio') {
    const command = plainString(config, 'command')
    const cwd = plainString(config, 'cwd')
    const env = readValueMap(config.get('env', true))
    const argsNode = config.get('args', true)
    const args: string[] = []
    if (argsNode !== undefined) {
      if (!isSeq(argsNode)) return undefined
      for (const item of argsNode.items) {
        if (!isScalar(item) || isExpression(item) || typeof item.value !== 'string') return undefined
        args.push(item.value)
      }
    }
    if (typeof command !== 'string' || cwd === null || env === undefined) return undefined
    return { transport, command, args, env, ...cwd === undefined ? {} : { cwd }, ...common }
  }
  return undefined
}

/** Locate each inserted MCP row's map node with the sequence that holds it. */
function insertedRows(document: Document.Parsed): Array<{ row: YAMLMap; rows: YAMLSeq; item: YAMLMap }> {
  const found: Array<{ row: YAMLMap; rows: YAMLSeq; item: YAMLMap }> = []
  for (const item of (document.contents as YAMLSeq).items) {
    if (!isMap(item)) continue
    const rows = item.get('insert', true)
    if (!isSeq(rows)) continue
    for (const row of rows.items) {
      if (isMap(row) && row.get('name') === MCP_CLIENT_MODULE) found.push({ row, rows, item })
    }
  }
  return found
}

function findRow(document: Document.Parsed, id: string): { row: YAMLMap; rows: YAMLSeq; item: YAMLMap } {
  const found = insertedRows(document).find(({ row }) => row.get('id') === id)
  if (found === undefined) throw new Error(`The profile patch has no MCP server row "${id}"`)
  return found
}

/**
 * List the MCP rows this patch inserts.
 * @param text - profile patch text; an empty sequence when the file is absent.
 * @returns the rows in file order.
 * @throws when the text is not a YAML sequence.
 */
export function readOwnedRows(text: string): OwnedRow[] {
  return insertedRows(parse(text)).map(({ row }) => {
    const config = row.get('config', true)
    const id = String(row.get('id'))
    const disabled = row.get('disabled') === true
    const spec = isMap(config) ? readSpec(config) : undefined
    const name = isMap(config) ? plainString(config, 'serverName') : undefined
    return { id, disabled, ...spec === undefined ? {} : { spec }, ...typeof name === 'string' ? { serverName: name } : {} }
  })
}

function expression(source: string): Scalar<string> {
  const node = new Scalar(source)
  node.tag = JS_TAG
  return node
}

/** Env reference text a value writes into the patch, or the preserved source. */
function valueNode(value: McpValue, existing: McpValue | undefined): Scalar {
  switch (value.kind) {
    case 'literal':
      return new Scalar(value.value)
    case 'env':
      if (!ENV_NAME.test(value.name)) throw new Error(`"${value.name}" is not an environment variable name`)
      return expression(value.scheme === 'Bearer'
        ? `\`Bearer \${process.env.${value.name}}\``
        : `process.env.${value.name}`)
    case 'kept':
      if (existing?.kind !== 'literal') throw new Error('no stored value to keep')
      return new Scalar(existing.value)
    case 'expression':
      if (existing?.kind !== 'expression' || existing.source !== value.source) {
        throw new Error('an expression can only be kept as the file already holds it')
      }
      return expression(value.source)
  }
}

function valueMapNode(values: Record<string, McpValue>, existing: Record<string, McpValue> | undefined): YAMLMap {
  const map = new YAMLMap()
  for (const [key, value] of Object.entries(values)) map.set(key, valueNode(value, existing?.[key]))
  return map
}

/** Set a key, or delete it when the value is undefined. */
function assign(map: YAMLMap, key: string, value: unknown): void {
  if (value === undefined) map.delete(key)
  else map.set(key, value)
}

function writeConfig(config: YAMLMap, spec: McpServerSpec, existing: McpServerSpec | undefined): void {
  const previous = existing?.transport === spec.transport ? existing : undefined
  assign(config, 'transport', spec.transport)
  assign(config, 'serverName', spec.serverName)
  if (spec.transport === 'stdio') {
    for (const key of ['url', 'headers']) config.delete(key)
    assign(config, 'command', spec.command)
    assign(config, 'args', spec.args.length === 0 ? undefined : spec.args)
    assign(config, 'env', Object.keys(spec.env).length === 0
      ? undefined
      : valueMapNode(spec.env, previous?.transport === 'stdio' ? previous.env : undefined))
    assign(config, 'cwd', spec.cwd === undefined || spec.cwd === '' ? undefined : spec.cwd)
  } else {
    for (const key of ['command', 'args', 'env', 'cwd']) config.delete(key)
    assign(config, 'url', spec.url)
    assign(config, 'headers', Object.keys(spec.headers).length === 0
      ? undefined
      : valueMapNode(spec.headers, previous?.transport === 'streamable-http' ? previous.headers : undefined))
  }
  assign(config, 'toolCallTimeoutMs', spec.toolCallTimeoutMs)
  assign(config, 'failOnStartupError', spec.failOnStartupError)
  assign(config, 'defaultActive', spec.defaultActive)
}

/**
 * Insert a row, or rewrite the managed keys of the row with the same id. Keys the form
 * does not manage (`reconnect`, `maxInstructionBytes`, and any others) and comments stay.
 * @param text - profile patch text.
 * @param id - row id to add or replace.
 * @param spec - configuration to write.
 * @returns the updated patch text.
 * @throws when the text is malformed, or `spec` keeps an expression the file does not hold.
 */
export function upsertRow(text: string, id: string, spec: McpServerSpec): string {
  const document = parse(text)
  const current = insertedRows(document).find(({ row }) => row.get('id') === id)
  if (current === undefined) {
    const config = new YAMLMap()
    writeConfig(config, spec, undefined)
    const row = new YAMLMap()
    row.set('id', id)
    row.set('name', MCP_CLIENT_MODULE)
    row.set('config', config)
    const rows = new YAMLSeq<YAMLMap>()
    rows.add(row)
    const insert = new YAMLMap()
    insert.set('insert', rows)
    const sequence = document.contents as YAMLSeq
    sequence.flow = false
    sequence.add(insert)
    return String(document)
  }
  const found = current.row.get('config', true)
  const existing = isMap(found) ? readSpec(found) : undefined
  const config = isMap(found) ? found : new YAMLMap()
  if (!isMap(found)) current.row.set('config', config)
  writeConfig(config, spec, existing)
  return String(document)
}

/**
 * Delete one inserted row, and the insert group that held only it.
 * @param text - profile patch text.
 * @param id - row id.
 * @returns the updated text.
 * @throws when the patch inserts no such MCP row.
 */
export function removeRow(text: string, id: string): string {
  const document = parse(text)
  const current = findRow(document, id)
  current.rows.items.splice(current.rows.items.indexOf(current.row), 1)
  const sequence = document.contents as YAMLSeq
  if (current.rows.items.length === 0 && current.item.items.length === 1) {
    sequence.items.splice(sequence.items.indexOf(current.item), 1)
  }
  return String(document)
}

/**
 * Enable or disable one inserted row by writing `disabled` on the row itself.
 * @param text - profile patch text.
 * @param id - row id.
 * @param enabled - whether the row loads.
 * @returns the updated text.
 * @throws when the patch inserts no such MCP row.
 */
export function setRowEnabled(text: string, id: string, enabled: boolean): string {
  const document = parse(text)
  const current = findRow(document, id)
  if (enabled) current.row.delete('disabled')
  else current.row.set('disabled', true)
  return String(document)
}

/**
 * The command line a person approves before a stdio server is added or changed.
 * @param spec - stdio configuration.
 * @returns the executable and arguments, space separated.
 */
export function commandLine(spec: { command: string; args: string[] }): string {
  return [spec.command, ...spec.args].join(' ')
}
