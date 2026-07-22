import { Badge } from '@sovereignfs/ui';
import { formatTimestamp } from '../_lib/date';
import { centsToDollars } from '../_lib/money';
import type { ActivityEntry } from '../_lib/actions';
import styles from './ActivitySection.module.css';

interface Props {
  entries: ActivityEntry[];
}

export function ActivitySection({ entries }: Props) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Activity</h2>

      {entries.length === 0 ? (
        <p className={styles.emptyHint}>No activity yet.</p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={`${entry.type}-${entry.id}`} className={styles.item}>
              {entry.type === 'expense' ? (
                <div className={styles.itemMain}>
                  <span className={styles.text}>
                    <strong>{entry.payerName || 'Someone'}</strong> added{' '}
                    <strong>{entry.description}</strong>
                    {entry.deleted && (
                      <Badge variant="status" status="neutral">
                        Deleted
                      </Badge>
                    )}
                  </span>
                  <span className={styles.amount}>
                    {entry.currency} {centsToDollars(entry.amount)}
                  </span>
                </div>
              ) : (
                <div className={styles.itemMain}>
                  <span className={styles.text}>
                    <strong>{entry.fromName}</strong> paid <strong>{entry.toName}</strong>
                    {entry.notes && <span className={styles.notes}> — {entry.notes}</span>}
                  </span>
                  <span className={styles.amount}>
                    {entry.currency} {centsToDollars(entry.amount)}
                  </span>
                </div>
              )}
              <span className={styles.timestamp}>{formatTimestamp(entry.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
