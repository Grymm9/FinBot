// Shared budget-frequency helpers used by both the main process and renderer.

export const FREQUENCIES: Array<{ value: string; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'weekly', label: 'Weekly' }
]

/** Normalise a per-period amount to its monthly equivalent. */
export function monthlyAmount(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly':
      return amount * (52 / 12)
    case 'fortnightly':
      return amount * (26 / 12)
    case 'yearly':
      return amount / 12
    default:
      return amount
  }
}

/** Human-readable label for a frequency value. */
export function frequencyLabel(frequency: string): string {
  return FREQUENCIES.find((f) => f.value === frequency)?.label ?? 'Monthly'
}

/** Frequency options for insurance premiums (includes yearly). */
export const INSURANCE_FREQUENCIES: Array<{ value: string; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' }
]
