import { BalanceChip } from '@sovereignfs/ui';
import { centsToDollars } from '../_lib/money';
import type { GroupBalances } from '../_lib/actions';
import { EmailSummaryButton } from './EmailSummaryButton';
import { RecordSettlementButton } from './RecordSettlementButton';
import { SettlementFormDialog } from './SettlementFormDialog';
import styles from './BalanceSection.module.css';

interface Props {
  groupId: string;
  balances: GroupBalances;
}

export function BalanceSection({ groupId, balances }: Props) {
  const { simplifyDebts, byCurrency } = balances;
  const members = byCurrency[0]?.members ?? [];
  const availableCurrencies = byCurrency.map((c) => c.currency);
  const showCurrencyHeadings = byCurrency.length > 1;

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Balances</h2>
        <div className={styles.headerActions}>
          <a href={`/tally/export/${groupId}`} className={styles.downloadLink}>
            Download CSV
          </a>
          <EmailSummaryButton groupId={groupId} />
          {members.length >= 2 && (
            <SettlementFormDialog groupId={groupId} members={members} availableCurrencies={availableCurrencies} />
          )}
        </div>
      </div>

      {byCurrency.map(({ currency, members: currencyMembers, settleUpPayments }) => (
        <div key={currency} className={styles.currencyBlock}>
          {showCurrencyHeadings && <h3 className={styles.currencyHeading}>{currency}</h3>}
          <ul className={styles.memberList}>
            {currencyMembers.map((member) => (
              <li key={member.memberId} className={styles.memberRow}>
                <span className={styles.memberName}>{member.displayName}</span>
                <BalanceChip amountCents={member.netBalanceCents} currency={currency} />
              </li>
            ))}
          </ul>

          {simplifyDebts && (
            <div className={styles.settleUp}>
              <h3 className={styles.subheading}>Suggested settle-up</h3>
              {settleUpPayments.length === 0 ? (
                <p className={styles.emptyHint}>Everyone is settled up.</p>
              ) : (
                <ul className={styles.paymentList}>
                  {settleUpPayments.map((payment, i) => (
                    <li key={i} className={styles.paymentRow}>
                      <span>
                        <strong>{payment.fromName}</strong> pays <strong>{payment.toName}</strong>
                      </span>
                      <span className={styles.paymentActions}>
                        <span className={styles.paymentAmount}>
                          {currency} {centsToDollars(payment.amountCents)}
                        </span>
                        <RecordSettlementButton groupId={groupId} members={currencyMembers} payment={payment} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
