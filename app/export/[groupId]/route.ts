import { and, eq, inArray } from 'drizzle-orm';
import {
  tallyExpensePayers,
  tallyExpenses,
  tallyExpenseShares,
  tallyGroupMembers,
  tallyGroups,
  tallySettlements,
} from '../../_db/schema';
import { getContext, requireMembership, resolveMemberDisplayNames } from '../../_lib/actions';
import { categoryLabel } from '../../_lib/categories';
import { buildCsv } from '../../_lib/csv';
import { centsToDollars } from '../../_lib/money';

type Params = { params: Promise<{ groupId: string }> };

/** ASCII-safe filename fragment — Content-Disposition doesn't need to survive arbitrary Unicode. */
function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return slug || 'group';
}

const HEADER = [
  'Type',
  'Date',
  'Description',
  'Category',
  'Amount',
  'Currency',
  'From / Paid by',
  'To / Split between',
  'Notes',
  'Deleted',
];

/** CSV export of a group's full expense and settlement history (SPL-19). */
export async function GET(_request: Request, { params }: Params) {
  const { groupId } = await params;
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  const [group] = await db
    .select({ name: tallyGroups.name })
    .from(tallyGroups)
    .where(and(eq(tallyGroups.tenantId, tenantId), eq(tallyGroups.id, groupId)))
    .limit(1);
  if (!group) {
    return Response.json({ error: 'Group not found.' }, { status: 404 });
  }

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
  const [payerRows, shareRows] =
    expenseIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(tallyExpensePayers)
            .where(
              and(eq(tallyExpensePayers.tenantId, tenantId), inArray(tallyExpensePayers.expenseId, expenseIds)),
            ),
          db
            .select()
            .from(tallyExpenseShares)
            .where(
              and(eq(tallyExpenseShares.tenantId, tenantId), inArray(tallyExpenseShares.expenseId, expenseIds)),
            ),
        ])
      : [[], []];
  const payersByExpense = new Map<string, string[]>();
  for (const p of payerRows) {
    const list = payersByExpense.get(p.expenseId) ?? [];
    list.push(displayNames.get(p.memberId) ?? 'Unknown');
    payersByExpense.set(p.expenseId, list);
  }
  const participantsByExpense = new Map<string, string[]>();
  for (const s of shareRows) {
    const list = participantsByExpense.get(s.expenseId) ?? [];
    list.push(displayNames.get(s.memberId) ?? 'Unknown');
    participantsByExpense.set(s.expenseId, list);
  }

  type Row = { createdAt: number; fields: string[] };
  const rows: Row[] = [
    ...expenseRows.map((e): Row => ({
      createdAt: e.createdAt,
      fields: [
        'Expense',
        e.date,
        e.description,
        categoryLabel(e.category),
        centsToDollars(e.amount),
        e.currency,
        (payersByExpense.get(e.id) ?? []).join('; '),
        (participantsByExpense.get(e.id) ?? []).join('; '),
        e.notes ?? '',
        e.deletedAt != null ? 'yes' : 'no',
      ],
    })),
    ...settlementRows.map((s): Row => ({
      createdAt: s.createdAt,
      fields: [
        'Settlement',
        s.date ?? '',
        '',
        '',
        centsToDollars(s.amount),
        s.currency,
        displayNames.get(s.fromMemberId) ?? 'Unknown',
        displayNames.get(s.toMemberId) ?? 'Unknown',
        s.notes ?? '',
        'no',
      ],
    })),
  ];
  rows.sort((a, b) => a.createdAt - b.createdAt);

  const csv = buildCsv([HEADER, ...rows.map((r) => r.fields)]);
  const filename = `${slugify(group.name)}-tally-export.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
