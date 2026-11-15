import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trimConversationWindow } from '../src/main/services/conversation-window.ts'

const rows = (count: number, size: number): Array<{ content: string }> =>
  Array.from({ length: count }, (_, i) => ({ content: `${i}`.padEnd(size, 'x') }))

test('keeps every message when the window is under the character cap', () => {
  const input = rows(5, 100)
  assert.equal(trimConversationWindow(input, 1000).length, 5)
})

test('drops oldest messages first when over the cap', () => {
  const input = rows(10, 100)
  const kept = trimConversationWindow(input, 350, 2)
  assert.equal(kept.length, 3)
  assert.deepEqual(kept, input.slice(0, 3))
})

test('never drops below the minimum message count', () => {
  const input = rows(10, 10_000)
  const kept = trimConversationWindow(input, 1_000, 8)
  assert.equal(kept.length, 8)
})

test('an exact fit is kept in full', () => {
  const input = rows(3, 100)
  assert.equal(trimConversationWindow(input, 300).length, 3)
})

test('an empty conversation stays empty', () => {
  assert.deepEqual(trimConversationWindow([], 1000), [])
})
