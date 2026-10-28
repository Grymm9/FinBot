// Shared SQL WHERE fragments so every calculation treats "real" transactions
// the same way: only from enabled accounts, and excluding internal money
// movement that is neither income nor spend.

export const ENABLED_ACCOUNTS = 'account_id IN (SELECT id FROM accounts WHERE enabled = 1)'

/**
 * Internal money movement that must NOT be counted as income or spend:
 *   - TRANSFER type       : "MB/PM TRANSFER" between the user's own accounts
 *   - ATM type            : cash withdrawals (cash spend is untracked)
 *   - any "TFR FROM ..."  : direct credits funding an envelope account. The
 *                           bank sometimes prefixes these with the envelope
 *                           name ("Bundle TFR FROM DA ATTINGER"), so we also
 *                           match funding from DA ATTINGER anywhere in the
 *                           description. A prefixed transfer from another
 *                           person ("Yippee TFR FROM AJ DOWLING") is a real
 *                           reimbursement and stays as income.
 *   - "SHARESIES ..."     : investment round-trip (out + weekly return)
 *   - "TFR TO ..."        : envelope funding — only when a matching
 *                           "TFR FROM DA ATTINGER ..." of the same amount lands
 *                           on the same day (same-amount pair). A "TFR TO" with
 *                           no matching incoming is a direct external payment
 *                           (e.g. BJJ gym, Impaler Records) and stays as spend.
 *
 * Person-to-person reimbursements arrive as "From MS A J DOWLING ..." (not
 * "TFR FROM"), so they are preserved and netted separately as bill splits.
 *
 * NOTE: the correlated subquery refers to the outer `transactions` table by
 * name; every REAL_TX caller selects `FROM transactions` without an alias.
 */
export const NOT_INTERNAL = `NOT (
  COALESCE(type,'') = 'TRANSFER'
  OR COALESCE(type,'') = 'ATM'
  OR COALESCE(description,'') LIKE 'TFR FROM%'
  OR COALESCE(description,'') LIKE '%TFR FROM DA ATTINGER%'
  OR COALESCE(description,'') LIKE '%SHARESIES%'
  OR (
    COALESCE(description,'') LIKE '%TFR TO%'
    AND EXISTS (
      SELECT 1 FROM transactions x
      WHERE x.description LIKE '%TFR FROM DA ATTINGER%'
        AND x.date = transactions.date
        AND ABS(x.amount + transactions.amount) < 0.01
    )
  )
)`

export const REAL_TX = `${ENABLED_ACCOUNTS} AND ${NOT_INTERNAL}`

/**
 * Envelope funding transfers ("TFR TO ..." standing orders out of Income).
 * Used by missed-payment detection, which checks that each routed destination
 * was actually funded — these transfers are internal, so they are excluded
 * from REAL_TX but must still be visible here.
 */
export const FUNDING_TX = `${ENABLED_ACCOUNTS} AND COALESCE(description,'') LIKE 'TFR TO%'`
