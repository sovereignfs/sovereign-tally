/**
 * Balance calculation — computed at query time from raw expense/settlement
 * rows, never stored (SPL-09, SPL-10; SPEC.md "Balance calculation"). Pure
 * functions only; callers own the DB fetch (see actions.ts).
 */

export interface PayerAmount {
  memberId: string;
  /** Cents. */
  amountPaid: number;
}

export interface ShareAmount {
  memberId: string;
  /** Cents. */
  shareAmount: number;
}

export interface SettlementAmount {
  fromMemberId: string;
  toMemberId: string;
  /** Cents. */
  amount: number;
}

/**
 * Net balance per member: positive = the group owes them money, negative =
 * they owe the group (cents). A member absent from the returned map never
 * had an expense/settlement row, so their balance is implicitly zero.
 */
export function computeNetBalances(
  payers: PayerAmount[],
  shares: ShareAmount[],
  settlements: SettlementAmount[],
): Map<string, number> {
  const balances = new Map<string, number>();

  for (const p of payers) {
    balances.set(p.memberId, (balances.get(p.memberId) ?? 0) + p.amountPaid);
  }
  for (const s of shares) {
    balances.set(s.memberId, (balances.get(s.memberId) ?? 0) - s.shareAmount);
  }
  for (const s of settlements) {
    balances.set(s.fromMemberId, (balances.get(s.fromMemberId) ?? 0) + s.amount);
    balances.set(s.toMemberId, (balances.get(s.toMemberId) ?? 0) - s.amount);
  }

  return balances;
}
