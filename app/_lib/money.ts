/**
 * Amounts are always stored as integer cents (SPEC.md data model) — these
 * helpers are the only place a dollars-string ever touches a float, and only
 * transiently, for the UI layer.
 */

/** Parses a user-entered dollar amount into cents, or null if not a valid positive amount. */
export function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Splits `totalCents` evenly across `count` shares, distributing the leftover
 * cents (from integer division) one-by-one to the first shares so the parts
 * sum back to exactly `totalCents` — never drop or invent a cent.
 */
export function splitEvenly(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Splits `totalCents` proportionally to `weights` (e.g. percentages ×1000 to
 * preserve decimals, or raw share counts) using largest-remainder rounding:
 * floor each proportional share, then hand the leftover cents one-by-one to
 * the entries with the largest fractional remainder. Guarantees the result
 * sums to exactly `totalCents`, unlike rounding each share independently
 * (which can drift by a cent or two). Used for percentage (SPL-13) and
 * shares (SPL-14) expense splits.
 */
export function splitByWeights(totalCents: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const raw = weights.map((w) => (totalCents * w) / totalWeight);
  const floors = raw.map(Math.floor);
  const distributed = floors.reduce((sum, v) => sum + v, 0);
  const remainder = totalCents - distributed;

  const byRemainder = raw
    .map((v, i) => ({ i, fraction: v - Math.floor(v) }))
    .sort((a, b) => b.fraction - a.fraction);

  const result = [...floors];
  for (let k = 0; k < remainder; k++) {
    const entry = byRemainder[k];
    if (!entry) break;
    result[entry.i] = (result[entry.i] ?? 0) + 1;
  }
  return result;
}

/**
 * Parses a user-entered exchange rate (e.g. "1.0842") into micros (×1,000,000
 * integer) — SPL-22's manual, never-a-float storage convention. Null if not
 * a valid positive rate.
 */
export function rateToMicros(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 1_000_000);
}

export function microsToRate(micros: number): string {
  return (micros / 1_000_000).toString();
}

/** Converts a foreign-currency expense amount into the group's currency using its stored manual exchange rate. */
export function convertCentsWithRate(amountCents: number, exchangeRateMicros: number): number {
  return Math.round((amountCents * exchangeRateMicros) / 1_000_000);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Reduces stored per-member cents amounts back to a minimal integer ratio,
 * for pre-filling a "shares" split editor from persisted data — the schema
 * only stores the resulting cents, not the original share counts, so this
 * is a best-effort reconstruction (largest-remainder rounding in
 * `splitByWeights` isn't perfectly invertible), not a guaranteed exact
 * inverse of the original input.
 */
export function centsToShareRatio(amounts: number[]): number[] {
  if (amounts.length === 0) return [];
  const divisor = amounts.reduce((acc, n) => gcd(acc, n), amounts[0] as number);
  if (divisor === 0) return amounts.map(() => 1);
  return amounts.map((n) => n / divisor);
}
