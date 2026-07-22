'use client';

import { useState, useTransition } from 'react';
import { Button, Input } from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { addExpenseComment, getExpenseComments, type ExpenseComment } from '../_lib/actions';
import { formatTimestamp } from '../_lib/date';
import styles from './ExpenseComments.module.css';

interface Props {
  groupId: string;
  expenseId: string;
}

/** Per-expense comment thread (SPL-20) — collapsed by default, lazy-loads on first expand. */
export function ExpenseComments({ groupId, expenseId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState<ExpenseComment[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      getExpenseComments(groupId, expenseId)
        .then(setComments)
        .then(() => setLoaded(true));
    }
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addExpenseComment(groupId, expenseId, body);
      if (result.ok) {
        setBody('');
        const fresh = await getExpenseComments(groupId, expenseId);
        setComments(fresh);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.toggle} onClick={toggle}>
        {open ? 'Hide comments' : 'Comments'}
      </button>

      {open && (
        <div className={styles.panel}>
          {comments.length === 0 ? (
            <p className={styles.emptyHint}>No comments yet.</p>
          ) : (
            <ul className={styles.list}>
              {comments.map((comment) => (
                <li key={comment.id} className={styles.comment}>
                  <div className={styles.commentMeta}>
                    <strong>{comment.authorName}</strong>
                    <span>{formatTimestamp(comment.createdAt)}</span>
                  </div>
                  <p className={styles.commentBody}>{comment.body}</p>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.form}>
            <Input
              value={body}
              onChange={(e) => setBody(e.currentTarget.value)}
              placeholder="Add a comment…"
              aria-label="Add a comment"
            />
            <Button type="button" size="sm" onClick={submit} disabled={pending || !body.trim()}>
              {pending ? 'Posting…' : 'Post'}
            </Button>
          </div>
          {error && (
            <p className={styles.feedbackError} role="status" aria-live="polite">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
