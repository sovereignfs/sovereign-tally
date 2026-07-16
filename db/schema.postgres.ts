import { integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Plugin schema — sovereign-tally (Postgres dialect, migration-generation only).
 *
 * Not imported by application code — `app/_db/schema.ts` (SQLite-core
 * builders) is the single schema application code queries against, regardless of which
 * dialect actually backs `sdk.db.getClient()` in production. Drizzle's runtime
 * query builder is bound to the client instance's own dialect (`node-postgres`
 * vs `better-sqlite3`), not to the table object's origin, so the SQLite-typed
 * table objects work correctly against a Postgres connection as long as the
 * physical columns use types that serialize identically.
 *
 * This file exists solely to drive `pnpm db:generate:pg` for
 * `migrations/postgres/`; keep it a structural mirror of `schema.ts` and NEVER
 * use native Postgres `boolean` or `bigint` types here — that would create
 * physical columns whose types the SQLite-typed query objects don't know how
 * to serialize/deserialize against, breaking writes at runtime.
 */

export const tallyGroups = pgTable('tally_groups', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  createdBy: text('created_by').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  currency: text('currency').notNull(),
  simplifyDebts: integer('simplify_debts').notNull().default(1),
  archivedAt: integer('archived_at'),
  createdAt: integer('created_at').notNull(),
});

export const tallyGroupMembers = pgTable(
  'tally_group_members',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    groupId: text('group_id').notNull(),
    userId: text('user_id'),
    guestName: text('guest_name'),
    guestEmail: text('guest_email'),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [uniqueIndex('tally_group_members_group_user_idx').on(t.groupId, t.userId)],
);

export const tallyExpenses = pgTable('tally_expenses', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  groupId: text('group_id').notNull(),
  description: text('description').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  category: text('category').notNull(),
  date: text('date').notNull(),
  notes: text('notes'),
  splitMethod: text('split_method').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export const tallyExpensePayers = pgTable(
  'tally_expense_payers',
  {
    expenseId: text('expense_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    memberId: text('member_id').notNull(),
    amountPaid: integer('amount_paid').notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

export const tallyExpenseShares = pgTable(
  'tally_expense_shares',
  {
    expenseId: text('expense_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    memberId: text('member_id').notNull(),
    shareAmount: integer('share_amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

export const tallySettlements = pgTable('tally_settlements', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  groupId: text('group_id').notNull(),
  fromMemberId: text('from_member_id').notNull(),
  toMemberId: text('to_member_id').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  date: text('date'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
});
