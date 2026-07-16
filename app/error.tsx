'use client';

import { useEffect } from 'react';
import { Button } from '@sovereignfs/ui';
import styles from './error.module.css';

export default function TallyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Tally</p>
        <h1 className={styles.message}>Something went wrong.</h1>
        <p className={styles.detail}>{error.message || 'An unexpected error occurred.'}</p>
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
