// @vitest-environment jsdom
/** Request-header rows of the Models editor card. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ProviderEditor } from '../src/client/ProviderEditor.tsx'
import { headerRows, headersFailure, headersOf } from '../src/client/HeadersEditor.tsx'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const json = (schema: Schema): JsonValue => JSON.parse(JSON.stringify(schema.toJSON())) as JsonValue

function piAiNamespace(profile: Record<string, JsonValue> = {}, withHeaders = true): SettingsNamespaceView {
  const providers = { route: { apiKeyEnv: 'ROUTE_API_KEY', ...profile } }
  return {
    ns: 'llm-pi-ai',
    schema: json(Schema.object({
      providers: Schema.dict(Schema.object({
        apiKeyEnv: Schema.string(),
        ...withHeaders ? { headers: Schema.dict(Schema.string()) } : {},
      })),
    })),
    value: { providers }, user: { providers },
    autoGenerate: true, applies: 'live', secrets: [], revision: 2,
  }
}

function setup(namespace: SettingsNamespaceView) {
  const writeSettings = vi.fn<ModelsOperations['writeSettings']>(() => Promise.resolve({ kind: 'written', view: namespace }))
  const operations: ModelsOperations = {
    storeCredential: vi.fn(() => Promise.resolve(undefined)),
    removeCredential: vi.fn(() => Promise.resolve(undefined)),
    writeSettings,
    discoverModels: vi.fn<ModelsOperations['discoverModels']>(() => Promise.resolve({ kind: 'found', models: [] })),
  }
  const onClose = vi.fn()
  render(<ProviderEditor provider="route" displayName="Route" namespace={namespace} schema={settingsSchema}
    settingsPath={['providers', 'route']} operations={operations} t={key => en[key]} readOnly={false} onClose={onClose} />)
  return { writeSettings, onClose }
}

const t = (key: keyof typeof en): string => en[key]
const name = (position: number) => screen.getByRole<HTMLInputElement>('textbox', { name: `${en.headerName} ${String(position)}` })
const value = (position: number) => screen.getByRole<HTMLInputElement>('textbox', { name: `${en.headerValue} ${String(position)}` })
const add = () => screen.getByRole<HTMLButtonElement>('button', { name: en.headerAdd })
const remove = (position: number) => screen.getByRole<HTMLButtonElement>('button', { name: `${en.headerRemove} ${String(position)}` })
const apply = () => screen.getByText<HTMLButtonElement>(en.apply)
const type = (element: HTMLInputElement, text: string): void => { fireEvent.change(element, { target: { value: text } }) }

describe('request header rows', () => {
  it('writes an added header as one path op under the profile', async () => {
    const { writeSettings, onClose } = setup(piAiNamespace())
    expect(screen.queryByRole('textbox', { name: `${en.headerName} 1` })).toBeNull()
    fireEvent.click(add())
    type(name(1), ' Isoquant-ZDR ')
    type(value(1), ' required ')
    fireEvent.click(apply())
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(writeSettings).toHaveBeenCalledWith('llm-pi-ai', [
      { op: 'set', path: ['providers', 'route', 'headers', 'Isoquant-ZDR'], value: 'required' },
    ], 2)
  })

  it('shows stored headers and writes an edit, a rename, and a removal', async () => {
    const { writeSettings, onClose } = setup(piAiNamespace({ headers: { 'X-One': 'a', 'X-Two': 'b', 'X-Three': 'c' } }))
    expect([name(1).value, value(1).value, name(3).value]).toEqual(['X-One', 'a', 'X-Three'])
    type(value(1), 'changed')
    type(name(2), 'X-Renamed')
    fireEvent.click(remove(3))
    fireEvent.click(apply())
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(writeSettings).toHaveBeenCalledWith('llm-pi-ai', [
      { op: 'set', path: ['providers', 'route', 'headers', 'X-One'], value: 'changed' },
      { op: 'set', path: ['providers', 'route', 'headers', 'X-Renamed'], value: 'b' },
      { op: 'unset', path: ['providers', 'route', 'headers', 'X-Two'] },
      { op: 'unset', path: ['providers', 'route', 'headers', 'X-Three'] },
    ], 2)
  })

  it('unsets the whole dict when the last header is removed', async () => {
    const { writeSettings, onClose } = setup(piAiNamespace({ headers: { 'X-One': 'a' } }))
    fireEvent.click(remove(1))
    fireEvent.click(apply())
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(writeSettings).toHaveBeenCalledWith('llm-pi-ai', [{ op: 'unset', path: ['providers', 'route', 'headers'] }], 2)
  })

  it('leaves stored headers untouched when nothing is edited and ignores a blank row', async () => {
    const { writeSettings, onClose } = setup(piAiNamespace({ headers: { 'X-One': 'a' } }))
    fireEvent.click(add())
    fireEvent.click(apply())
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(writeSettings).not.toHaveBeenCalled()
  })

  it.each([
    ['Bad Name', 'v', en.headerNameInvalid],
    ['', 'v', en.headerNameInvalid],
    ['X-One', '', en.headerValueInvalid],
    ['X-One', 'snow☃', en.headerValueInvalid],
    ['x-existing', 'v', en.headerDuplicate],
  ])('refuses name %j with value %j', (headerName, headerValue, message) => {
    const { writeSettings } = setup(piAiNamespace({ headers: { 'X-Existing': 'kept' } }))
    fireEvent.click(add())
    type(name(2), headerName)
    type(value(2), headerValue)
    const text = message.replace('{index}', '2')
    // The fold is closed, so the card shows the failure beside the disabled Apply.
    expect(screen.getByText(text)).toBeTruthy()
    expect(apply().disabled).toBe(true)
    fireEvent.click(apply())
    expect(writeSettings).not.toHaveBeenCalled()
    fireEvent.click(remove(2))
    expect(screen.queryByText(text)).toBeNull()
    expect(apply().disabled).toBe(false)
  })

  it('marks the refused row and shows its failure inside the open fold', () => {
    setup(piAiNamespace())
    const fold = document.querySelector('details')
    if (fold === null) throw new Error('the customized-settings fold did not render')
    fold.open = true
    fireEvent(fold, new Event('toggle'))
    fireEvent.click(add())
    type(name(1), 'Bad Name')
    expect(name(1).getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('route-headers-failure')?.textContent).toBe(en.headerNameInvalid.replace('{index}', '1'))
  })

  it('offers no header rows for a profile whose schema declares none', () => {
    setup(piAiNamespace({}, false))
    expect(screen.queryByRole('button', { name: en.headerAdd })).toBeNull()
  })
})

describe('header row conversion', () => {
  it('reads only string entries of a stored dict', () => {
    expect(headerRows({ a: '1', b: 2 })).toEqual([{ name: 'a', value: '1' }])
    expect(headerRows(['a'])).toEqual([])
    expect(headerRows(undefined)).toEqual([])
  })

  it('stores trimmed entries and nothing for blank rows', () => {
    expect(headersOf([{ name: ' a ', value: ' 1 ' }, { name: '', value: ' ' }])).toEqual({ a: '1' })
    expect(headersOf([{ name: '', value: '' }])).toBeUndefined()
    expect(headersFailure([{ name: '', value: '' }, { name: 'a', value: 'tab\there' }], t)).toBeUndefined()
  })
})
