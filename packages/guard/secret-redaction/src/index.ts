/**
 * Secret-redaction guard: replaces known credentials and well-known token
 * formats in every tool result's content before the session log records it
 * and before any model request carries it. Known credentials are the values of
 * harness environment variables with credential-shaped names and the values the
 * credential provider stores; token formats cover private keys and the common
 * provider key shapes, so a credential the harness does not know about is
 * still caught when it has a recognizable form.
 *
 * Function plugin (named exports, no default export). The listener runs in the
 * `tools/post-execute` waterfall after every inner listener, so a replacement
 * another listener made, such as a spill preview, is redacted too.
 *
 * @module @deepseek-ai/dsh-secret-redaction
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision } from '@deepseek-ai/dsh-tools'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'secret-redaction'

/** Services required by this plugin. */
export const inject = ['tools']

/** Which secrets the guard redacts. */
export interface Config {
  /** Redact the values of harness environment variables whose names look like credentials. */
  environment: boolean
  /** Redact the values the credential provider stores and resolves. */
  credentials: boolean
  /** Credential references resolved and redacted on each call, in addition to the stored records. */
  credentialRefs: string[]
  /** Redact private keys and well-known provider token formats wherever they appear. */
  patterns: boolean
  /** Shortest known value redacted, in characters; shorter values would match ordinary text. */
  minLength: number
  /** Further environment variable names whose values are secrets. */
  extraNames: string[]
}

export const Config = z.object({
  environment: z.boolean().default(true),
  credentials: z.boolean().default(true),
  credentialRefs: z.array(String).default(['DEEPSEEK_API_KEY']),
  patterns: z.boolean().default(true),
  minLength: z.number().step(1).min(4).default(8),
  extraNames: z.array(String).default([]),
}) as z<Partial<Config>, Config>

/** A value to replace, and the name the replacement shows instead. */
export interface Secret {
  readonly value: string
  readonly label: string
}

/** Environment variable names whose values are credentials, including names a narrower scrub misses. */
export const SENSITIVE_NAME = /KEY|TOKEN|SECRET|PASSW|PWD|CREDENTIAL|AUTH|COOKIE|_PAT$|DSN$|CONNECTION_STRING|DATABASE_URL/i

/** Well-known credential formats, matched anywhere in a result. */
export const TOKEN_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: 'private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  { label: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { label: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { label: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { label: 'AWS secret key', pattern: /(?<=aws_secret_access_key\s*[=:]\s*["']?)[A-Z0-9/+=]{40}/gi },
  { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { label: 'API key', pattern: /\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9_-]{20,}\b/g },
]

/**
 * Collect the secrets the harness environment holds: every value of a
 * credential-shaped or listed name, and the password of any URL a value carries.
 * @param env - the harness process environment.
 * @param extraNames - further names whose values are secrets.
 * @param minLength - shortest value collected.
 * @returns the secrets, labelled by variable name.
 */
export function environmentSecrets(env: NodeJS.ProcessEnv, extraNames: readonly string[], minLength: number): Secret[] {
  const listed = new Set(extraNames.map(entry => entry.toUpperCase()))
  const found: Secret[] = []
  for (const [variable, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (SENSITIVE_NAME.test(variable) || listed.has(variable.toUpperCase())) found.push({ value, label: variable })
    for (const password of value.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:([^\s@/]+)@/gi)) {
      found.push({ value: password[1] as string, label: `${variable} password` })
    }
  }
  return found.filter(secret => secret.value.length >= minLength)
}

/** Every string leaf of an opaque JSON-like value. */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object' || value === null) return []
  return Object.values(value).flatMap(stringLeaves)
}

/**
 * Collect the secrets the credential provider holds: listed references, stored api keys and their
 * environment values, and the string leaves of stored grants.
 * @param ctx - the plugin context, whose optional `credentials` provider is read.
 * @param refs - references to resolve.
 * @param minLength - shortest value collected.
 * @returns the secrets, labelled by reference or record.
 */
export async function credentialSecrets(ctx: Context, refs: readonly CredentialRef[], minLength: number): Promise<Secret[]> {
  const provider = ctx.get('credentials')
  if (provider === undefined) return []
  const found: Secret[] = []
  for (const ref of refs) {
    const resolved = await provider.resolve(ref)
    if (resolved !== undefined) found.push({ value: resolved.value, label: String(ref) })
  }
  for (const entry of await provider.listRecords()) {
    const record = await provider.readRecord(entry.key)
    if (record === undefined) continue
    const label = String(entry.key)
    if (record.kind === 'grant') {
      for (const leaf of stringLeaves(record.payload)) found.push({ value: leaf, label })
      continue
    }
    if (record.key !== undefined) found.push({ value: record.key, label })
    for (const [variable, value] of Object.entries(record.env ?? {})) found.push({ value, label: `${label} ${variable}` })
  }
  return found.filter(secret => secret.value.length >= minLength)
}

/**
 * Replace every known secret, longest first so a value containing another is replaced whole, then every token format.
 * @param text - text to redact.
 * @param secrets - known values.
 * @param patterns - whether token formats are redacted too.
 * @returns the redacted text; the same string when nothing matched.
 */
export function redactText(text: string, secrets: readonly Secret[], patterns: boolean): string {
  let out = text
  for (const secret of [...secrets].sort((a, b) => b.value.length - a.value.length)) {
    if (out.includes(secret.value)) out = out.replaceAll(secret.value, `[redacted: ${secret.label}]`)
  }
  if (patterns) {
    for (const { label, pattern } of TOKEN_PATTERNS) out = out.replace(pattern, `[redacted: ${label}]`)
  }
  return out
}

/**
 * Redact the text blocks of a result projection.
 * @param blocks - content blocks; non-text blocks pass unchanged.
 * @param redact - the text redaction.
 * @returns the blocks, or undefined when nothing changed.
 */
export function redactBlocks(blocks: readonly ContentBlock[], redact: (text: string) => string): ContentBlock[] | undefined {
  const out = blocks.map((block) => {
    if (block.type !== 'text') return block
    const text = redact(block.text)
    return text === block.text ? block : { ...block, text }
  })
  return out.some((block, index) => block !== blocks[index]) ? out : undefined
}

/**
 * Register the redaction listener.
 * @param ctx - plugin context.
 * @param config - which secrets to redact.
 * @throws when a credential reference is not a valid reference name.
 */
export function apply(ctx: Context, config: Config): void {
  const refs = config.credentialRefs.map(credentialRef)
  ctx.on('tools/post-execute', async (_exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    // Secrets are read per call: a credential stored or changed since the last call is covered by the next.
    const secrets = [
      ...config.environment ? environmentSecrets(process.env, config.extraNames, config.minLength) : [],
      ...config.credentials ? await credentialSecrets(ctx, refs, config.minLength) : [],
    ]
    const redact = (text: string): string => redactText(text, secrets, config.patterns)
    if (decision.kind === 'block') {
      const feedback = redactBlocks(decision.feedback, redact)
      return feedback === undefined ? decision : { ...decision, feedback }
    }
    // A listener that replaced the value leaves the registry to render content from it; that content is not seen here.
    if (Object.hasOwn(decision, 'value')) return decision
    const content = redactBlocks(decision.content ?? result.content, redact)
    if (content === undefined) return decision
    return { kind: 'accept', content, ...decision.additionalContexts === undefined ? {} : { additionalContexts: decision.additionalContexts } }
  })
}
