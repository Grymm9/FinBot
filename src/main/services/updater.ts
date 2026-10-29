import { app, BrowserWindow } from 'electron'
import { join, resolve } from 'node:path'
import { promises as fs, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { getSetting } from './settings'
import { recordFail, recordOk } from './health'
import { formatBytes, isNewer, parseManifest, sha512Hex, type UpdateManifest } from './updater-math'
import type { UpdateStatus } from '@shared/types'

/**
 * Auto-update from a local folder or an HTTPS feed.
 *
 * `npm run release:github` publishes the installer plus an `update.json`
 * manifest to a GitHub release; the installed app fetches the manifest over
 * HTTPS, verifies the SHA-512, downloads the installer, and offers a one-click
 * "Restart & install". A folder feed (the original design) still works for
 * offline/network-share updates.
 *
 * Install is never silent — the user clicks restart, so an update can't
 * interrupt a budget edit.
 */

const MANIFEST_NAME = 'update.json'

/**
 * Where a fresh install looks for updates. GitHub serves the assets of the
 * newest release under `/releases/latest/download/`, so this URL never changes
 * between versions. Override with `UPDATE_FEED_URL` (or a folder path).
 */
const DEFAULT_FEED_URL = 'https://github.com/Grymm9/FinBot/releases/latest/download'

interface FeedSource {
  kind: 'dir' | 'url'
  /** Folder path for `dir`, base URL (no trailing slash) for `url`. */
  value: string
}


let status: UpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion()
}
let downloadedPath: string | null = null
let downloadedManifest: UpdateManifest | null = null
let inFlight: Promise<UpdateStatus> | null = null

function broadcast(next: UpdateStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:status', next)
  }
}

function currentVersion(): string {
  return app.getVersion()
}

/**
 * Resolve where updates come from. An explicit folder wins (useful for local
 * builds), then an explicit URL, then the GitHub release feed baked into the
 * app.
 */
export function feedSource(): FeedSource {
  const configuredPath = getSetting('UPDATE_FEED_PATH', '').trim()
  if (configuredPath) return { kind: 'dir', value: resolve(configuredPath) }

  const configuredUrl = getSetting('UPDATE_FEED_URL', '').trim()
  if (configuredUrl) return { kind: 'url', value: configuredUrl.replace(/\/+$/, '') }

  return { kind: 'url', value: DEFAULT_FEED_URL }
}

/** Human-readable feed location for status messages. */
export function feedLabel(): string {
  const source = feedSource()
  return source.kind === 'url' ? source.value : source.value
}

/** Folder that holds `update.json` and the installer (legacy folder feed). */
export function feedDirectory(): string {
  const source = feedSource()
  return source.kind === 'dir' ? source.value : join(app.getPath('userData'), 'update-feed')
}

export function getUpdateStatus(): UpdateStatus {
  return { ...status, currentVersion: currentVersion() }
}

/** Read + validate `update.json` from whichever feed is configured. */
async function loadManifest(source: FeedSource): Promise<UpdateManifest | null> {
  if (source.kind === 'dir') {
    return readManifest(source.value)
  }
  const url = `${source.value}/${MANIFEST_NAME}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`Update feed returned HTTP ${res.status}.`)
  return parseManifest(await res.text())
}

async function readManifest(dir: string): Promise<UpdateManifest | null> {
  try {
    const text = await fs.readFile(join(dir, MANIFEST_NAME), 'utf-8')
    return parseManifest(text)
  } catch {
    return null
  }
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (inFlight) return inFlight

  inFlight = (async (): Promise<UpdateStatus> => {
    broadcast({ state: 'checking', currentVersion: currentVersion() })

    if (!app.isPackaged) {
      broadcast({
        state: 'disabled',
        currentVersion: currentVersion(),
        message: 'Updates are disabled in development builds.'
      })
      return getUpdateStatus()
    }

    const source = feedSource()
    let manifest: UpdateManifest | null = null

    if (source.kind === 'dir') {
      try {
        const st = await fs.stat(source.value)
        if (!st.isDirectory()) throw new Error(`${source.value} is not a folder`)
        manifest = await readManifest(source.value)
      } catch {
        broadcast({
          state: 'disabled',
          currentVersion: currentVersion(),
          message: `No update feed at ${source.value}.`
        })
        return getUpdateStatus()
      }
    } else {
      try {
        manifest = await loadManifest(source)
      } catch (e) {
        // Offline, blocked, or GitHub is down. Not a health failure: a laptop
        // that is simply offline should not trigger "service failing" alerts.
        broadcast({
          state: 'disabled',
          currentVersion: currentVersion(),
          message: `Couldn't check ${source.value} (${(e as Error).message})`
        })
        return getUpdateStatus()
      }
    }

    if (!manifest) {
      broadcast({
        state: 'disabled',
        currentVersion: currentVersion(),
        message:
          source.kind === 'dir'
            ? `No valid ${MANIFEST_NAME} in ${source.value}.`
            : `No valid ${MANIFEST_NAME} at ${source.value}.`
      })
      return getUpdateStatus()
    }

    recordOk('update')

    if (!isNewer(manifest.version, currentVersion())) {
      broadcast({
        state: 'uptodate',
        currentVersion: currentVersion(),
        availableVersion: manifest.version,
        checkedAt: Date.now()
      })
      return getUpdateStatus()
    }

    broadcast({
      state: 'available',
      currentVersion: currentVersion(),
      availableVersion: manifest.version,
      notes: manifest.notes,
      checkedAt: Date.now()
    })

    // Download eagerly (but never install) so "Restart & install" is instant.
    if (getSetting('AUTO_UPDATE_DOWNLOAD', '1') !== '0') {
      await downloadUpdate()
    }
    return getUpdateStatus()
  })()

  try {
    return await inFlight
  } catch (e) {
    recordFail('update', e)
    broadcast({
      state: 'error',
      currentVersion: currentVersion(),
      message: (e as Error).message
    })
    return getUpdateStatus()
  } finally {
    inFlight = null
  }
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  const source = feedSource()
  const manifest = await loadManifest(source).catch(() => null)
  if (!manifest) {
    broadcast({ state: 'error', currentVersion: currentVersion(), message: 'No update manifest found.' })
    return getUpdateStatus()
  }
  if (!isNewer(manifest.version, currentVersion())) {
    broadcast({ state: 'uptodate', currentVersion: currentVersion(), availableVersion: manifest.version })
    return getUpdateStatus()
  }

  const cacheDir = join(app.getPath('userData'), 'update-cache')
  await fs.mkdir(cacheDir, { recursive: true })
  const dest = join(cacheDir, manifest.file)
  const tmp = `${dest}.part`

  try {
    broadcast({
      state: 'downloading',
      currentVersion: currentVersion(),
      availableVersion: manifest.version,
      progress: 0
    })

    if (source.kind === 'url') {
      const url = manifest.url ?? `${source.value}/${encodeURIComponent(manifest.file)}`
      await downloadHttp(url, tmp, manifest)
    } else if (manifest.url) {
      await downloadHttp(manifest.url, tmp, manifest)
    } else {
      await fs.copyFile(join(source.value, manifest.file), tmp)
      broadcast({
        state: 'downloading',
        currentVersion: currentVersion(),
        availableVersion: manifest.version,
        progress: 100
      })
    }

    const buf = await fs.readFile(tmp)
    if (manifest.size && buf.byteLength !== manifest.size) {
      throw new Error(`Size mismatch (expected ${manifest.size}, got ${buf.byteLength})`)
    }
    const digest = sha512Hex(buf)
    if (digest !== manifest.sha512) {
      throw new Error('SHA-512 mismatch — the download is corrupt or was tampered with.')
    }

    await fs.rm(dest, { force: true })
    await fs.rename(tmp, dest)

    downloadedPath = dest
    downloadedManifest = manifest
    recordOk('update')
    broadcast({
      state: 'ready',
      currentVersion: currentVersion(),
      availableVersion: manifest.version,
      notes: manifest.notes,
      progress: 100,
      checkedAt: Date.now(),
      message: `${manifest.file} (${formatBytes(buf.byteLength)}) verified.`
    })
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    recordFail('update', e)
    broadcast({
      state: 'error',
      currentVersion: currentVersion(),
      availableVersion: manifest.version,
      message: (e as Error).message
    })
  }

  return getUpdateStatus()
}

async function downloadHttp(url: string, dest: string, manifest: UpdateManifest): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`)
  const total = Number(res.headers.get('content-length')) || manifest.size || 0

  let received = 0
  const handle = await fs.open(dest, 'w')
  try {
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      await handle.write(value)
      if (total > 0) {
        broadcast({
          state: 'downloading',
          currentVersion: currentVersion(),
          availableVersion: manifest.version,
          progress: Math.min(99, Math.round((received / total) * 100))
        })
      }
    }
  } finally {
    await handle.close()
  }
}

/**
 * Hand off to a detached helper that waits for this process to exit, runs the
 * NSIS installer silently, then relaunches the app. The helper has to outlive
 * us because the installer cannot replace a running executable.
 */
export function installUpdate(): UpdateStatus {
  if (!downloadedPath || !downloadedManifest) {
    return {
      state: 'error',
      currentVersion: currentVersion(),
      message: 'No verified update is ready to install.'
    }
  }
  if (!app.isPackaged) {
    return {
      state: 'disabled',
      currentVersion: currentVersion(),
      message: 'Updates are disabled in development builds.'
    }
  }

  const installer = downloadedPath
  const exe = app.getPath('exe')
  const helper = join(app.getPath('temp'), `financebot-update-${Date.now()}.cmd`)
  const script = [
    '@echo off',
    'setlocal',
    ':wait',
    'tasklist /FI "IMAGENAME eq FinanceBot.exe" 2>nul | find /I "FinanceBot.exe" >nul',
    'if not errorlevel 1 (',
    '  timeout /t 2 /nobreak >nul',
    '  goto wait',
    ')',
    `start "" /wait "${installer}" /S`,
    `start "" "${exe}"`,
    'exit /b 0'
  ].join('\r\n')

  const fsSync = writeFileSync
  fsSync(helper, script, 'utf-8')

  spawn('cmd.exe', ['/c', helper], { detached: true, stdio: 'ignore', windowsHide: true }).unref()

  broadcast({
    state: 'ready',
    currentVersion: currentVersion(),
    availableVersion: downloadedManifest.version,
    message: 'Restarting to install…'
  })
  setTimeout(() => app.quit(), 400)

  return getUpdateStatus()
}

export function startUpdateScheduler(): NodeJS.Timeout | null {
  if (getSetting('AUTO_UPDATE', '1') === '0') return null
  setTimeout(() => void checkForUpdate(), 60_000)
  return setInterval(() => void checkForUpdate(), 6 * 60 * 60 * 1000)
}

/** Used by the CLI/evals to avoid touching update state. */
export function resetUpdateStateForTests(): void {
  status = { state: 'idle', currentVersion: currentVersion() }
  downloadedPath = null
  downloadedManifest = null
}
