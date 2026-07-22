'use client';

import { useState } from 'react';
import type { MemberBalance, SettleUpPayment } from '../_lib/actions';
import { SettlementFormDialog } from './SettlementFormDialog';
import styles from './BalanceSection.module.css';

interface Props {
  groupId: string;
  members: MemberBalance[];
  payment: SettleUpPayment;
}

/** Per-suggestion "Record" trigger — opens SettlementFormDialog prefilled from the suggested payment. */
export function RecordSettlementButton({ groupId, members, payment }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={styles.recordLink} onClick={() => setOpen(true)}>
        Record
      </button>
      <SettlementFormDialog
        groupId={groupId}
        members={members}
        availableCurrencies={[payment.currency]}
        initial={{
          fromMemberId: payment.fromMemberId,
          toMemberId: payment.toMemberId,
          amountCents: payment.amountCents,
          currency: payment.currency,
        }}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
