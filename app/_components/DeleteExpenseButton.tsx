'use client';

import { useState, useTransition } from 'react';
import { ConfirmDialog, Icon } from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { deleteExpense } from '../_lib/actions';
import styles from './ExpensesSection.module.css';

interface Props {
  groupId: string;
  expenseId: string;
  description: string;
}

export function DeleteExpenseButton({ groupId, expenseId, description }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    startTransition(async () => {
      await deleteExpense(groupId, expenseId);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.editButton}
        onClick={() => setOpen(true)}
        aria-label="Delete expense"
      >
        <Icon name="trash-2" size="sm" aria-hidden />
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete expense"
        message={
          <>
            Delete <strong>{description}</strong>? It disappears from this list, but stays in the
            database for the group's activity history.
          </>
        }
        onConfirm={confirmDelete}
        confirmLabel={pending ? 'Deleting…' : 'Delete'}
        destructive
        pending={pending}
      />
    </>
  );
}
