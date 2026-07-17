'use client';

import { useState } from 'react';
import { Icon } from '@sovereignfs/ui';
import { getExpense, type ExpenseDetail, type MemberOption } from '../_lib/actions';
import { ExpenseFormDialog } from './ExpenseFormDialog';
import styles from './ExpensesSection.module.css';

interface Props {
  groupId: string;
  expenseId: string;
  members: MemberOption[];
}

/** Per-row edit trigger — fetches the expense's full detail on click, then
 *  opens ExpenseFormDialog in edit mode once it arrives. */
export function EditExpenseButton({ groupId, expenseId, members }: Props) {
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  function startEdit() {
    setLoading(true);
    getExpense(groupId, expenseId)
      .then((result) => {
        setDetail(result);
        setOpen(result !== null);
      })
      .finally(() => setLoading(false));
  }

  return (
    <>
      <button
        type="button"
        className={styles.editButton}
        onClick={startEdit}
        disabled={loading}
        aria-label="Edit expense"
      >
        <Icon name="pencil" size="sm" aria-hidden />
      </button>
      {detail && (
        <ExpenseFormDialog
          groupId={groupId}
          members={members}
          initialExpense={detail}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
