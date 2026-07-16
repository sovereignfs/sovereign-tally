'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sdk } from '@sovereignfs/sdk';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
  tallyExpensePayers,
  tallyExpenses,
  tallyExpenseShares,
  tallyGroupMembers,
  tallyGroups,
  tallySettlements,
} from '../_db/schema';

// The SDK intentionally returns an opaque dialect-agnostic DB client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  simplifyDebts: boolean;
  archivedAt: number | null;
  createdAt: number;
}

export interface GroupDetail extends GroupRow {
  /** True when every member's net balance is zero — required to delete (SPL-02). */
  canDelete: boolean;
}

function now() {
  return Math.floor(Date.now() / 1000);
}

async function getContext() {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return { db, userId: session.user.id, tenantId: session.user.tenantId };
}

async function requireMembership(db: Db, tenantId: string, groupId: string, userId: string) {
  const [row] = await db
    .select({ id: tallyGroupMembers.id })
    .from(tallyGroupMembers)
    .where(
      and(
        eq(tallyGroupMembers.tenantId, tenantId),
        eq(tallyGroupMembers.groupId, groupId),
        eq(tallyGroupMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new Error('Group not found.');
}

/**
 * True when every member's net balance (amount paid via non-deleted expenses
 * minus amount owed, adjusted by settlements) is zero — the precondition for
 * deleting a group (SPL-02). Not the full balance-display calculation
 * (lib/balance.ts, debt simplification, multi-currency) — just the yes/no
 * check this guard needs.
 */
async function groupHasZeroBalances(db: Db, tenantId: string, groupId: string): Promise<boolean> {
  const balances = new Map<string, number>();

  const expenseRows = await db
    .select({ id: tallyExpenses.id })
    .from(tallyExpenses)
    .where(
      and(
        eq(tallyExpenses.tenantId, tenantId),
        eq(tallyExpenses.groupId, groupId),
        isNull(tallyExpenses.deletedAt),
      ),
    );
  const expenseIds = expenseRows.map((r) => r.id);

  if (expenseIds.length > 0) {
    const payers = await db
      .select()
      .from(tallyExpensePayers)
      .where(
        and(eq(tallyExpensePayers.tenantId, tenantId), inArray(tallyExpensePayers.expenseId, expenseIds)),
      );
    for (const p of payers) {
      balances.set(p.memberId, (balances.get(p.memberId) ?? 0) + p.amountPaid);
    }

    const shares = await db
      .select()
      .from(tallyExpenseShares)
      .where(
        and(eq(tallyExpenseShares.tenantId, tenantId), inArray(tallyExpenseShares.expenseId, expenseIds)),
      );
    for (const s of shares) {
      balances.set(s.memberId, (balances.get(s.memberId) ?? 0) - s.shareAmount);
    }
  }

  const settlements = await db
    .select()
    .from(tallySettlements)
    .where(and(eq(tallySettlements.tenantId, tenantId), eq(tallySettlements.groupId, groupId)));
  for (const s of settlements) {
    balances.set(s.fromMemberId, (balances.get(s.fromMemberId) ?? 0) + s.amount);
    balances.set(s.toMemberId, (balances.get(s.toMemberId) ?? 0) - s.amount);
  }

  return [...balances.values()].every((balance) => balance === 0);
}

/** Active (non-archived) groups the current user belongs to, alphabetical. */
export async function getGroups(): Promise<GroupRow[]> {
  const { db, userId, tenantId } = await getContext();

  const rows = await db
    .select({ group: tallyGroups })
    .from(tallyGroups)
    .innerJoin(
      tallyGroupMembers,
      and(eq(tallyGroupMembers.groupId, tallyGroups.id), eq(tallyGroupMembers.userId, userId)),
    )
    .where(and(eq(tallyGroups.tenantId, tenantId), isNull(tallyGroups.archivedAt)))
    .orderBy(asc(tallyGroups.name));

  return rows.map((r) => r.group);
}

/** A single group, or null when it doesn't exist or the user isn't a member. */
export async function getGroup(groupId: string): Promise<GroupDetail | null> {
  const { db, userId, tenantId } = await getContext();

  const [membership] = await db
    .select({ id: tallyGroupMembers.id })
    .from(tallyGroupMembers)
    .where(
      and(
        eq(tallyGroupMembers.tenantId, tenantId),
        eq(tallyGroupMembers.groupId, groupId),
        eq(tallyGroupMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!membership) return null;

  const [row] = await db
    .select()
    .from(tallyGroups)
    .where(and(eq(tallyGroups.id, groupId), eq(tallyGroups.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;

  const canDelete = await groupHasZeroBalances(db, tenantId, groupId);
  return { ...row, canDelete };
}

export async function createGroup(formData: FormData) {
  const { db, userId, tenantId } = await getContext();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Group name is required.');

  const description = String(formData.get('description') ?? '').trim();
  const currency = String(formData.get('currency') ?? 'USD').trim().toUpperCase() || 'USD';
  const simplifyDebts = formData.get('simplifyDebts') === 'on';

  const id = randomUUID();
  const ts = now();

  await db.insert(tallyGroups).values({
    id,
    tenantId,
    createdBy: userId,
    name,
    description: description || null,
    currency,
    simplifyDebts,
    archivedAt: null,
    createdAt: ts,
  });

  await db.insert(tallyGroupMembers).values({
    id: randomUUID(),
    tenantId,
    groupId: id,
    userId,
    guestName: null,
    guestEmail: null,
    joinedAt: ts,
  });

  revalidatePath('/tally');
  redirect(`/tally/${id}`);
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Group name is required.');

  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  await db
    .update(tallyGroups)
    .set({ name: trimmed })
    .where(and(eq(tallyGroups.id, groupId), eq(tallyGroups.tenantId, tenantId)));

  revalidatePath('/tally');
}

export async function archiveGroup(groupId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  await db
    .update(tallyGroups)
    .set({ archivedAt: now() })
    .where(and(eq(tallyGroups.id, groupId), eq(tallyGroups.tenantId, tenantId)));

  revalidatePath('/tally');
}

/**
 * Deletes a group and everything scoped to it — only allowed once every
 * member's balance is zero (SPL-02). Expected-failure result, not a throw:
 * a user hits this from the group they're viewing, so it's a normal path,
 * not a bug.
 */
export async function deleteGroup(groupId: string): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  if (!(await groupHasZeroBalances(db, tenantId, groupId))) {
    return { ok: false, error: 'Settle all balances before deleting this group.' };
  }

  const expenseRows = await db
    .select({ id: tallyExpenses.id })
    .from(tallyExpenses)
    .where(and(eq(tallyExpenses.tenantId, tenantId), eq(tallyExpenses.groupId, groupId)));
  const expenseIds = expenseRows.map((r) => r.id);

  if (expenseIds.length > 0) {
    await db
      .delete(tallyExpensePayers)
      .where(
        and(eq(tallyExpensePayers.tenantId, tenantId), inArray(tallyExpensePayers.expenseId, expenseIds)),
      );
    await db
      .delete(tallyExpenseShares)
      .where(
        and(eq(tallyExpenseShares.tenantId, tenantId), inArray(tallyExpenseShares.expenseId, expenseIds)),
      );
    await db
      .delete(tallyExpenses)
      .where(and(eq(tallyExpenses.tenantId, tenantId), eq(tallyExpenses.groupId, groupId)));
  }

  await db
    .delete(tallySettlements)
    .where(and(eq(tallySettlements.tenantId, tenantId), eq(tallySettlements.groupId, groupId)));
  await db
    .delete(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)));
  await db
    .delete(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, tenantId), eq(tallyGroups.id, groupId)));

  revalidatePath('/tally');
  return { ok: true };
}
