import { sdk } from '@sovereignfs/sdk';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
  tallyExpensePayers,
  tallyExpenseShares,
  tallyExpenses,
  tallyGroupMembers,
  tallyGroups,
  tallySettlements,
} from '../_db/schema';

// The SDK intentionally returns an opaque dialect-agnostic DB client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

const PLUGIN_ID = 'fs.sovereign.tally';
const EXPORT_SCHEMA_VERSION = 1;

/**
 * Registers Tally's export/import/delete participation (RFC 0007 / RFC 0033,
 * RFC 0068). Must be called from a request-scoped Tally route — this repo
 * calls it from `app/layout.tsx`, same as every other request-scoped setup
 * (registrations are in-process and reset on restart).
 *
 * Tally's data is inherently shared (a group's expenses involve every
 * member), unlike a private list or ledger. Scope for export/import is
 * limited to **groups this user created** — a group the user only belongs
 * to (created by someone else) is not this user's own data to export or
 * re-create, the same reasoning Shopper applies to lists shared with the
 * user rather than owned by them.
 */
export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideExport(exportTallyData);
  await sdk.portability.provideImport(importTallyData);
  await sdk.portability.provideDelete(deleteAllTallyData);
}

// ---- Export shape ----

interface ExportGroup {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  simplifyDebts: boolean;
  archivedAt: number | null;
  createdAt: number;
}

interface ExportMember {
  id: string;
  groupId: string;
  /** The instance user id of a real member — carried for reference only, never re-imported as another account's link. */
  userId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  joinedAt: number;
}

interface ExportExpense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  notes: string | null;
  splitMethod: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface ExportExpensePayer {
  expenseId: string;
  memberId: string;
  amountPaid: number;
}

interface ExportExpenseShare {
  expenseId: string;
  memberId: string;
  shareAmount: number;
}

interface ExportSettlement {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  currency: string;
  date: string | null;
  notes: string | null;
  createdAt: number;
}

interface TallyExportData {
  groups: ExportGroup[];
  members: ExportMember[];
  expenses: ExportExpense[];
  expensePayers: ExportExpensePayer[];
  expenseShares: ExportExpenseShare[];
  settlements: ExportSettlement[];
}

async function exportTallyData(ctx: ExportContext): Promise<PluginExportSection> {
  const db = (await sdk.db.getClient()) as Db;
  const { userId, tenantId } = ctx;

  const groupRows = await db
    .select()
    .from(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, tenantId), eq(tallyGroups.createdBy, userId)));
  const groupIds = groupRows.map((g) => g.id);

  const groups: ExportGroup[] = groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    currency: g.currency,
    simplifyDebts: g.simplifyDebts,
    archivedAt: g.archivedAt,
    createdAt: g.createdAt,
  }));

  let members: ExportMember[] = [];
  let expenses: ExportExpense[] = [];
  let expensePayers: ExportExpensePayer[] = [];
  let expenseShares: ExportExpenseShare[] = [];
  let settlements: ExportSettlement[] = [];

  if (groupIds.length > 0) {
    const [memberRows, expenseRows, settlementRows] = await Promise.all([
      db.select().from(tallyGroupMembers).where(and(eq(tallyGroupMembers.tenantId, tenantId), inArray(tallyGroupMembers.groupId, groupIds))),
      db.select().from(tallyExpenses).where(and(eq(tallyExpenses.tenantId, tenantId), inArray(tallyExpenses.groupId, groupIds))),
      db.select().from(tallySettlements).where(and(eq(tallySettlements.tenantId, tenantId), inArray(tallySettlements.groupId, groupIds))),
    ]);
    members = memberRows.map((m) => ({
      id: m.id,
      groupId: m.groupId,
      userId: m.userId,
      guestName: m.guestName,
      guestEmail: m.guestEmail,
      joinedAt: m.joinedAt,
    }));
    expenses = expenseRows.map((e) => ({
      id: e.id,
      groupId: e.groupId,
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      category: e.category,
      date: e.date,
      notes: e.notes,
      splitMethod: e.splitMethod,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      deletedAt: e.deletedAt,
    }));
    settlements = settlementRows.map((s) => ({
      id: s.id,
      groupId: s.groupId,
      fromMemberId: s.fromMemberId,
      toMemberId: s.toMemberId,
      amount: s.amount,
      currency: s.currency,
      date: s.date,
      notes: s.notes,
      createdAt: s.createdAt,
    }));

    const expenseIds = expenses.map((e) => e.id);
    if (expenseIds.length > 0) {
      const [payerRows, shareRows] = await Promise.all([
        db.select().from(tallyExpensePayers).where(and(eq(tallyExpensePayers.tenantId, tenantId), inArray(tallyExpensePayers.expenseId, expenseIds))),
        db.select().from(tallyExpenseShares).where(and(eq(tallyExpenseShares.tenantId, tenantId), inArray(tallyExpenseShares.expenseId, expenseIds))),
      ]);
      expensePayers = payerRows.map((p) => ({ expenseId: p.expenseId, memberId: p.memberId, amountPaid: p.amountPaid }));
      expenseShares = shareRows.map((s) => ({ expenseId: s.expenseId, memberId: s.memberId, shareAmount: s.shareAmount }));
    }
  }

  const data: TallyExportData = { groups, members, expenses, expensePayers, expenseShares, settlements };
  const otherUserMembers = members.filter((m) => m.userId && m.userId !== userId);
  const warnings =
    otherUserMembers.length > 0
      ? [
          `${String(otherUserMembers.length)} member(s) of your groups are other Sovereign accounts — carried as reference only, not re-created on import.`,
        ]
      : undefined;

  return { pluginId: PLUGIN_ID, schemaVersion: EXPORT_SCHEMA_VERSION, data, warnings };
}

// ---- Import ----
// Additive only. Groups the user created are re-created; guest members
// (self-contained data) are re-created; other real accounts' membership is
// dropped (no cross-instance user resolution, same gap Tasks/Shopper accept
// for collaboration). An expense/settlement whose payers/shares still
// reference a dropped member is skipped rather than silently mis-split.

function isTallyExportData(value: unknown): value is TallyExportData {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<TallyExportData>;
  return (
    Array.isArray(c.groups) &&
    Array.isArray(c.members) &&
    Array.isArray(c.expenses) &&
    Array.isArray(c.expensePayers) &&
    Array.isArray(c.expenseShares) &&
    Array.isArray(c.settlements)
  );
}

async function importTallyData(section: PluginExportSection, ctx: ImportContext): Promise<void> {
  if (section.schemaVersion !== EXPORT_SCHEMA_VERSION || !isTallyExportData(section.data)) {
    throw new Error('Tally import section has an unrecognized shape.');
  }
  const data = section.data;
  const db = (await sdk.db.getClient()) as Db;

  const originalGroupIds = new Set(data.groups.map((g) => g.id));
  // Only the importing user's own membership row and guest rows (self-
  // contained data) are re-created — see the handler doc comment above.
  const importableMembers = data.members.filter((m) => !m.userId || m.userId === ctx.userId);
  const importableMemberIds = new Set(importableMembers.map((m) => m.id));

  for (const g of data.groups) {
    await db.insert(tallyGroups).values({
      id: ctx.remapId(g.id),
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      name: g.name,
      description: g.description,
      currency: g.currency,
      simplifyDebts: g.simplifyDebts,
      archivedAt: g.archivedAt,
      createdAt: g.createdAt,
    });
  }

  for (const m of importableMembers) {
    if (!originalGroupIds.has(m.groupId)) continue;
    await db.insert(tallyGroupMembers).values({
      id: ctx.remapId(m.id),
      tenantId: ctx.tenantId,
      groupId: ctx.remapId(m.groupId),
      userId: m.userId === ctx.userId ? ctx.userId : null,
      guestName: m.guestName,
      guestEmail: m.guestEmail,
      joinedAt: m.joinedAt,
    });
  }

  const importableExpenseIds = new Set<string>();
  for (const e of data.expenses) {
    if (!originalGroupIds.has(e.groupId)) continue;
    const payers = data.expensePayers.filter((p) => p.expenseId === e.id);
    const shares = data.expenseShares.filter((s) => s.expenseId === e.id);
    const allMembersResolvable = [...payers.map((p) => p.memberId), ...shares.map((s) => s.memberId)].every(
      (id) => importableMemberIds.has(id),
    );
    if (!allMembersResolvable) continue;

    await db.insert(tallyExpenses).values({
      id: ctx.remapId(e.id),
      tenantId: ctx.tenantId,
      groupId: ctx.remapId(e.groupId),
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      category: e.category,
      date: e.date,
      notes: e.notes,
      splitMethod: e.splitMethod,
      createdBy: ctx.userId,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      deletedAt: e.deletedAt,
    });
    importableExpenseIds.add(e.id);

    for (const p of payers) {
      await db.insert(tallyExpensePayers).values({
        expenseId: ctx.remapId(e.id),
        tenantId: ctx.tenantId,
        memberId: ctx.remapId(p.memberId),
        amountPaid: p.amountPaid,
      });
    }
    for (const s of shares) {
      await db.insert(tallyExpenseShares).values({
        expenseId: ctx.remapId(e.id),
        tenantId: ctx.tenantId,
        memberId: ctx.remapId(s.memberId),
        shareAmount: s.shareAmount,
      });
    }
  }

  for (const s of data.settlements) {
    if (!originalGroupIds.has(s.groupId)) continue;
    if (!importableMemberIds.has(s.fromMemberId) || !importableMemberIds.has(s.toMemberId)) continue;
    await db.insert(tallySettlements).values({
      id: ctx.remapId(s.id),
      tenantId: ctx.tenantId,
      groupId: ctx.remapId(s.groupId),
      fromMemberId: ctx.remapId(s.fromMemberId),
      toMemberId: ctx.remapId(s.toMemberId),
      amount: s.amount,
      currency: s.currency,
      date: s.date,
      notes: s.notes,
      createdBy: ctx.userId,
      createdAt: s.createdAt,
    });
  }
}

// ---- Delete ----

async function deleteAllTallyData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as Db;
  let deleted = 0;

  const groupRows = await db
    .select({ id: tallyGroups.id })
    .from(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, ctx.tenantId), eq(tallyGroups.createdBy, ctx.userId)));
  const groupIds = groupRows.map((g) => g.id);

  if (groupIds.length > 0) {
    const expenseRows = await db
      .select({ id: tallyExpenses.id })
      .from(tallyExpenses)
      .where(and(eq(tallyExpenses.tenantId, ctx.tenantId), inArray(tallyExpenses.groupId, groupIds)));
    const expenseIds = expenseRows.map((e) => e.id);

    if (expenseIds.length > 0) {
      const [payerRows, shareRows] = await Promise.all([
        db
          .select({ expenseId: tallyExpensePayers.expenseId })
          .from(tallyExpensePayers)
          .where(and(eq(tallyExpensePayers.tenantId, ctx.tenantId), inArray(tallyExpensePayers.expenseId, expenseIds))),
        db
          .select({ expenseId: tallyExpenseShares.expenseId })
          .from(tallyExpenseShares)
          .where(and(eq(tallyExpenseShares.tenantId, ctx.tenantId), inArray(tallyExpenseShares.expenseId, expenseIds))),
      ]);
      await db
        .delete(tallyExpensePayers)
        .where(and(eq(tallyExpensePayers.tenantId, ctx.tenantId), inArray(tallyExpensePayers.expenseId, expenseIds)));
      await db
        .delete(tallyExpenseShares)
        .where(and(eq(tallyExpenseShares.tenantId, ctx.tenantId), inArray(tallyExpenseShares.expenseId, expenseIds)));
      deleted += payerRows.length + shareRows.length;
    }

    const [settlementRows, memberRows] = await Promise.all([
      db
        .select({ id: tallySettlements.id })
        .from(tallySettlements)
        .where(and(eq(tallySettlements.tenantId, ctx.tenantId), inArray(tallySettlements.groupId, groupIds))),
      db
        .select({ id: tallyGroupMembers.id })
        .from(tallyGroupMembers)
        .where(and(eq(tallyGroupMembers.tenantId, ctx.tenantId), inArray(tallyGroupMembers.groupId, groupIds))),
    ]);
    await db
      .delete(tallySettlements)
      .where(and(eq(tallySettlements.tenantId, ctx.tenantId), inArray(tallySettlements.groupId, groupIds)));
    await db
      .delete(tallyGroupMembers)
      .where(and(eq(tallyGroupMembers.tenantId, ctx.tenantId), inArray(tallyGroupMembers.groupId, groupIds)));
    deleted += settlementRows.length + memberRows.length;

    await db
      .delete(tallyExpenses)
      .where(and(eq(tallyExpenses.tenantId, ctx.tenantId), inArray(tallyExpenses.groupId, groupIds)));
    deleted += expenseRows.length;
  }

  deleted += groupRows.length;
  await db
    .delete(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, ctx.tenantId), eq(tallyGroups.createdBy, ctx.userId)));

  // The user may also be a (non-owner) member of other people's groups.
  const otherMembershipRows = await db
    .select({ id: tallyGroupMembers.id })
    .from(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, ctx.tenantId), eq(tallyGroupMembers.userId, ctx.userId)));
  await db
    .delete(tallyGroupMembers)
    .where(and(eq(tallyGroupMembers.tenantId, ctx.tenantId), eq(tallyGroupMembers.userId, ctx.userId)));
  deleted += otherMembershipRows.length;

  return { deleted };
}
