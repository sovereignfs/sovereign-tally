import { sdk } from '@sovereignfs/sdk';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { tallyExpenses, tallyGroupMembers, tallyGroups } from '../_db/schema';
import { getContext, getGroups, getOverallBalance, resolveMemberDisplayNames } from './actions';

/**
 * Registers Tally's four read-only data contracts (RFC 0002, SPEC.md "Data
 * contracts"). Must be called from a request-scoped Tally route —
 * registration reads `x-sovereign-plugin-id` internally, so this repo calls
 * it from `app/layout.tsx` on every request to any Tally page.
 * Registrations are in-process and reset on restart.
 */
export function registerDataContracts(): void {
  sdk.data.provide('Tally.groups', resolveGroupsContract);
  sdk.data.provide('Tally.balances', resolveBalancesContract);
  sdk.data.provide('Tally.expenses', resolveExpensesContract);
  sdk.data.provide('Tally.memberships', resolveMembershipsContract);
}

interface GroupsContractRow {
  id: string;
  name: string;
  currency: string;
  simplifyDebts: boolean;
  createdAt: number;
}

/** Groups visible to the current user. */
async function resolveGroupsContract(): Promise<GroupsContractRow[]> {
  const groups = await getGroups();
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    currency: g.currency,
    simplifyDebts: g.simplifyDebts,
    createdAt: g.createdAt,
  }));
}

/** Per-group balances (and settlement suggestions once queried per-group — see getGroupBalances). */
async function resolveBalancesContract() {
  return getOverallBalance();
}

interface ExpensesContractRow {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  currency: string;
  category: string;
  date: string;
  deleted: boolean;
}

/** Expense summaries visible to the current user, across every active group they belong to. */
async function resolveExpensesContract(): Promise<ExpensesContractRow[]> {
  const { db, userId, tenantId } = await getContext();

  const groupRows = await db
    .select({ id: tallyGroups.id })
    .from(tallyGroups)
    .innerJoin(
      tallyGroupMembers,
      and(eq(tallyGroupMembers.groupId, tallyGroups.id), eq(tallyGroupMembers.userId, userId)),
    )
    .where(and(eq(tallyGroups.tenantId, tenantId), isNull(tallyGroups.archivedAt)));
  const groupIds = groupRows.map((g) => g.id);
  if (groupIds.length === 0) return [];

  const expenses = await db
    .select()
    .from(tallyExpenses)
    .where(and(eq(tallyExpenses.tenantId, tenantId), inArray(tallyExpenses.groupId, groupIds)));

  return expenses.map((e) => ({
    id: e.id,
    groupId: e.groupId,
    description: e.description,
    amountCents: e.amount,
    currency: e.currency,
    category: e.category,
    date: e.date,
    deleted: e.deletedAt != null,
  }));
}

interface MembershipsContractRow {
  groupId: string;
  memberId: string;
  displayName: string;
  isGuest: boolean;
  /** True when this member is the group's creator — Tally has no other role concept. */
  isOwner: boolean;
  joinedAt: number;
}

/** Group member display data and roles, across every active group the current user belongs to. */
async function resolveMembershipsContract(): Promise<MembershipsContractRow[]> {
  const { db, userId, tenantId } = await getContext();

  const groupRows = await db
    .select({ id: tallyGroups.id, createdBy: tallyGroups.createdBy })
    .from(tallyGroups)
    .innerJoin(
      tallyGroupMembers,
      and(eq(tallyGroupMembers.groupId, tallyGroups.id), eq(tallyGroupMembers.userId, userId)),
    )
    .where(and(eq(tallyGroups.tenantId, tenantId), isNull(tallyGroups.archivedAt)));
  const groupIds = groupRows.map((g) => g.id);
  if (groupIds.length === 0) return [];
  const ownerByGroup = new Map(groupRows.map((g) => [g.id, g.createdBy]));

  const memberRows = await db
    .select({
      id: tallyGroupMembers.id,
      groupId: tallyGroupMembers.groupId,
      userId: tallyGroupMembers.userId,
      guestName: tallyGroupMembers.guestName,
      joinedAt: tallyGroupMembers.joinedAt,
    })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, tenantId), inArray(tallyGroupMembers.groupId, groupIds)));
  const displayNames = await resolveMemberDisplayNames(memberRows);

  return memberRows.map((m) => ({
    groupId: m.groupId,
    memberId: m.id,
    displayName: displayNames.get(m.id) ?? 'Unknown',
    isGuest: m.userId === null,
    isOwner: m.userId !== null && m.userId === ownerByGroup.get(m.groupId),
    joinedAt: m.joinedAt,
  }));
}
