import { monthlyFromFourWeekly } from './deal-math'
import type { DealCategory } from '@shared/types'

/**
 * Seed catalogue for the deals screen.
 *
 * Only prices published on a page that can actually be read by the app are
 * listed here. Several NZ retailers render their pricing in the browser, which
 * means a server-side fetch sees plan names but no numbers — those can't be
 * tracked automatically, so they aren't shipped as if they could be.
 *
 * Every entry carries `sourceUrl`. The refresh job re-fetches it and flips the
 * plan to `stale` when the page stops responding, so a price never silently
 * rots: the UI shows the date it was verified.
 *
 * Verified 29 Oct 2026 from skinny.co.nz.
 */

export interface SeedPlan {
  category: DealCategory
  provider: string
  planName: string
  monthlyPrice: number | null
  variableRate: number | null
  dailyCharge: number | null
  region: string | null
  sourceUrl: string | null
  notes: string | null
}

const SKINNY_BROADBAND = 'https://www.skinny.co.nz/broadband/'
const SKINNY_MOBILE = 'https://www.skinny.co.nz/pricing/plans/'

/**
 * Skinny broadband. Prices are the standing monthly rate; the site is running
 * a discount at the moment, which is noted rather than baked in — a promo price
 * is not what you'll be paying in six months.
 */
const broadband: SeedPlan[] = [
  {
    category: 'broadband',
    provider: 'Skinny',
    planName: 'Wireless 60GB',
    monthlyPrice: 45,
    variableRate: null,
    dailyCharge: null,
    region: null,
    sourceUrl: SKINNY_BROADBAND,
    notes: '4G wireless. Listed at $35 while the current promo runs.'
  },
  {
    category: 'broadband',
    provider: 'Skinny',
    planName: 'Wireless 300GB',
    monthlyPrice: 50,
    variableRate: null,
    dailyCharge: null,
    region: null,
    sourceUrl: SKINNY_BROADBAND,
    notes: '4G wireless. Listed at $40 while the current promo runs.'
  },
  {
    category: 'broadband',
    provider: 'Skinny',
    planName: 'Wireless Unlimited',
    monthlyPrice: 55,
    variableRate: null,
    dailyCharge: null,
    region: null,
    sourceUrl: SKINNY_BROADBAND,
    notes: '4G wireless, fair use applies.'
  },
  {
    category: 'broadband',
    provider: 'Skinny',
    planName: 'Fibre 300/100',
    monthlyPrice: 93,
    variableRate: null,
    dailyCharge: null,
    region: null,
    sourceUrl: SKINNY_BROADBAND,
    notes: 'Standard rate; $78 with a BYO modem for the first 12 months.'
  },
  {
    category: 'broadband',
    provider: 'Skinny',
    planName: 'Fibre 900/500',
    monthlyPrice: 108,
    variableRate: null,
    dailyCharge: null,
    region: null,
    sourceUrl: SKINNY_BROADBAND,
    notes: 'Standard rate; $93 with a BYO modem for the first 12 months.'
  }
]

/** Skinny prepay mobile. The 28-day cycle is annualised into a monthly figure. */
const mobilePlans: Array<[string, number, string]> = [
  ['Prepay 1GB', 13, '28-day cycle, unlimited NZ/AU minutes.'],
  ['Prepay 2GB', 17, '28-day cycle, rollover data.'],
  ['Prepay 3GB', 22, '28-day cycle, rollover data.'],
  ['Prepay 4GB', 27, '28-day cycle, rollover data.'],
  ['Endless 40GB', 40, '28-day cycle, then reduced speeds.'],
  ['Endless 50GB', 50, '28-day cycle, then reduced speeds.'],
  ['Unlimited', 75, '28-day cycle, fair use applies.']
]

const mobile: SeedPlan[] = mobilePlans.map(([planName, fourWeekly, notes]) => ({
  category: 'mobile' as const,
  provider: 'Skinny',
  planName,
  monthlyPrice: monthlyFromFourWeekly(fourWeekly),
  variableRate: null,
  dailyCharge: null,
  region: null,
  sourceUrl: SKINNY_MOBILE,
  notes
}))

/**
 * Power is deliberately empty.
 *
 * Retailers price electricity per address and lines network, and the two
 * comparison sites that do hold per-network rates render them client-side. Any
 * number seeded here would be a guess dressed up as a quote, which is worse
 * than no number at all. The Deals screen instead reads your real rates off a
 * bill and lets you add competing plans — after which the ranking is exact.
 */
const power: SeedPlan[] = []

export const SEED_PLANS: SeedPlan[] = [...broadband, ...mobile, ...power]

/**
 * When the shipped prices above were read. Kept fixed rather than stamped at
 * install time so a reinstall never makes an old price look freshly checked.
 */
export const SEED_VERIFIED_AT = Date.parse('2026-10-29T12:00:00+13:00')

/** Where to send someone when the catalogue can't answer the question. */
export const COMPARE_LINKS: Record<DealCategory, { label: string; url: string }> = {
  power: {
    label: 'Compare 10 retailers on the Orion (Christchurch) network',
    url: 'https://selectra.nz/energy/electricity-prices/compare-electricity-prices-nz'
  },
  broadband: {
    label: 'Check fibre availability at your address',
    url: 'https://www.skinny.co.nz/broadband/'
  },
  mobile: {
    label: 'Compare prepay plans',
    url: 'https://www.skinny.co.nz/pricing/plans/'
  }
}
