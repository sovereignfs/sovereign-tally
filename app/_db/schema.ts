import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Plugin schema — sovereign-tally.
 *
 * Runtime query schema. This file intentionally lives under app/ because the
 * Sovereign runtime mounts the plugin app tree into Next routes — server
 * components/actions must not import runtime query helpers from outside that
 * mounted tree. `db/schema.ts` re-exports this file for tooling (drizzle-kit).
 *
 * Conventions (match platform schema):
 * - IDs: ULIDs stored as text.
 * - Timestamps: Unix epoch seconds stored as integer.
 * - Booleans: integer 0/1 (mode: 'boolean').
 * - Amounts: integer, smallest currency unit (cents) — never float.
 * - tenant_id on every table.
 * - All tables prefixed tally_.
 *
 * v0.1 ships groups, members (instance users + guests), expenses with all
 * four split methods, multi-payer expenses, and settlements' FK targets
 * (group_members). tally_settlements and tally_expense_comments are v0.2
 * (SPL-16, SPL-20).
 */

export const tallyGroups = sqliteTable('tally_groups', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  createdBy: text('created_by').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  currency: text('currency').notNull(),
  simplifyDebts: integer('simplify_debts', { mode: 'boolean' }).notNull().default(true),
  archivedAt: integer('archived_at'),
  createdAt: integer('created_at').notNull(),
});

/**
 * Exactly one of (userId, guestName) must be non-null — enforced at the app
 * layer (Drizzle/SQLite have no portable CHECK-constraint equivalent here).
 */
export const tallyGroupMembers = sqliteTable(
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
  (t) => [
    // Unique per group for instance-user members. SQLite treats NULL as
    // distinct from every other value, so guest rows (userId null) never
    // collide with this index.
    uniqueIndex('tally_group_members_group_user_idx').on(t.groupId, t.userId),
  ],
);

export const tallyExpenses = sqliteTable('tally_expenses', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  groupId: text('group_id').notNull(),
  description: text('description').notNull(),
  /** Cents. Never store as float. */
  amount: integer('amount').notNull(),
  /** ISO 4217. Defaults to the group's currency; set at creation. */
  currency: text('currency').notNull(),
  /**
   * v0.3 (SPL-22) — manual exchange rate, only set when `currency` differs
   * from the group's own currency: 1 unit of `currency` equals
   * `exchange_rate_micros / 1,000,000` units of the group's currency.
   * Integer (×1,000,000), never a float, matching the "amounts are always
   * smallest-unit integers" convention — a rate isn't a monetary amount, but
   * storing it as a float would reintroduce the exact precision drift that
   * convention exists to avoid. Automatic conversion is explicitly deferred
   * (SPEC.md); this is purely a manually-entered informational figure.
   */
  exchangeRateMicros: integer('exchange_rate_micros'),
  /** 'food_drink' | 'housing' | 'transport' | 'entertainment' | 'health' | 'shopping' | 'travel' | 'other' */
  category: text('category').notNull(),
  /** ISO date string 'YYYY-MM-DD'. */
  date: text('date').notNull(),
  notes: text('notes'),
  /** 'equal' | 'amount' | 'percentage' | 'shares' */
  splitMethod: text('split_method').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  /** Soft delete — row preserved for the activity feed. */
  deletedAt: integer('deleted_at'),
});

/**
 * v0.1: one row per expense (full amount). v0.2 (SPL-15 already in v0.1 scope)
 * allows multiple rows for multi-payer expenses.
 */
export const tallyExpensePayers = sqliteTable(
  'tally_expense_payers',
  {
    expenseId: text('expense_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    memberId: text('member_id').notNull(),
    /** Cents. */
    amountPaid: integer('amount_paid').notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

/**
 * Sum of share_amount across all rows for an expense must equal the
 * expense's amount — enforced at the app layer.
 */
export const tallyExpenseShares = sqliteTable(
  'tally_expense_shares',
  {
    expenseId: text('expense_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    memberId: text('member_id').notNull(),
    /** Cents. */
    shareAmount: integer('share_amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

/** v0.2 (SPL-16) — defined now so tally_group_members' shape is stable. */
export const tallySettlements = sqliteTable('tally_settlements', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  groupId: text('group_id').notNull(),
  fromMemberId: text('from_member_id').notNull(),
  toMemberId: text('to_member_id').notNull(),
  /** Cents. */
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  date: text('date'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** v0.2 (SPL-20) — free-text comments on an expense, by any group member. */
export const tallyExpenseComments = sqliteTable('tally_expense_comments', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  expenseId: text('expense_id').notNull(),
  /** Denormalized from the expense row — lets group-scoped queries/deletes skip a join. */
  groupId: text('group_id').notNull(),
  body: text('body').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
});
