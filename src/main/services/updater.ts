import { app, BrowserWindow } from 'electron'
import { join, resolve } from 'node:path'
import { promises as fs, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { getSetting } from './settings'
import { recordFail, recordOk } from './health'
import { formatBytes, isNewer, parseManifest, sha512Hex, type UpdateManifest } from './updater-math'
import type { UpdateStatus } from '@shared/types'

/**
 * Local-feed auto-update.
 *
 * The app used to require: quit → `npm run package:win` → silent reinstall →
 * relaunch. Now `npm run release:win` publishes the installer plus an
 * `update.json` manifest to a folder, and the installed app finds it, verifies
 * the SHA-512, downloads it, and offers a one-click "Restart & install".
 *
 * A custom updater is deliberate: electron-updater needs an HTTP feed and this
 * app updates from a local/network folder. Install is never silent — the user
 * clicks restart, so an update can't interrupt a budget edit.
 */

const MANIFEST_NAME = 'update.json'

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

/** Folder that holds `update.json` and the installer. */
export function feedDirectory(): string {
  const configured = getSetting('UPDATE_FEED_PATH', '').trim()
  if (configured) return resolve(configured)
  return join(app.getPath('userData'), 'update-feed')
}

export function getUpdateStatus(): UpdateStatus {
  return { ...status, currentVersion: currentVersion() }
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

    const dir = feedDirectory()
    let manifest: UpdateManifest | null = null
    try {
      const st = await fs.stat(dir)
      if (!st.isDirectory()) throw new Error(`${dir} is not a folder`)
      manifest = await readManifest(dir)
    } catch {
      broadcast({
        state: 'disabled',
        currentVersion: currentVersion(),
        message: `No update feed at ${dir}.`
      })
      return getUpdateStatus()
    }

    if (!manifest) {
      broadcast({
        state: 'disabled',
        currentVersion: currentVersion(),
        message: `No valid ${MANIFEST_NAME} in ${dir}.`
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
  const dir = feedDirectory()
  const manifest = await readManifest(dir)
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

    if (manifest.url) {
      await downloadHttp(manifest.url, tmp, manifest)
    } else {
      await fs.copyFile(join(dir, manifest.file), tmp)
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
