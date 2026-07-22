'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sdk } from '@sovereignfs/sdk';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
  tallyExpenseComments,
  tallyExpensePayers,
  tallyExpenses,
  tallyExpenseShares,
  tallyGroupMembers,
  tallyGroups,
  tallySettlements,
} from '../_db/schema';
import { recordActivity } from './activity';
import { sendUserEmail } from './email';
import { computeNetBalances, simplifyDebts } from './balance';
import { isExpenseCategory } from './categories';
import { notifyUser } from './notify';
import { centsToDollars, splitByWeights, splitEvenly } from './money';

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

export interface MemberRow {
  id: string;
  userId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  /** Resolved display name — directory name/email for instance users, guestName for guests. */
  displayName: string;
  joinedAt: number;
  /** True when this member's balance is zero and they aren't the group's last member (SPL-04). */
  canRemove: boolean;
}

export interface DirectoryUserOption {
  id: string;
  name: string;
  email: string;
}

export interface MemberOption {
  id: string;
  displayName: string;
}

export interface ExpenseRow {
  id: string;
  description: string;
  /** Cents. */
  amount: number;
  currency: string;
  /** Set only when `currency` differs from the group's own currency (SPL-22). */
  exchangeRateMicros: number | null;
  category: string;
  /** ISO date string 'YYYY-MM-DD'. */
  date: string;
  payerName: string;
  participantNames: string[];
  createdAt: number;
}

export type SplitMethod = 'equal' | 'amount' | 'percentage' | 'shares';

export interface ExpenseParticipantInput {
  memberId: string;
  /** Cents. Required (and validated) only when splitMethod is 'amount'. */
  amountCents?: number;
  /** e.g. 33.5 meaning 33.5%. Required only when splitMethod is 'percentage'. */
  percentage?: number;
  /** Positive integer. Required only when splitMethod is 'shares'. */
  shares?: number;
}

export interface ExpensePayerInput {
  memberId: string;
  /** Cents. Must sum to the expense total across all payers (SPL-15). */
  amountPaidCents: number;
}

export interface AddExpenseInput {
  description: string;
  amountCents: number;
  /** ISO date string 'YYYY-MM-DD'. */
  date: string;
  category: string;
  payers: ExpensePayerInput[];
  splitMethod: SplitMethod;
  participants: ExpenseParticipantInput[];
  /** ISO 4217. Omit to use the group's own currency (SPL-21). */
  currency?: string;
  /**
   * Required only when `currency` differs from the group's own currency
   * (SPL-22): 1 unit of `currency` equals `exchangeRateMicros / 1,000,000`
   * units of the group's currency.
   */
  exchangeRateMicros?: number;
}

/** Full expense record for editing (SPL-06) — raw member ids and cents, not display strings. */
export interface ExpenseDetail {
  id: string;
  description: string;
  /** Cents. */
  amountCents: number;
  currency: string;
  exchangeRateMicros: number | null;
  category: string;
  /** ISO date string 'YYYY-MM-DD'. */
  date: string;
  splitMethod: SplitMethod;
  payers: { memberId: string; amountPaidCents: number }[];
  shares: { memberId: string; shareAmountCents: number }[];
}

function now() {
  return Math.floor(Date.now() / 1000);
}

/** Exported for reuse by the CSV export route handler (app/export/[groupId]/route.ts). */
export async function getContext() {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return { db, userId: session.user.id, tenantId: session.user.tenantId };
}

/** Exported for reuse by the CSV export route handler (app/export/[groupId]/route.ts). */
export async function requireMembership(db: Db, tenantId: string, groupId: string, userId: string) {
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
 * Fetches the raw rows `computeNetBalances` (lib/balance.ts) needs for one
 * group and delegates to it, bucketed by currency (SPL-23) — the "at query
 * time" half of SPL-09/SPL-10. Also the yes/no input the group-delete guard
 * (SPL-02) and member-remove guard (SPL-04) need; a member absent from a
 * currency's map has a zero balance in that currency (never had an
 * expense/settlement row in it).
 *
 * Payers/shares don't carry their own currency — only their parent expense
 * does — so expenses are fetched with `currency` and used to bucket their
 * payer/share rows; settlements already carry `currency` directly.
 */
async function computeGroupBalancesByCurrency(
  db: Db,
  tenantId: string,
  groupId: string,
): Promise<Map<string, Map<string, number>>> {
  const expenseRows = await db
    .select({ id: tallyExpenses.id, currency: tallyExpenses.currency })
    .from(tallyExpenses)
    .where(
      and(
        eq(tallyExpenses.tenantId, tenantId),
        eq(tallyExpenses.groupId, groupId),
        isNull(tallyExpenses.deletedAt),
      ),
    );
  const expenseIds = expenseRows.map((r) => r.id);
  const currencyByExpenseId = new Map(expenseRows.map((r) => [r.id, r.currency]));

  const [payers, shares] =
    expenseIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(tallyExpensePayers)
            .where(
              and(
                eq(tallyExpensePayers.tenantId, tenantId),
                inArray(tallyExpensePayers.expenseId, expenseIds),
              ),
            ),
          db
            .select()
            .from(tallyExpenseShares)
            .where(
              and(
                eq(tallyExpenseShares.tenantId, tenantId),
                inArray(tallyExpenseShares.expenseId, expenseIds),
              ),
            ),
        ])
      : [[], []];

  const settlements = await db
    .select()
    .from(tallySettlements)
    .where(and(eq(tallySettlements.tenantId, tenantId), eq(tallySettlements.groupId, groupId)));

  const currencies = new Set<string>([...expenseRows.map((r) => r.currency), ...settlements.map((s) => s.currency)]);

  const result = new Map<string, Map<string, number>>();
  for (const currency of currencies) {
    const currencyPayers = payers.filter((p) => currencyByExpenseId.get(p.expenseId) === currency);
    const currencyShares = shares.filter((s) => currencyByExpenseId.get(s.expenseId) === currency);
    const currencySettlements = settlements.filter((s) => s.currency === currency);
    result.set(currency, computeNetBalances(currencyPayers, currencyShares, currencySettlements));
  }
  return result;
}

/** True when every member's net balance is zero in every currency — the precondition for deleting a group (SPL-02). */
async function groupHasZeroBalances(db: Db, tenantId: string, groupId: string): Promise<boolean> {
  const byCurrency = await computeGroupBalancesByCurrency(db, tenantId, groupId);
  for (const balances of byCurrency.values()) {
    if ([...balances.values()].some((balance) => balance !== 0)) return false;
  }
  return true;
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

/**
 * Resolves member display names — directory name/email for instance users
 * (via a single batched `sdk.directory.resolveUsers` call), guestName for
 * guests. Shared by every read that lists members or attributes an
 * expense/payer/share to a member.
 */
export async function resolveMemberDisplayNames(
  rows: { id: string; userId: string | null; guestName: string | null }[],
): Promise<Map<string, string>> {
  const instanceUserIds = rows.map((r) => r.userId).filter((id): id is string => id !== null);
  const directoryUsers =
    instanceUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: instanceUserIds }) : [];
  const directoryById = new Map(directoryUsers.map((u) => [u.id, u]));

  return new Map(
    rows.map((r) => {
      const directoryUser = r.userId ? directoryById.get(r.userId) : undefined;
      return [r.id, directoryUser?.name ?? directoryUser?.email ?? r.guestName ?? 'Unknown'];
    }),
  );
}

/** Members of a group, instance users first (join order), then guests. */
export async function getGroupMembers(groupId: string): Promise<MemberRow[]> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const rows = await db
    .select()
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)))
    .orderBy(asc(tallyGroupMembers.joinedAt));

  const displayNames = await resolveMemberDisplayNames(rows);
  const balancesByCurrency = await computeGroupBalancesByCurrency(db, tenantId, groupId);

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    guestName: r.guestName,
    guestEmail: r.guestEmail,
    displayName: displayNames.get(r.id) ?? 'Unknown',
    joinedAt: r.joinedAt,
    canRemove:
      [...balancesByCurrency.values()].every((balances) => (balances.get(r.id) ?? 0) === 0) &&
      rows.length > 1,
  }));
}

/** Lightweight member id + display name list, for expense payer/participant pickers. */
export async function getGroupMemberOptions(groupId: string): Promise<MemberOption[]> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const rows = await db
    .select({
      id: tallyGroupMembers.id,
      userId: tallyGroupMembers.userId,
      guestName: tallyGroupMembers.guestName,
    })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)))
    .orderBy(asc(tallyGroupMembers.joinedAt));

  const displayNames = await resolveMemberDisplayNames(rows);
  return rows.map((r) => ({ id: r.id, displayName: displayNames.get(r.id) ?? 'Unknown' }));
}

/** Instance users matching `query`, excluding people already in the group (SPL-03). */
export async function searchMembersToAdd(
  groupId: string,
  query: string,
): Promise<DirectoryUserOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const existing = await db
    .select({ userId: tallyGroupMembers.userId })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)));
  const existingIds = new Set(existing.map((r) => r.userId).filter(Boolean));

  const results = await sdk.directory.searchUsers({ query: trimmed, limit: 8 });
  return results
    .filter((u) => !existingIds.has(u.id))
    .map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email }));
}

/** Adds an instance user to the group (SPL-03). */
export async function addInstanceMember(groupId: string, memberUserId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const [existing] = await db
    .select({ id: tallyGroupMembers.id })
    .from(tallyGroupMembers)
    .where(
      and(
        eq(tallyGroupMembers.tenantId, tenantId),
        eq(tallyGroupMembers.groupId, groupId),
        eq(tallyGroupMembers.userId, memberUserId),
      ),
    )
    .limit(1);
  if (existing) throw new Error('That person is already in this group.');

  await db.insert(tallyGroupMembers).values({
    id: randomUUID(),
    tenantId,
    groupId,
    userId: memberUserId,
    guestName: null,
    guestEmail: null,
    joinedAt: now(),
  });

  const [group] = await db
    .select({ name: tallyGroups.name })
    .from(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, tenantId), eq(tallyGroups.id, groupId)))
    .limit(1);
  if (group && memberUserId !== userId) {
    await notifyUser({
      recipientUserId: memberUserId,
      title: `Added to "${group.name}"`,
      body: 'You were added to a Tally group.',
      url: `/tally/${groupId}`,
    });
  }

  revalidatePath(`/tally/${groupId}`);
}

/** Adds a guest member by name and optional email (SPL-03). */
export async function addGuestMember(groupId: string, name: string, email: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Guest name is required.');

  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  await db.insert(tallyGroupMembers).values({
    id: randomUUID(),
    tenantId,
    groupId,
    userId: null,
    guestName: trimmed,
    guestEmail: email.trim() || null,
    joinedAt: now(),
  });

  revalidatePath(`/tally/${groupId}`);
}

/**
 * Removes a member from a group — only when their balance is zero and
 * they aren't the group's last member (SPL-04). Expected-failure result,
 * not a throw: reachable from normal use of the members list.
 */
export async function removeMember(groupId: string, memberId: string): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const memberRows = await db
    .select({ id: tallyGroupMembers.id })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)));
  if (memberRows.length <= 1) {
    return { ok: false, error: 'A group needs at least one member.' };
  }

  const balancesByCurrency = await computeGroupBalancesByCurrency(db, tenantId, groupId);
  const isSettled = [...balancesByCurrency.values()].every((balances) => (balances.get(memberId) ?? 0) === 0);
  if (!isSettled) {
    return { ok: false, error: "Settle this member's balance before removing them." };
  }

  await db
    .delete(tallyGroupMembers)
    .where(
      and(
        eq(tallyGroupMembers.tenantId, tenantId),
        eq(tallyGroupMembers.groupId, groupId),
        eq(tallyGroupMembers.id, memberId),
      ),
    );

  revalidatePath(`/tally/${groupId}`);
  return { ok: true };
}

/** Non-deleted expenses for a group, most recent first (SPL-05). */
export async function getExpenses(groupId: string): Promise<ExpenseRow[]> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const expenseRows = await db
    .select()
    .from(tallyExpenses)
    .where(
      and(
        eq(tallyExpenses.tenantId, tenantId),
        eq(tallyExpenses.groupId, groupId),
        isNull(tallyExpenses.deletedAt),
      ),
    )
    .orderBy(desc(tallyExpenses.date), desc(tallyExpenses.createdAt));
  if (expenseRows.length === 0) return [];

  const expenseIds = expenseRows.map((r) => r.id);
  const payers = await db
    .select()
    .from(tallyExpensePayers)
    .where(
      and(eq(tallyExpensePayers.tenantId, tenantId), inArray(tallyExpensePayers.expenseId, expenseIds)),
    );
  const shares = await db
    .select()
    .from(tallyExpenseShares)
    .where(
      and(eq(tallyExpenseShares.tenantId, tenantId), inArray(tallyExpenseShares.expenseId, expenseIds)),
    );

  const memberRows = await db
    .select({
      id: tallyGroupMembers.id,
      userId: tallyGroupMembers.userId,
      guestName: tallyGroupMembers.guestName,
    })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)));
  const displayNames = await resolveMemberDisplayNames(memberRows);

  const payerNamesByExpense = new Map<string, string[]>();
  for (const p of payers) {
    const list = payerNamesByExpense.get(p.expenseId) ?? [];
    list.push(displayNames.get(p.memberId) ?? 'Unknown');
    payerNamesByExpense.set(p.expenseId, list);
  }

  const participantNamesByExpense = new Map<string, string[]>();
  for (const s of shares) {
    const list = participantNamesByExpense.get(s.expenseId) ?? [];
    list.push(displayNames.get(s.memberId) ?? 'Unknown');
    participantNamesByExpense.set(s.expenseId, list);
  }

  return expenseRows.map((e) => ({
    id: e.id,
    description: e.description,
    amount: e.amount,
    currency: e.currency,
    exchangeRateMicros: e.exchangeRateMicros,
    category: e.category,
    date: e.date,
    payerName: (payerNamesByExpense.get(e.id) ?? []).join(', '),
    participantNames: participantNamesByExpense.get(e.id) ?? [],
    createdAt: e.createdAt,
  }));
}

export type ActivityEntry =
  | {
      type: 'expense';
      id: string;
      description: string;
      amount: number;
      currency: string;
      payerName: string;
      /** True when the expense has since been soft-deleted (SPL-07) — still shown, per SPL-08. */
      deleted: boolean;
      createdAt: number;
    }
  | {
      type: 'settlement';
      id: string;
      fromName: string;
      toName: string;
      amount: number;
      currency: string;
      notes: string | null;
      createdAt: number;
    };

/**
 * Chronological feed of every expense and settlement in a group, most recent
 * first (SPL-08). Soft-deleted expenses stay in the feed (marked `deleted`)
 * rather than disappearing — the row itself is preserved for exactly this
 * reason (see `deleteExpense`). Settlements (SPL-16) are recorded starting
 * v0.2; the query already covers them so the feed needs no changes once that
 * ships.
 */
export async function getActivityFeed(groupId: string): Promise<ActivityEntry[]> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const [expenseRows, settlementRows, memberRows] = await Promise.all([
    db
      .select()
      .from(tallyExpenses)
      .where(and(eq(tallyExpenses.tenantId, tenantId), eq(tallyExpenses.groupId, groupId))),
    db
      .select()
      .from(tallySettlements)
      .where(and(eq(tallySettlements.tenantId, tenantId), eq(tallySettlements.groupId, groupId))),
    db
      .select({
        id: tallyGroupMembers.id,
        userId: tallyGroupMembers.userId,
        guestName: tallyGroupMembers.guestName,
      })
      .from(tallyGroupMembers)
      .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId))),
  ]);

  const displayNames = await resolveMemberDisplayNames(memberRows);

  const expenseIds = expenseRows.map((e) => e.id);
  const payers =
    expenseIds.length > 0
      ? await db
          .select()
          .from(tallyExpensePayers)
          .where(
            and(
              eq(tallyExpensePayers.tenantId, tenantId),
              inArray(tallyExpensePayers.expenseId, expenseIds),
            ),
          )
      : [];
  const payerNamesByExpense = new Map<string, string[]>();
  for (const p of payers) {
    const list = payerNamesByExpense.get(p.expenseId) ?? [];
    list.push(displayNames.get(p.memberId) ?? 'Unknown');
    payerNamesByExpense.set(p.expenseId, list);
  }

  const entries: ActivityEntry[] = [
    ...expenseRows.map(
      (e): ActivityEntry => ({
        type: 'expense',
        id: e.id,
        description: e.description,
        amount: e.amount,
        currency: e.currency,
        payerName: (payerNamesByExpense.get(e.id) ?? []).join(', '),
        deleted: e.deletedAt != null,
        createdAt: e.createdAt,
      }),
    ),
    ...settlementRows.map(
      (s): ActivityEntry => ({
        type: 'settlement',
        id: s.id,
        fromName: displayNames.get(s.fromMemberId) ?? 'Unknown',
        toName: displayNames.get(s.toMemberId) ?? 'Unknown',
        amount: s.amount,
        currency: s.currency,
        notes: s.notes,
        createdAt: s.createdAt,
      }),
    ),
  ];

  entries.sort((a, b) => b.createdAt - a.createdAt);
  return entries;
}

/**
 * Computes each participant's cents share for the chosen split method
 * (SPL-05, SPL-12–14). Returns an expected-failure message for anything a
 * typo could plausibly cause (amounts/percentages that don't sum right,
 * non-positive shares) — never throws for those.
 */
function computeShareAmounts(
  splitMethod: SplitMethod,
  amountCents: number,
  participants: ExpenseParticipantInput[],
): { ok: true; shares: number[] } | { ok: false; error: string } {
  switch (splitMethod) {
    case 'equal':
      return { ok: true, shares: splitEvenly(amountCents, participants.length) };

    case 'amount': {
      const raw = participants.map((p) => p.amountCents);
      if (!raw.every((a): a is number => typeof a === 'number' && Number.isInteger(a) && a > 0)) {
        return { ok: false, error: 'Enter a positive amount for every person.' };
      }
      const amounts: number[] = raw;
      const sum = amounts.reduce((total, a) => total + a, 0);
      if (sum !== amountCents) {
        return { ok: false, error: 'The amounts must add up to the expense total.' };
      }
      return { ok: true, shares: amounts };
    }

    case 'percentage': {
      const raw = participants.map((p) => p.percentage);
      if (!raw.every((p): p is number => typeof p === 'number' && p > 0)) {
        return { ok: false, error: 'Enter a positive percentage for every person.' };
      }
      const percentages: number[] = raw;
      const sum = percentages.reduce((total, p) => total + p, 0);
      if (Math.abs(sum - 100) > 0.01) {
        return { ok: false, error: 'The percentages must add up to 100%.' };
      }
      // ×1000 keeps up to 3 decimal places of precision as an integer weight.
      const weights = percentages.map((p) => Math.round(p * 1000));
      return { ok: true, shares: splitByWeights(amountCents, weights) };
    }

    case 'shares': {
      const raw = participants.map((p) => p.shares);
      if (!raw.every((s): s is number => typeof s === 'number' && Number.isInteger(s) && s > 0)) {
        return { ok: false, error: 'Enter a positive number of shares for every person.' };
      }
      const shareCounts: number[] = raw;
      return { ok: true, shares: splitByWeights(amountCents, shareCounts) };
    }
  }
}

/**
 * Field-level validation shared by create (addExpense) and edit
 * (updateExpense) — everything that doesn't need a DB round-trip. Membership
 * of payers/participants in the group is checked separately by each caller,
 * since it needs the group's current member list.
 */
function validateExpenseInput(
  input: AddExpenseInput,
): { ok: true; trimmedDescription: string; shares: number[] } | { ok: false; error: string } {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) return { ok: false, error: 'Description is required.' };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: 'Enter a valid amount.' };
  }
  if (input.participants.length === 0) {
    return { ok: false, error: 'Select at least one person to split with.' };
  }
  if (input.payers.length === 0) {
    return { ok: false, error: 'Choose who paid.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: 'Enter a valid date.' };
  // The category comes from a fixed <Select> — an invalid value here means
  // stale/tampered client state, not a normal user mistake.
  if (!isExpenseCategory(input.category)) throw new Error('Invalid category.');

  const uniquePayerIds = new Set(input.payers.map((p) => p.memberId));
  if (uniquePayerIds.size !== input.payers.length) throw new Error('Duplicate payer.');
  if (!input.payers.every((p) => Number.isInteger(p.amountPaidCents) && p.amountPaidCents > 0)) {
    return { ok: false, error: 'Enter a positive amount for every payer.' };
  }
  const paidSum = input.payers.reduce((total, p) => total + p.amountPaidCents, 0);
  if (paidSum !== input.amountCents) {
    return { ok: false, error: "The payers' amounts must add up to the expense total." };
  }

  const shareResult = computeShareAmounts(input.splitMethod, input.amountCents, input.participants);
  if (!shareResult.ok) return shareResult;

  return { ok: true, trimmedDescription, shares: shareResult.shares };
}

/**
 * Adds an expense with any number of payers, split among the chosen
 * participants by any of the four methods (SPL-05, SPL-12–15).
 */
export async function addExpense(groupId: string, input: AddExpenseInput): Promise<ActionResult> {
  const validated = validateExpenseInput(input);
  if (!validated.ok) return validated;
  const { trimmedDescription, shares } = validated;

  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const memberRows = await db
    .select({ id: tallyGroupMembers.id, userId: tallyGroupMembers.userId })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)));
  const memberIds = new Set(memberRows.map((r) => r.id));
  if (!input.payers.every((p) => memberIds.has(p.memberId))) throw new Error('Invalid payer.');
  const participantIds = input.participants.map((p) => p.memberId);
  if (!participantIds.every((id) => memberIds.has(id))) throw new Error('Invalid participant.');

  const [group] = await db
    .select({ name: tallyGroups.name, currency: tallyGroups.currency })
    .from(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, tenantId), eq(tallyGroups.id, groupId)))
    .limit(1);
  const groupCurrency = group?.currency ?? 'USD';
  const currency = input.currency?.trim().toUpperCase() || groupCurrency;

  let exchangeRateMicros: number | null = null;
  if (currency !== groupCurrency) {
    if (!input.exchangeRateMicros || !Number.isFinite(input.exchangeRateMicros) || input.exchangeRateMicros <= 0) {
      return { ok: false, error: 'Enter a valid exchange rate.' };
    }
    exchangeRateMicros = Math.round(input.exchangeRateMicros);
  }

  const id = randomUUID();
  const ts = now();

  await db.insert(tallyExpenses).values({
    id,
    tenantId,
    groupId,
    description: trimmedDescription,
    amount: input.amountCents,
    currency,
    exchangeRateMicros,
    category: input.category,
    date: input.date,
    notes: null,
    splitMethod: input.splitMethod,
    createdBy: userId,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  });

  await db.insert(tallyExpensePayers).values(
    input.payers.map((p) => ({
      expenseId: id,
      tenantId,
      memberId: p.memberId,
      amountPaid: p.amountPaidCents,
    })),
  );

  await db.insert(tallyExpenseShares).values(
    shares.map((shareAmount, i) => ({
      expenseId: id,
      tenantId,
      // Safe: shares has exactly participantIds.length entries.
      memberId: participantIds[i] as string,
      shareAmount,
    })),
  );

  await recordActivity({
    action: 'tally.expense.added',
    targetType: 'expense',
    targetId: id,
    summary: `Added expense "${trimmedDescription}"`,
    metadata: { groupId, amountCents: input.amountCents, currency },
  });

  if (group) {
    const payerMemberIds = new Set(input.payers.map((p) => p.memberId));
    const recipients = memberRows.filter((m) => m.userId && m.userId !== userId);
    await Promise.all(
      recipients.map((m) => {
        const isPayer = payerMemberIds.has(m.id);
        return notifyUser({
          // Safe: filtered to rows with a non-null userId above.
          recipientUserId: m.userId as string,
          title: isPayer ? `You paid for "${trimmedDescription}"` : `New expense in "${group.name}"`,
          body: isPayer
            ? `You were set as payer for ${currency} ${centsToDollars(input.amountCents)}.`
            : `${trimmedDescription} — ${currency} ${centsToDollars(input.amountCents)}.`,
          url: `/tally/${groupId}`,
        });
      }),
    );
    // Expense notification email (SPL-17) — best-effort, no-ops without SMTP.
    await Promise.all(
      recipients.map((m) =>
        sendUserEmail({
          recipientUserId: m.userId as string,
          templateId: 'tally-expense-added',
          subject: `New expense in "${group.name}"`,
          text: `${trimmedDescription} — ${currency} ${centsToDollars(input.amountCents)}.\n\nOpen the group: /tally/${groupId}`,
          data: { groupId, expenseId: id },
        }),
      ),
    );
  }

  revalidatePath(`/tally/${groupId}`);
  return { ok: true };
}

/** Full detail for a single non-deleted expense, for the edit form (SPL-06). */
export async function getExpense(groupId: string, expenseId: string): Promise<ExpenseDetail | null> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const [row] = await db
    .select()
    .from(tallyExpenses)
    .where(
      and(
        eq(tallyExpenses.tenantId, tenantId),
        eq(tallyExpenses.id, expenseId),
        eq(tallyExpenses.groupId, groupId),
        isNull(tallyExpenses.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const payers = await db
    .select()
    .from(tallyExpensePayers)
    .where(and(eq(tallyExpensePayers.tenantId, tenantId), eq(tallyExpensePayers.expenseId, expenseId)));
  const shares = await db
    .select()
    .from(tallyExpenseShares)
    .where(and(eq(tallyExpenseShares.tenantId, tenantId), eq(tallyExpenseShares.expenseId, expenseId)));

  return {
    id: row.id,
    description: row.description,
    amountCents: row.amount,
    currency: row.currency,
    exchangeRateMicros: row.exchangeRateMicros,
    category: row.category,
    date: row.date,
    splitMethod: row.splitMethod as SplitMethod,
    payers: payers.map((p) => ({ memberId: p.memberId, amountPaidCents: p.amountPaid })),
    shares: shares.map((s) => ({ memberId: s.memberId, shareAmountCents: s.shareAmount })),
  };
}

/**
 * Updates an expense in place — same fields and validation as addExpense
 * (SPL-06). Payer and share rows are replaced wholesale rather than diffed,
 * matching deleteGroup's cascading-delete precedent for "replace everything
 * scoped to this row" operations.
 */
export async function updateExpense(
  groupId: string,
  expenseId: string,
  input: AddExpenseInput,
): Promise<ActionResult> {
  const validated = validateExpenseInput(input);
  if (!validated.ok) return validated;
  const { trimmedDescription, shares } = validated;

  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const [existing] = await db
    .select({ id: tallyExpenses.id })
    .from(tallyExpenses)
    .where(
      and(
        eq(tallyExpenses.tenantId, tenantId),
        eq(tallyExpenses.id, expenseId),
        eq(tallyExpenses.groupId, groupId),
        isNull(tallyExpenses.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw new Error('Expense not found.');

  const memberRows = await db
    .select({ id: tallyGroupMembers.id })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)));
  const memberIds = new Set(memberRows.map((r) => r.id));
  if (!input.payers.every((p) => memberIds.has(p.memberId))) throw new Error('Invalid payer.');
  const participantIds = input.participants.map((p) => p.memberId);
  if (!participantIds.every((id) => memberIds.has(id))) throw new Error('Invalid participant.');

  const [group] = await db
    .select({ currency: tallyGroups.currency })
    .from(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, tenantId), eq(tallyGroups.id, groupId)))
    .limit(1);
  const groupCurrency = group?.currency ?? 'USD';
  const currency = input.currency?.trim().toUpperCase() || groupCurrency;

  let exchangeRateMicros: number | null = null;
  if (currency !== groupCurrency) {
    if (!input.exchangeRateMicros || !Number.isFinite(input.exchangeRateMicros) || input.exchangeRateMicros <= 0) {
      return { ok: false, error: 'Enter a valid exchange rate.' };
    }
    exchangeRateMicros = Math.round(input.exchangeRateMicros);
  }

  await db
    .update(tallyExpenses)
    .set({
      description: trimmedDescription,
      amount: input.amountCents,
      currency,
      exchangeRateMicros,
      category: input.category,
      date: input.date,
      splitMethod: input.splitMethod,
      updatedAt: now(),
    })
    .where(and(eq(tallyExpenses.tenantId, tenantId), eq(tallyExpenses.id, expenseId)));

  await db
    .delete(tallyExpensePayers)
    .where(and(eq(tallyExpensePayers.tenantId, tenantId), eq(tallyExpensePayers.expenseId, expenseId)));
  await db
    .delete(tallyExpenseShares)
    .where(and(eq(tallyExpenseShares.tenantId, tenantId), eq(tallyExpenseShares.expenseId, expenseId)));

  await db.insert(tallyExpensePayers).values(
    input.payers.map((p) => ({
      expenseId,
      tenantId,
      memberId: p.memberId,
      amountPaid: p.amountPaidCents,
    })),
  );

  await db.insert(tallyExpenseShares).values(
    shares.map((shareAmount, i) => ({
      expenseId,
      tenantId,
      // Safe: shares has exactly participantIds.length entries.
      memberId: participantIds[i] as string,
      shareAmount,
    })),
  );

  await recordActivity({
    action: 'tally.expense.updated',
    targetType: 'expense',
    targetId: expenseId,
    summary: `Updated expense "${trimmedDescription}"`,
    metadata: { groupId, amountCents: input.amountCents },
  });

  revalidatePath(`/tally/${groupId}`);
  return { ok: true };
}

/**
 * Soft-deletes an expense — the row stays for the activity feed (SPL-08,
 * roadmap 0.1.15) but drops out of every balance calculation immediately,
 * since computeGroupBalances/getExpenses both filter on deletedAt (SPL-07).
 */
export async function deleteExpense(groupId: string, expenseId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const [deleted] = await db
    .update(tallyExpenses)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(
      and(
        eq(tallyExpenses.tenantId, tenantId),
        eq(tallyExpenses.id, expenseId),
        eq(tallyExpenses.groupId, groupId),
      ),
    )
    .returning({ description: tallyExpenses.description });

  if (deleted) {
    await recordActivity({
      action: 'tally.expense.deleted',
      targetType: 'expense',
      targetId: expenseId,
      summary: `Deleted expense "${deleted.description}"`,
      metadata: { groupId },
    });
  }

  revalidatePath(`/tally/${groupId}`);
}

export interface ExpenseComment {
  id: string;
  authorName: string;
  body: string;
  createdAt: number;
}

/** Comments on an expense, oldest first (SPL-20). */
export async function getExpenseComments(groupId: string, expenseId: string): Promise<ExpenseComment[]> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const rows = await db
    .select()
    .from(tallyExpenseComments)
    .where(
      and(
        eq(tallyExpenseComments.tenantId, tenantId),
        eq(tallyExpenseComments.expenseId, expenseId),
        eq(tallyExpenseComments.groupId, groupId),
      ),
    )
    .orderBy(asc(tallyExpenseComments.createdAt));
  if (rows.length === 0) return [];

  const authorIds = [...new Set(rows.map((r) => r.createdBy))];
  const directoryUsers = await sdk.directory.resolveUsers({ ids: authorIds });
  const nameByUserId = new Map(directoryUsers.map((u) => [u.id, u.name ?? u.email]));

  return rows.map((r) => ({
    id: r.id,
    authorName: nameByUserId.get(r.createdBy) ?? 'Unknown',
    body: r.body,
    createdAt: r.createdAt,
  }));
}

/** Adds a free-text comment to an expense — any group member may comment (SPL-20). */
export async function addExpenseComment(
  groupId: string,
  expenseId: string,
  body: string,
): Promise<ActionResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Comment cannot be empty.' };

  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const [expense] = await db
    .select({ description: tallyExpenses.description })
    .from(tallyExpenses)
    .where(
      and(
        eq(tallyExpenses.tenantId, tenantId),
        eq(tallyExpenses.id, expenseId),
        eq(tallyExpenses.groupId, groupId),
      ),
    )
    .limit(1);
  if (!expense) return { ok: false, error: 'Expense not found.' };

  await db.insert(tallyExpenseComments).values({
    id: randomUUID(),
    tenantId,
    expenseId,
    groupId,
    body: trimmed,
    createdBy: userId,
    createdAt: now(),
  });

  await recordActivity({
    action: 'tally.expense.commented',
    targetType: 'expense',
    targetId: expenseId,
    summary: `Commented on "${expense.description}"`,
    metadata: { groupId },
  });

  revalidatePath(`/tally/${groupId}`);
  return { ok: true };
}

export interface MemberBalance {
  memberId: string;
  displayName: string;
  /** Positive = owed to them, negative = they owe the group (cents). */
  netBalanceCents: number;
}

export interface SettleUpPayment {
  currency: string;
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amountCents: number;
}

export interface CurrencyBalances {
  currency: string;
  /** Every member's net balance in this currency, most-owed first. */
  members: MemberBalance[];
  /** Minimal-transaction settle-up suggestions — populated only when the group's simplify-debts toggle is on (SPL-09). */
  settleUpPayments: SettleUpPayment[];
}

export interface GroupBalances {
  simplifyDebts: boolean;
  /**
   * One entry per currency the group has ever used, group's own currency
   * first — most groups will only ever have one entry (SPL-23).
   */
  byCurrency: CurrencyBalances[];
}

/** Per-group balance view: each member's net balance per currency, plus simplified settle-up suggestions when the toggle is on (SPL-09, SPL-23). */
export async function getGroupBalances(groupId: string): Promise<GroupBalances> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const [group] = await db
    .select({ currency: tallyGroups.currency, simplifyDebts: tallyGroups.simplifyDebts })
    .from(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, tenantId), eq(tallyGroups.id, groupId)))
    .limit(1);
  if (!group) throw new Error('Group not found.');

  const balancesByCurrency = await computeGroupBalancesByCurrency(db, tenantId, groupId);

  const memberRows = await db
    .select({
      id: tallyGroupMembers.id,
      userId: tallyGroupMembers.userId,
      guestName: tallyGroupMembers.guestName,
    })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)));
  const displayNames = await resolveMemberDisplayNames(memberRows);

  // The group's own currency always appears, even with zero expenses in it.
  const currencies = [group.currency, ...[...balancesByCurrency.keys()].filter((c) => c !== group.currency)];

  const byCurrency: CurrencyBalances[] = currencies.map((currency) => {
    const balances = balancesByCurrency.get(currency) ?? new Map<string, number>();

    const members: MemberBalance[] = memberRows
      .map((m) => ({
        memberId: m.id,
        displayName: displayNames.get(m.id) ?? 'Unknown',
        netBalanceCents: balances.get(m.id) ?? 0,
      }))
      .sort((a, b) => b.netBalanceCents - a.netBalanceCents);

    const settleUpPayments: SettleUpPayment[] = group.simplifyDebts
      ? simplifyDebts(balances).map((p) => ({
          currency,
          fromMemberId: p.fromMemberId,
          fromName: displayNames.get(p.fromMemberId) ?? 'Unknown',
          toMemberId: p.toMemberId,
          toName: displayNames.get(p.toMemberId) ?? 'Unknown',
          amountCents: p.amount,
        }))
      : [];

    return { currency, members, settleUpPayments };
  });

  return { simplifyDebts: group.simplifyDebts, byCurrency };
}

/** Builds the settlement-summary email body — current balances plus suggested settle-up payments, per currency (SPL-18). */
function buildSettlementSummaryText(groupName: string, balances: GroupBalances): string {
  const lines: string[] = [`Settlement summary for "${groupName}"`, ''];

  for (const cb of balances.byCurrency) {
    const nonZeroMembers = cb.members.filter((m) => m.netBalanceCents !== 0);
    if (nonZeroMembers.length === 0 && cb.settleUpPayments.length === 0) continue;

    lines.push(`${cb.currency}:`);
    for (const m of nonZeroMembers) {
      const verb = m.netBalanceCents > 0 ? 'owed' : 'owes';
      lines.push(`  ${m.displayName} is ${verb} ${cb.currency} ${centsToDollars(Math.abs(m.netBalanceCents))}`);
    }
    if (cb.settleUpPayments.length > 0) {
      lines.push('  Suggested settle-up:');
      for (const p of cb.settleUpPayments) {
        lines.push(`    ${p.fromName} pays ${p.toName} ${cb.currency} ${centsToDollars(p.amountCents)}`);
      }
    }
    lines.push('');
  }

  if (lines.length === 2) lines.push('Everyone is settled up.');
  return lines.join('\n');
}

/**
 * Emails every instance-user group member the current per-currency balances
 * and suggested settle-up payments (SPL-18) — callable on demand, or
 * fire-and-forget from `recordSettlement` after a settlement is recorded.
 */
export async function sendSettlementSummaryEmail(groupId: string): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const [group] = await db
    .select({ name: tallyGroups.name })
    .from(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, tenantId), eq(tallyGroups.id, groupId)))
    .limit(1);
  if (!group) return { ok: false, error: 'Group not found.' };

  const balances = await getGroupBalances(groupId);
  const text = buildSettlementSummaryText(group.name, balances);

  const memberRows = await db
    .select({ userId: tallyGroupMembers.userId })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)));

  await Promise.all(
    memberRows
      .filter((m): m is { userId: string } => m.userId !== null)
      .map((m) =>
        sendUserEmail({
          recipientUserId: m.userId,
          templateId: 'tally-settlement-summary',
          subject: `Settlement summary for "${group.name}"`,
          text,
          data: { groupId },
        }),
      ),
  );

  return { ok: true };
}

export interface RecordSettlementInput {
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  /** ISO 4217. Omit to use the group's own currency (matches the common single-currency case). */
  currency?: string;
  /** ISO date string 'YYYY-MM-DD'. */
  date?: string;
  notes?: string;
}

/** Records a payment from one member to another within a group (SPL-16). */
export async function recordSettlement(
  groupId: string,
  input: RecordSettlementInput,
): Promise<ActionResult> {
  if (input.fromMemberId === input.toMemberId) {
    return { ok: false, error: 'Choose two different people.' };
  }
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: 'Enter a valid amount.' };
  }

  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const memberRows = await db
    .select({
      id: tallyGroupMembers.id,
      userId: tallyGroupMembers.userId,
      guestName: tallyGroupMembers.guestName,
    })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), eq(tallyGroupMembers.groupId, groupId)));
  const memberById = new Map(memberRows.map((m) => [m.id, m]));
  if (!memberById.has(input.fromMemberId) || !memberById.has(input.toMemberId)) {
    return { ok: false, error: 'Invalid member.' };
  }

  const [group] = await db
    .select({ name: tallyGroups.name, currency: tallyGroups.currency })
    .from(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, tenantId), eq(tallyGroups.id, groupId)))
    .limit(1);
  const currency = input.currency?.trim().toUpperCase() || group?.currency || 'USD';

  const id = randomUUID();
  await db.insert(tallySettlements).values({
    id,
    tenantId,
    groupId,
    fromMemberId: input.fromMemberId,
    toMemberId: input.toMemberId,
    amount: input.amountCents,
    currency,
    date: input.date ?? null,
    notes: input.notes?.trim() || null,
    createdBy: userId,
    createdAt: now(),
  });

  const displayNames = await resolveMemberDisplayNames(memberRows);
  const fromName = displayNames.get(input.fromMemberId) ?? 'Unknown';
  const toName = displayNames.get(input.toMemberId) ?? 'Unknown';

  await recordActivity({
    action: 'tally.settlement.recorded',
    targetType: 'settlement',
    targetId: id,
    summary: `${fromName} paid ${toName}`,
    metadata: { groupId, amountCents: input.amountCents, currency },
  });

  if (group) {
    const recipientUserIds = [memberById.get(input.fromMemberId)?.userId, memberById.get(input.toMemberId)?.userId]
      .filter((id): id is string => id !== null && id !== undefined && id !== userId);
    await Promise.all(
      recipientUserIds.map((recipientUserId) =>
        notifyUser({
          recipientUserId,
          title: `Settlement recorded in "${group.name}"`,
          body: `${fromName} paid ${toName} ${currency} ${centsToDollars(input.amountCents)}.`,
          url: `/tally/${groupId}`,
        }),
      ),
    );
  }

  // Settlement summary email (SPL-18) — best-effort, must never fail the
  // settlement that was already successfully recorded above.
  try {
    await sendSettlementSummaryEmail(groupId);
  } catch {
    // See docblock on sendSettlementSummaryEmail / sendUserEmail.
  }

  revalidatePath(`/tally/${groupId}`);
  return { ok: true };
}

export interface GroupBalanceSummary {
  groupId: string;
  groupName: string;
  currency: string;
  /** This user's net balance in the group — positive = they're owed, negative = they owe (cents). */
  netBalanceCents: number;
}

/**
 * The current user's net balance in every active group they belong to
 * (SPL-10). Scoped to each group's own currency only — a group with mixed
 * currencies also has foreign-currency sub-balances, but those are only
 * ever shown in the per-group balance view (SPL-23), not in this
 * cross-group summary.
 */
export async function getOverallBalance(): Promise<GroupBalanceSummary[]> {
  const { db, userId, tenantId } = await getContext();

  const rows = await db
    .select({ group: tallyGroups, memberId: tallyGroupMembers.id })
    .from(tallyGroups)
    .innerJoin(
      tallyGroupMembers,
      and(eq(tallyGroupMembers.groupId, tallyGroups.id), eq(tallyGroupMembers.userId, userId)),
    )
    .where(and(eq(tallyGroups.tenantId, tenantId), isNull(tallyGroups.archivedAt)))
    .orderBy(asc(tallyGroups.name));

  const summaries: GroupBalanceSummary[] = [];
  for (const row of rows) {
    const byCurrency = await computeGroupBalancesByCurrency(db, tenantId, row.group.id);
    const balances = byCurrency.get(row.group.currency) ?? new Map<string, number>();
    summaries.push({
      groupId: row.group.id,
      groupName: row.group.name,
      currency: row.group.currency,
      netBalanceCents: balances.get(row.memberId) ?? 0,
    });
  }
  return summaries;
}
