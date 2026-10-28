/**
 * Pure update-manifest helpers (no Electron imports) so they can be tested
 * directly — see test/updater.test.ts.
 */

import { createHash } from 'node:crypto'

export interface UpdateManifest {
  version: string
  file: string
  sha512: string
  size?: number
  notes?: string
  publishedAt?: number
  url?: string
}

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA512_RE = /^[a-f0-9]{128}$/i

export function compareVersions(a: string, b: string): number {
  const split = (v: string): { nums: number[]; pre: string | null } => {
    const [core, pre] = v.split('-', 2)
    return {
      nums: core.split('.').map((n) => {
        const parsed = Number.parseInt(n, 10)
        return Number.isFinite(parsed) ? parsed : 0
      }),
      pre: pre ?? null
    }
  }

  const av = split(a)
  const bv = split(b)
  const len = Math.max(av.nums.length, bv.nums.length)
  for (let i = 0; i < len; i++) {
    const x = av.nums[i] ?? 0
    const y = bv.nums[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }

  // A release outranks its own pre-release: 1.0.0 > 1.0.0-beta.
  if (av.pre === bv.pre) return 0
  if (av.pre === null) return 1
  if (bv.pre === null) return -1
  return av.pre > bv.pre ? 1 : -1
}

export function isNewer(remote: string, local: string): boolean {
  return compareVersions(remote, local) > 0
}

/**
 * Parse and validate an `update.json` manifest. Returns null for anything that
 * is malformed or could escape the feed directory.
 */
export function parseManifest(text: string): UpdateManifest | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>

  const version = typeof m.version === 'string' ? m.version.trim() : ''
  const file = typeof m.file === 'string' ? m.file.trim() : ''
  const sha512 = typeof m.sha512 === 'string' ? m.sha512.trim() : ''

  if (!VERSION_RE.test(version)) return null
  if (!file || file.length > 255) return null
  // Filename only: no traversal, no absolute paths.
  if (/[\\/]/.test(file) || file.startsWith('.')) return null
  if (!SHA512_RE.test(sha512)) return null

  const size = typeof m.size === 'number' && Number.isFinite(m.size) && m.size > 0 ? m.size : undefined
  const url = typeof m.url === 'string' && /^https?:\/\//i.test(m.url) ? m.url : undefined

  return {
    version,
    file,
    sha512: sha512.toLowerCase(),
    size,
    url,
    notes: typeof m.notes === 'string' ? m.notes.slice(0, 2000) : undefined,
    publishedAt: typeof m.publishedAt === 'number' ? m.publishedAt : undefined
  }
}

export function sha512Hex(data: Uint8Array): string {
  return createHash('sha512').update(data).digest('hex')
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}
