#!/usr/bin/env node
/**
 * Publish the newest local build as a GitHub Release.
 *
 *   1. Run a normal Windows release:  npm run release:win
 *   2. Publish:                        set GITHUB_TOKEN=... && npm run publish:github
 *
 * The installed app reads
 *   https://github.com/<owner>/<repo>/releases/latest/download/update.json
 * so the assets use a version-independent name (`FinanceBot-Setup.exe`). The
 * manifest keeps an absolute per-tag URL as well, so it still works after a
 * newer release becomes "latest".
 *
 * Requires a token with `repo` (or "Contents: read and write") permission.
 * Set GITHUB_REPO to override the default repository.
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
if (!token) {
  console.error('GITHUB_TOKEN is not set. Create a fine-grained token with "Contents: read and write".')
  process.exit(1)
}

const root = resolve(process.cwd())
const releaseDir = join(root, 'release')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))

function repoFromRemote() {
  try {
    const gitConfig = readFileSync(join(root, '.git', 'config'), 'utf-8')
    const m = gitConfig.match(/url\s*=\s*.*github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m)
    if (m) return m[1]
  } catch {
    // not a git checkout; fall through
  }
  return null
}

const repo = process.env.GITHUB_REPO || repoFromRemote()
if (!repo) {
  console.error('Could not determine the repository. Set GITHUB_REPO=owner/name.')
  process.exit(1)
}

const tag = `v${pkg.version}`
const assetName = 'FinanceBot-Setup.exe'
const base = `https://github.com/${repo}/releases`

if (!existsSync(releaseDir)) {
  console.error(`No release directory at ${releaseDir}. Run "npm run release:win" first.`)
  process.exit(1)
}

const newest = readdirSync(releaseDir)
  .filter((f) => f.toLowerCase().endsWith('.exe') && !f.toLowerCase().includes('uninstaller'))
  .filter((f) => f !== assetName)
  .map((f) => ({ file: f, mtime: statSync(join(releaseDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0]

if (!newest) {
  console.error('No installer .exe found in release/.')
  process.exit(1)
}

const installedPath = join(releaseDir, assetName)
copyFileSync(join(releaseDir, newest.file), installedPath)

const digest = await new Promise((res, rej) => {
  const hash = createHash('sha512')
  createReadStream(installedPath)
    .on('data', (chunk) => hash.update(chunk))
    .on('error', rej)
    .on('end', () => res(hash.digest('hex')))
})

const notesFile = join(root, 'update-notes.md')
const notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf-8').trim() : ''

const manifest = {
  version: pkg.version,
  file: assetName,
  sha512: digest,
  size: statSync(installedPath).size,
  publishedAt: Date.now(),
  url: `${base}/download/${tag}/${assetName}`,
  ...(notes ? { notes: notes.slice(0, 2000) } : {})
}
const manifestPath = join(releaseDir, 'update.json')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

const api = (path) => `https://api.github.com/repos/${repo}${path}`
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'FinanceBot-release-script'
}

async function github(path, init = {}) {
  const res = await fetch(api(path), { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`GitHub ${init.method ?? 'GET'} ${path} failed (${res.status}): ${text.slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return text ? JSON.parse(text) : null
}

console.log(`Publishing ${pkg.version} to ${repo} …`)

let release
try {
  release = await github('/releases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `FinanceBot ${pkg.version}`,
      body: notes || `FinanceBot ${pkg.version}`,
      draft: false,
      prerelease: false
    })
  })
  console.log(`Created release ${tag}.`)
} catch (e) {
  if (e.status !== 422) throw e
  // Tag already exists (e.g. re-publishing a fixed build).
  release = await github(`/releases/tags/${tag}`)
  console.log(`Release ${tag} already exists; replacing assets.`)
}

async function upload(name, file) {
  const existing = (release.assets ?? []).filter((a) => a.name === name)
  for (const a of existing) {
    await github(`/releases/assets/${a.id}`, { method: 'DELETE' })
  }
  const body = readFileSync(file)
  const res = await fetch(
    `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.byteLength) },
      body
    }
  )
  if (!res.ok) {
    throw new Error(`Upload ${name} failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
  console.log(`Uploaded ${name} (${(body.byteLength / 1024 / 1024).toFixed(1)} MB).`)
}

await upload(assetName, installedPath)
await upload('update.json', manifestPath)

console.log('')
console.log(`Latest manifest: ${base}/latest/download/update.json`)
console.log(`Installer:       ${base}/latest/download/${assetName}`)
console.log(`Manifest version ${manifest.version}, sha512 ${digest.slice(0, 16)}…`)
