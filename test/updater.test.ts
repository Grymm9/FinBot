import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareVersions,
  formatBytes,
  isNewer,
  parseManifest,
  sha512Hex
} from '../src/main/services/updater-math.ts'

test('compareVersions orders numeric segments, not strings', () => {
  assert.equal(compareVersions('0.9.9', '0.10.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
  assert.equal(compareVersions('0.1.2', '0.1.10'), -1)
})

test('a release outranks its own pre-release', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0-beta'), 1)
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1)
})

test('isNewer only upgrades forward', () => {
  assert.equal(isNewer('0.2.0', '0.1.0'), true)
  assert.equal(isNewer('0.1.0', '0.1.0'), false)
  assert.equal(isNewer('0.0.9', '0.1.0'), false)
})

const validSha = 'a'.repeat(128)

test('parseManifest accepts a well-formed manifest', () => {
  const m = parseManifest(
    JSON.stringify({
      version: '0.2.0',
      file: 'FinanceBot Setup 0.2.0.exe',
      sha512: validSha.toUpperCase(),
      size: 1234,
      notes: 'Fixed the forecast.'
    })
  )
  assert.ok(m)
  assert.equal(m?.version, '0.2.0')
  assert.equal(m?.sha512, validSha) // normalised to lowercase
  assert.equal(m?.size, 1234)
  assert.equal(m?.notes, 'Fixed the forecast.')
})

test('parseManifest rejects malformed or unsafe manifests', () => {
  assert.equal(parseManifest('not json'), null)
  assert.equal(parseManifest(JSON.stringify({ version: 'v2', file: 'a.exe', sha512: validSha })), null)
  assert.equal(parseManifest(JSON.stringify({ version: '1.0.0', file: '', sha512: validSha })), null)
  // Path traversal / absolute paths are refused.
  assert.equal(parseManifest(JSON.stringify({ version: '1.0.0', file: '../evil.exe', sha512: validSha })), null)
  assert.equal(parseManifest(JSON.stringify({ version: '1.0.0', file: 'C:\\evil.exe', sha512: validSha })), null)
  // Bad digest length.
  assert.equal(parseManifest(JSON.stringify({ version: '1.0.0', file: 'a.exe', sha512: 'abc' })), null)
})

test('parseManifest only keeps http(s) download urls', () => {
  const base = { version: '1.0.0', file: 'a.exe', sha512: validSha }
  assert.equal(parseManifest(JSON.stringify({ ...base, url: 'javascript:alert(1)' }))?.url, undefined)
  assert.equal(parseManifest(JSON.stringify({ ...base, url: 'https://example.com/a.exe' }))?.url, 'https://example.com/a.exe')
})

test('sha512Hex matches the known digest of "abc"', () => {
  const digest = sha512Hex(new TextEncoder().encode('abc'))
  assert.equal(
    digest,
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
  )
})

test('formatBytes renders readable sizes', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})
