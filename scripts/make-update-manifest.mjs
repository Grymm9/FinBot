#!/usr/bin/env node
/**
 * Build an update manifest for the local update feed.
 *
 *   node scripts/make-update-manifest.mjs            # writes release/update.json
 *   node scripts/make-update-manifest.mjs --publish  # also copies to FINANCEBOT_FEED
 *   node scripts/make-update-manifest.mjs --publish D:\Feed
 *
 * The installed app reads <feed>/update.json, compares the version, downloads
 * the installer and verifies the SHA-512 before offering "Restart & install".
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const publishIndex = args.indexOf('--publish')
const publish = publishIndex !== -1
const feedArg = publish && args[publishIndex + 1] && !args[publishIndex + 1].startsWith('--') ? args[publishIndex + 1] : null
const feedDir = feedArg ? resolve(feedArg) : process.env.FINANCEBOT_FEED ? resolve(process.env.FINANCEBOT_FEED) : null

// GitHub releases need a URL that does not change between versions. `--stable`
// publishes the installer as `FinanceBot-Setup.exe`; `--url-base` sets the
// absolute download URL recorded in update.json.
const stableIndex = args.indexOf('--stable')
const useStableName = stableIndex !== -1
const urlBaseIndex = args.indexOf('--url-base')
const urlBase = urlBaseIndex !== -1 && args[urlBaseIndex + 1] ? args[urlBaseIndex + 1].replace(/\/+$/, '') : null

const root = resolve(process.cwd())
const releaseDir = join(root, 'release')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))

if (!existsSync(releaseDir)) {
  console.error(`No release directory at ${releaseDir}. Run "npm run package:win" first.`)
  process.exit(1)
}

const STABLE_NAME = 'FinanceBot-Setup.exe'

const installers = readdirSync(releaseDir)
  .filter((f) => f.toLowerCase().endsWith('.exe') && !f.toLowerCase().includes('uninstaller'))
  .filter((f) => f !== STABLE_NAME)
  .map((f) => ({ file: f, mtime: statSync(join(releaseDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)

if (installers.length === 0) {
  console.error('No installer .exe found in release/.')
  process.exit(1)
}

let installer = installers[0].file
let installerPath = join(releaseDir, installer)

if (useStableName) {
  const stablePath = join(releaseDir, STABLE_NAME)
  copyFileSync(installerPath, stablePath)
  installer = STABLE_NAME
  installerPath = stablePath
}

function sha512(file) {
  return new Promise((res, rej) => {
    const hash = createHash('sha512')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', rej)
      .on('end', () => res(hash.digest('hex')))
  })
}

const digest = await sha512(installerPath)
const size = statSync(installerPath).size
const notesPath = join(root, 'update-notes.md')
const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf-8').trim().slice(0, 2000) : undefined

const manifest = {
  version: pkg.version,
  file: basename(installerPath),
  sha512: digest,
  size,
  publishedAt: Date.now(),
  ...(urlBase ? { url: `${urlBase}/${encodeURIComponent(basename(installerPath))}` } : {}),
  ...(notes ? { notes } : {})
}

const manifestPath = join(releaseDir, 'update.json')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

console.log(`Manifest written: ${manifestPath}`)
console.log(`  version  ${manifest.version}`)
console.log(`  installer ${manifest.file} (${(size / 1024 / 1024).toFixed(1)} MB)`)
console.log(`  sha512   ${digest.slice(0, 24)}…`)

if (publish) {
  if (!feedDir) {
    console.error('--publish needs a feed directory (argument or FINANCEBOT_FEED).')
    process.exit(1)
  }
  mkdirSync(feedDir, { recursive: true })
  copyFileSync(installerPath, join(feedDir, manifest.file))
  copyFileSync(manifestPath, join(feedDir, 'update.json'))
  console.log(`Published to ${feedDir}`)
}
