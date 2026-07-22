'use client';

import { useState, useTransition } from 'react';
import { sendSettlementSummaryEmail } from '../_lib/actions';
import styles from './BalanceSection.module.css';

interface Props {
  groupId: string;
}

/** On-demand settlement summary email trigger (SPL-18). */
export function EmailSummaryButton({ groupId }: Props) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  function send() {
    setSent(false);
    startTransition(async () => {
      const result = await sendSettlementSummaryEmail(groupId);
      if (result.ok) setSent(true);
    });
  }

  return (
    <button type="button" className={styles.downloadLink} onClick={send} disabled={pending}>
      {pending ? 'Sending…' : sent ? 'Sent!' : 'Email summary'}
    </button>
  );
}
