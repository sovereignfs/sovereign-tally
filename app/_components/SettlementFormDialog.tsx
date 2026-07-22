'use client';

import { useState, useTransition } from 'react';
import { Button, CurrencyInput, DatePicker, Dialog, FormField, Input, Select } from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { toISODate } from '../_lib/date';
import { recordSettlement, type MemberBalance } from '../_lib/actions';
import styles from './SettlementFormDialog.module.css';

interface Props {
  groupId: string;
  members: MemberBalance[];
  /** Every currency this group currently has a balance in — group's own currency first. */
  availableCurrencies: string[];
  /** Prefills from/to/amount/currency, e.g. from a suggested settle-up row. */
  initial?: { fromMemberId: string; toMemberId: string; amountCents: number; currency?: string };
  /** Controlled — omit to use the default uncontrolled "Record settlement" trigger button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Records a payment from one group member to another (SPL-16). */
export function SettlementFormDialog({
  groupId,
  members,
  availableCurrencies,
  initial,
  open: openProp,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const isControlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = isControlled ? openProp : openState;

  const [fromMemberId, setFromMemberId] = useState(initial?.fromMemberId ?? members[0]?.memberId ?? '');
  const [toMemberId, setToMemberId] = useState(
    initial?.toMemberId ?? members[1]?.memberId ?? members[0]?.memberId ?? '',
  );
  const [amountCents, setAmountCents] = useState<number | null>(initial?.amountCents ?? null);
  const [currency, setCurrency] = useState(initial?.currency ?? availableCurrencies[0] ?? 'USD');
  const [date, setDate] = useState<Date | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setOpen(next: boolean) {
    if (isControlled) onOpenChange?.(next);
    else setOpenState(next);
  }

  function reset() {
    setFromMemberId(initial?.fromMemberId ?? members[0]?.memberId ?? '');
    setToMemberId(initial?.toMemberId ?? members[1]?.memberId ?? members[0]?.memberId ?? '');
    setAmountCents(initial?.amountCents ?? null);
    setCurrency(initial?.currency ?? availableCurrencies[0] ?? 'USD');
    setDate(null);
    setNotes('');
    setError(null);
  }

  function submit() {
    setError(null);
    if (amountCents === null) {
      setError('Enter a valid amount.');
      return;
    }
    startTransition(async () => {
      const result = await recordSettlement(groupId, {
        fromMemberId,
        toMemberId,
        amountCents,
        currency,
        date: date ? toISODate(date) : undefined,
        notes: notes.trim() || undefined,
      });
      if (result.ok) {
        reset();
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      {!isControlled && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          Record settlement
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => {
          reset();
          setOpen(false);
        }}
        size="sm"
        title="Record settlement"
      >
        <div className={styles.form}>
          <div className={styles.grid}>
            <FormField label="From">
              {(field) => (
                <Select
                  {...field}
                  value={fromMemberId}
                  onChange={(e) => setFromMemberId(e.currentTarget.value)}
                >
                  {members.map((m) => (
                    <option key={m.memberId} value={m.memberId}>
                      {m.displayName}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="To">
              {(field) => (
                <Select {...field} value={toMemberId} onChange={(e) => setToMemberId(e.currentTarget.value)}>
                  {members.map((m) => (
                    <option key={m.memberId} value={m.memberId}>
                      {m.displayName}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <div className={styles.grid}>
            <FormField label="Amount" required>
              {(field) => (
                <CurrencyInput {...field} valueCents={amountCents} onValueChange={setAmountCents} placeholder="0.00" />
              )}
            </FormField>
            <FormField label="Date" hint="Optional">
              {() => <DatePicker value={date} onChange={setDate} aria-label="Settlement date" />}
            </FormField>
          </div>
          {availableCurrencies.length > 1 && (
            <FormField label="Currency">
              {(field) => (
                <Select {...field} value={currency} onChange={(e) => setCurrency(e.currentTarget.value)}>
                  {availableCurrencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          <FormField label="Notes" hint="Optional">
            {(field) => (
              <Input
                {...field}
                value={notes}
                onChange={(e) => setNotes(e.currentTarget.value)}
                placeholder="Optional"
              />
            )}
          </FormField>

          {error && (
            <p className={styles.feedbackError} role="status" aria-live="polite">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? 'Recording…' : 'Record settlement'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
