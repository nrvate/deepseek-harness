/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { realpathSync, statSync } from 'node:fs'
import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-system/landlock-run'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/** One protected path as it exists now: its canonical spelling and whether it is a directory; undefined while missing. */
function existingProtectedPath(path: string): { path: string; directory: boolean } | undefined {
  try {
    const canonical = realpathSync(path)
    return { path: canonical, directory: statSync(canonical).isDirectory() }
  } catch (_error) {
    // A missing path has nothing to hide, and bwrap cannot mount over it.
    return undefined
  }
}

/**
 * Build the bwrap profile arguments for one file-effect policy. Each existing
 * protected path is hidden after every other mount: a directory behind an empty
 * tmpfs, a file behind `/dev/null`.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
  }
  for (const entry of policy.protectedPaths ?? []) {
    const found = existingProtectedPath(entry)
    if (found === undefined) continue
    args.push(...found.directory ? ['--tmpfs', found.path] : ['--ro-bind', '/dev/null', found.path])
  }
  return args
}

/**
 * Build the Landlock launcher grants for one file-effect policy. Landlock only
 * grants access, so a protected path under the readable root stays readable on
 * this rung.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot)
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  // Later SBPL rules win, so the denial follows every grant. Both spellings are denied: the
  // configured one and, for a path that exists, its canonical one (`/var` is `/private/var`).
  const protectedPaths = new Set((policy.protectedPaths ?? []).flatMap((entry) => {
    const found = existingProtectedPath(entry)
    return found === undefined ? [entry] : [entry, found.path]
  }))
  if (protectedPaths.size > 0) {
    forms.push(`(deny file-read* file-write* ${[...protectedPaths].map(path => `(subpath ${sbplString(path)})`).join(' ')})`)
  }
  return ['-p', forms.join(' ')]
}
