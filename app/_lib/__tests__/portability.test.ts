import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeletionContext,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';

type Row = Record<string, unknown>;
type Condition = { kind: 'eq'; key: string; value: unknown } | { kind: 'and'; conditions: Condition[] };

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value,
    }),
    and: (...conditions: Condition[]): Condition => ({ kind: 'and', conditions }),
    inArray: (column: { name: string }, values: unknown[]): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value: values,
    }),
  };
});

function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.kind === 'eq') {
    if (Array.isArray(condition.value)) return condition.value.includes(row[condition.key]);
    return row[condition.key] === condition.value;
  }
  return condition.conditions.every((c) => matches(row, c));
}

const capturedExporter = { fn: null as ((ctx: ExportContext) => Promise<PluginExportSection>) | null };
const capturedImporter = {
  fn: null as ((section: PluginExportSection, ctx: ImportContext) => Promise<void>) | null,
};
const capturedDeleter = {
  fn: null as ((ctx: DeletionContext) => Promise<{ deleted: number; errors?: string[] }>) | null,
};

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    db: { getClient: vi.fn(async () => fakeDb) },
    portability: {
      provideExport: vi.fn(async (fn: typeof capturedExporter.fn) => {
        capturedExporter.fn = fn;
      }),
      provideImport: vi.fn(async (fn: typeof capturedImporter.fn) => {
        capturedImporter.fn = fn;
      }),
      provideDelete: vi.fn(async (fn: typeof capturedDeleter.fn) => {
        capturedDeleter.fn = fn;
      }),
    },
  },
}));

interface Store extends Record<string, Row[]> {
  tally_groups: Row[];
  tally_group_members: Row[];
  tally_expenses: Row[];
  tally_expense_payers: Row[];
  tally_expense_shares: Row[];
  tally_settlements: Row[];
}

let store: Store = {
  tally_groups: [],
  tally_group_members: [],
  tally_expenses: [],
  tally_expense_payers: [],
  tally_expense_shares: [],
  tally_settlements: [],
};

function resetStore() {
  store = {
    tally_groups: [],
    tally_group_members: [],
    tally_expenses: [],
    tally_expense_payers: [],
    tally_expense_shares: [],
    tally_settlements: [],
  };
}

const fakeDb = {
  select(columns?: Record<string, unknown>) {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        return {
          where: async (condition?: Condition) => {
            const rows = (store[tableName] ?? []).filter((row) => matches(row, condition));
            if (!columns) return rows;
            return rows.map((row) => {
              const projected: Row = {};
              for (const key of Object.keys(columns)) projected[key] = row[key];
              return projected;
            });
          },
        };
      },
    };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values: async (row: Row) => {
        (store[tableName] ??= []).push(row);
      },
    };
  },
  delete(table: Table) {
    const tableName = getTableName(table);
    return {
      where: async (condition?: Condition) => {
        store[tableName] = (store[tableName] ?? []).filter((row) => !matches(row, condition));
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('portability export', () => {
  it('exports only groups the user created, with their members/expenses/shares', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.tally_groups = [
      { id: 'group-1', tenantId: 't1', createdBy: 'u1', name: 'Trip', description: null, currency: 'USD', simplifyDebts: true, archivedAt: null, createdAt: 1 },
      { id: 'group-2', tenantId: 't1', createdBy: 'other', name: 'Not mine', description: null, currency: 'USD', simplifyDebts: true, archivedAt: null, createdAt: 1 },
    ];
    store.tally_group_members = [
      { id: 'mem-1', tenantId: 't1', groupId: 'group-1', userId: 'u1', guestName: null, guestEmail: null, joinedAt: 1 },
      { id: 'mem-2', tenantId: 't1', groupId: 'group-1', userId: 'other', guestName: null, guestEmail: null, joinedAt: 1 },
    ];
    store.tally_expenses = [
      { id: 'exp-1', tenantId: 't1', groupId: 'group-1', description: 'Dinner', amount: 4000, currency: 'USD', category: 'food_drink', date: '2026-01-01', notes: null, splitMethod: 'equal', createdBy: 'u1', createdAt: 1, updatedAt: 1, deletedAt: null },
    ];
    store.tally_expense_payers = [{ expenseId: 'exp-1', tenantId: 't1', memberId: 'mem-1', amountPaid: 4000 }];
    store.tally_expense_shares = [
      { expenseId: 'exp-1', tenantId: 't1', memberId: 'mem-1', shareAmount: 2000 },
      { expenseId: 'exp-1', tenantId: 't1', memberId: 'mem-2', shareAmount: 2000 },
    ];

    const section = await capturedExporter.fn?.({
      userId: 'u1',
      tenantId: 't1',
      options: { includeFiles: true },
    });
    expect(section).toBeDefined();

    const data = (section as PluginExportSection).data as {
      groups: { id: string }[];
      members: { id: string }[];
      expenses: { id: string }[];
      expenseShares: { memberId: string }[];
    };
    expect(data.groups.map((g) => g.id)).toEqual(['group-1']);
    expect(data.members.map((m) => m.id)).toEqual(['mem-1', 'mem-2']);
    expect(data.expenses.map((e) => e.id)).toEqual(['exp-1']);
    expect(data.expenseShares.map((s) => s.memberId)).toEqual(['mem-1', 'mem-2']);
    expect((section as PluginExportSection).warnings?.length).toBeGreaterThan(0);
  });
});

describe('portability import', () => {
  it("re-creates the group and the importing user's own member row, drops the other real member, and skips the expense that still references it", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.tally',
      schemaVersion: 1,
      data: {
        groups: [{ id: 'src-group-1', name: 'Trip', description: null, currency: 'USD', simplifyDebts: true, archivedAt: null, createdAt: 1 }],
        members: [
          { id: 'src-mem-1', groupId: 'src-group-1', userId: 'src-user', guestName: null, guestEmail: null, joinedAt: 1 },
          { id: 'src-mem-2', groupId: 'src-group-1', userId: 'other-src-user', guestName: null, guestEmail: null, joinedAt: 1 },
          { id: 'src-mem-guest', groupId: 'src-group-1', userId: null, guestName: 'Guest', guestEmail: null, joinedAt: 1 },
        ],
        expenses: [
          { id: 'src-exp-solo', groupId: 'src-group-1', description: 'Coffee', amount: 500, currency: 'USD', category: 'food_drink', date: '2026-01-01', notes: null, splitMethod: 'equal', createdAt: 1, updatedAt: 1, deletedAt: null },
          { id: 'src-exp-shared', groupId: 'src-group-1', description: 'Dinner', amount: 4000, currency: 'USD', category: 'food_drink', date: '2026-01-01', notes: null, splitMethod: 'equal', createdAt: 1, updatedAt: 1, deletedAt: null },
        ],
        expensePayers: [
          { expenseId: 'src-exp-solo', memberId: 'src-mem-1', amountPaid: 500 },
          { expenseId: 'src-exp-shared', memberId: 'src-mem-1', amountPaid: 4000 },
        ],
        expenseShares: [
          { expenseId: 'src-exp-solo', memberId: 'src-mem-1', shareAmount: 500 },
          { expenseId: 'src-exp-shared', memberId: 'src-mem-1', shareAmount: 2000 },
          { expenseId: 'src-exp-shared', memberId: 'src-mem-2', shareAmount: 2000 },
        ],
        settlements: [],
      },
    };

    const remapId = (id: string) => `new-${id}`;
    // The importing user's own account id is 'src-user' on the source bundle.
    await capturedImporter.fn?.(section, { userId: 'src-user', tenantId: 't1', remapId });

    expect(store.tally_groups).toEqual([expect.objectContaining({ id: 'new-src-group-1', createdBy: 'src-user' })]);
    // Own member + guest re-created; the other real account's member is dropped.
    expect(store.tally_group_members.map((m) => m.id).sort()).toEqual(['new-src-mem-1', 'new-src-mem-guest'].sort());
    // Solo expense (only references the importing user) is imported...
    expect(store.tally_expenses.map((e) => e.id)).toEqual(['new-src-exp-solo']);
    // ...the shared one, which still references the dropped member, is skipped.
    expect(store.tally_expense_payers.map((p) => p.expenseId)).toEqual(['new-src-exp-solo']);
  });
});

describe('portability delete', () => {
  it("deletes the user's own groups and all dependent rows, plus their membership in others' groups", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.tally_groups = [
      { id: 'group-1', tenantId: 't1', createdBy: 'u1', name: 'Mine', description: null, currency: 'USD', simplifyDebts: true, archivedAt: null, createdAt: 1 },
      { id: 'group-2', tenantId: 't1', createdBy: 'other', name: 'Not mine', description: null, currency: 'USD', simplifyDebts: true, archivedAt: null, createdAt: 1 },
    ];
    store.tally_group_members = [
      { id: 'mem-1', tenantId: 't1', groupId: 'group-1', userId: 'u1', guestName: null, guestEmail: null, joinedAt: 1 },
      { id: 'mem-2', tenantId: 't1', groupId: 'group-2', userId: 'u1', guestName: null, guestEmail: null, joinedAt: 1 },
    ];
    store.tally_expenses = [
      { id: 'exp-1', tenantId: 't1', groupId: 'group-1', description: 'x', amount: 100, currency: 'USD', category: 'other', date: '2026-01-01', notes: null, splitMethod: 'equal', createdBy: 'u1', createdAt: 1, updatedAt: 1, deletedAt: null },
    ];
    store.tally_expense_payers = [{ expenseId: 'exp-1', tenantId: 't1', memberId: 'mem-1', amountPaid: 100 }];
    store.tally_expense_shares = [{ expenseId: 'exp-1', tenantId: 't1', memberId: 'mem-1', shareAmount: 100 }];

    const result = await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });
    expect(result).toBeDefined();

    expect(store.tally_groups).toEqual([expect.objectContaining({ id: 'group-2' })]);
    expect(store.tally_expenses).toEqual([]);
    expect(store.tally_expense_payers).toEqual([]);
    expect(store.tally_expense_shares).toEqual([]);
    // Own membership on group-2 (owned by someone else) is also removed.
    expect(store.tally_group_members).toEqual([]);
    expect(result?.deleted).toBeGreaterThan(0);
  });
});
