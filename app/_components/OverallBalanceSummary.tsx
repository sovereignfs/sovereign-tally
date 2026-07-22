import { BalanceChip } from '@sovereignfs/ui';
import Link from 'next/link';
import { centsToDollars } from '../_lib/money';
import type { GroupBalanceSummary } from '../_lib/actions';
import styles from './OverallBalanceSummary.module.css';

interface Props {
  summaries: GroupBalanceSummary[];
}

/** Cross-group balance summary for the current user (SPL-10) — shown on the Tally landing page. */
export function OverallBalanceSummary({ summaries }: Props) {
  const totalOwed = summaries.reduce((sum, s) => sum + Math.max(s.netBalanceCents, 0), 0);
  const totalOwes = summaries.reduce((sum, s) => sum + Math.max(-s.netBalanceCents, 0), 0);

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Overall balance</h2>
      <p className={styles.hint}>
        Totals across groups aren&apos;t currency-converted — each currency is summed separately if
        your groups use more than one.
      </p>

      <ul className={styles.list}>
        {summaries.map((summary) => (
          <li key={summary.groupId} className={styles.row}>
            <Link href={`/tally/${summary.groupId}`} className={styles.groupName}>
              {summary.groupName}
            </Link>
            <BalanceChip amountCents={summary.netBalanceCents} currency={summary.currency} />
          </li>
        ))}
      </ul>

      {(totalOwed > 0 || totalOwes > 0) && (
        <p className={styles.totals}>
          {totalOwed > 0 && <span className={styles.owed}>You are owed {centsToDollars(totalOwed)}</span>}
          {totalOwed > 0 && totalOwes > 0 && ' · '}
          {totalOwes > 0 && <span className={styles.owes}>You owe {centsToDollars(totalOwes)}</span>}
        </p>
      )}
    </section>
  );
}
