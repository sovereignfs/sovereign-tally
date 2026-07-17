import { Badge } from '@sovereignfs/ui';
import { categoryLabel } from '../_lib/categories';
import { centsToDollars } from '../_lib/money';
import type { ExpenseRow, MemberOption } from '../_lib/actions';
import { DeleteExpenseButton } from './DeleteExpenseButton';
import { EditExpenseButton } from './EditExpenseButton';
import { ExpenseFormDialog } from './ExpenseFormDialog';
import styles from './ExpensesSection.module.css';

interface Props {
  groupId: string;
  currency: string;
  expenses: ExpenseRow[];
  members: MemberOption[];
}

export function ExpensesSection({ groupId, currency, expenses, members }: Props) {
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Expenses</h2>
        <ExpenseFormDialog groupId={groupId} members={members} />
      </div>

      {expenses.length === 0 ? (
        <p className={styles.emptyHint}>No expenses yet.</p>
      ) : (
        <ul className={styles.list}>
          {expenses.map((expense) => (
            <li key={expense.id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.description}>{expense.description}</span>
                <span className={styles.itemActions}>
                  <span className={styles.amount}>
                    {currency} {centsToDollars(expense.amount)}
                  </span>
                  <EditExpenseButton groupId={groupId} expenseId={expense.id} members={members} />
                  <DeleteExpenseButton
                    groupId={groupId}
                    expenseId={expense.id}
                    description={expense.description}
                  />
                </span>
              </div>
              <div className={styles.itemMeta}>
                <Badge variant="mono">{categoryLabel(expense.category)}</Badge>
                <span>{expense.date}</span>
                <span>Paid by {expense.payerName}</span>
                <span>Split between {expense.participantNames.join(', ')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
