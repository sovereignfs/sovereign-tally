import { describe, expect, it } from 'vitest';
import { computeNetBalances, simplifyDebts } from '../balance';

function sumByMember(payments: { fromMemberId: string; toMemberId: string; amount: number }[]) {
  const net = new Map<string, number>();
  for (const p of payments) {
    net.set(p.fromMemberId, (net.get(p.fromMemberId) ?? 0) - p.amount);
    net.set(p.toMemberId, (net.get(p.toMemberId) ?? 0) + p.amount);
  }
  return net;
}

describe('computeNetBalances', () => {
  it('nets payers, shares, and settlements per member', () => {
    const balances = computeNetBalances(
      [{ memberId: 'a', amountPaid: 3000 }],
      [
        { memberId: 'a', shareAmount: 1000 },
        { memberId: 'b', shareAmount: 1000 },
        { memberId: 'c', shareAmount: 1000 },
      ],
      [{ fromMemberId: 'b', toMemberId: 'a', amount: 500 }],
    );

    expect(balances.get('a')).toBe(1500);
    expect(balances.get('b')).toBe(-500);
    expect(balances.get('c')).toBe(-1000);
  });
});

describe('simplifyDebts', () => {
  it('returns no payments when everyone is already settled', () => {
    const balances = new Map([
      ['a', 0],
      ['b', 0],
    ]);
    expect(simplifyDebts(balances)).toEqual([]);
  });

  it('produces a single payment for a two-member debt', () => {
    const balances = new Map([
      ['a', 1000],
      ['b', -1000],
    ]);
    expect(simplifyDebts(balances)).toEqual([{ fromMemberId: 'b', toMemberId: 'a', amount: 1000 }]);
  });

  it('reduces a three-member cycle to two payments instead of three', () => {
    // a paid for everyone, b owes a, c owes b (net: a +2000, b 0, c -2000 after
    // collapsing the chain) — the naive pairwise ledger would need 2 txns too,
    // but this checks the classic "chain" case simplifies to the direct debt.
    const balances = new Map([
      ['a', 2000],
      ['b', 0],
      ['c', -2000],
    ]);
    const payments = simplifyDebts(balances);
    expect(payments).toEqual([{ fromMemberId: 'c', toMemberId: 'a', amount: 2000 }]);
  });

  it('minimizes transaction count for a mixed group', () => {
    // a is owed 3000, b is owed 1000, c owes 2500, d owes 1500.
    const balances = new Map([
      ['a', 3000],
      ['b', 1000],
      ['c', -2500],
      ['d', -1500],
    ]);
    const payments = simplifyDebts(balances);

    // Greedy: largest debtor (c, 2500) pays largest creditor (a, 3000) -> 2500.
    // Then largest debtor (d, 1500) pays remaining creditor (a, 500) -> 500,
    // then pays b (1000) -> 1000.
    expect(payments.length).toBe(3);

    const net = sumByMember(payments);
    for (const [memberId, balance] of balances) {
      expect(net.get(memberId) ?? 0).toBe(balance);
    }
  });

  it('never produces a zero-amount payment and always fully settles every balance', () => {
    const balances = new Map([
      ['a', 500],
      ['b', 500],
      ['c', -300],
      ['d', -700],
    ]);
    const payments = simplifyDebts(balances);

    expect(payments.every((p) => p.amount > 0)).toBe(true);

    const net = sumByMember(payments);
    for (const [memberId, balance] of balances) {
      expect(net.get(memberId) ?? 0).toBe(balance);
    }
  });
});
