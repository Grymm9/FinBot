/**
 * Character budgeting for the verbatim conversation window.
 *
 * Rows are expected newest-first. We keep the newest rows and drop the oldest
 * until the total fits, never going below a small minimum so the model always
 * has the immediate back-and-forth even after a very large pasted message.
 */

export const WINDOW_MAX_CHARS = 40_000
export const WINDOW_MIN_MESSAGES = 8

export function trimConversationWindow<T extends { content: string }>(
  rows: T[],
  maxChars = WINDOW_MAX_CHARS,
  minMessages = WINDOW_MIN_MESSAGES
): T[] {
  let chars = 0
  let keep = rows.length
  for (let i = 0; i < rows.length; i++) {
    const next = chars + rows[i].content.length
    if (next > maxChars && i >= minMessages) {
      keep = i
      break
    }
    chars = next
  }
  return rows.slice(0, keep)
}
