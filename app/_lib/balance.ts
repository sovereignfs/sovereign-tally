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

export interface SimplifiedPayment {
  fromMemberId: string;
  toMemberId: string;
  /** Cents. */
  amount: number;
}

/**
 * Greedy minimum-transaction debt simplification (SPL-11): repeatedly match
 * the largest debtor against the largest creditor, settling the smaller of
 * the two amounts, until every net balance is zero. Not the theoretical
 * minimum in every case (that's NP-hard in general), but the standard
 * greedy approximation used by every splitwise-style app in practice, and
 * optimal for the common case of one or two connected components.
 */
export function simplifyDebts(balances: Map<string, number>): SimplifiedPayment[] {
  const debtors: { memberId: string; amount: number }[] = [];
  const creditors: { memberId: string; amount: number }[] = [];

  for (const [memberId, amount] of balances) {
    if (amount < 0) debtors.push({ memberId, amount: -amount });
    else if (amount > 0) creditors.push({ memberId, amount });
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const payments: SimplifiedPayment[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors.at(i);
    const creditor = creditors.at(j);
    if (!debtor || !creditor) break;

    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0) {
      payments.push({ fromMemberId: debtor.memberId, toMemberId: creditor.memberId, amount });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount === 0) i++;
    if (creditor.amount === 0) j++;
  }

  return payments;
}
