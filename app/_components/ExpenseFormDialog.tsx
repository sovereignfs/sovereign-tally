'use client';

import { useState, useTransition } from 'react';
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  FormField,
  Input,
  SegmentedControl,
  Select,
} from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { EXPENSE_CATEGORIES } from '../_lib/categories';
import { fromISODate, toISODate } from '../_lib/date';
import { centsToDollars, centsToShareRatio, dollarsToCents } from '../_lib/money';
import {
  addExpense,
  updateExpense,
  type ExpenseDetail,
  type ExpenseParticipantInput,
  type ExpensePayerInput,
  type MemberOption,
  type SplitMethod,
} from '../_lib/actions';
import styles from './ExpenseFormDialog.module.css';

interface Props {
  groupId: string;
  members: MemberOption[];
  /** When set, the dialog edits this expense instead of creating a new one. */
  initialExpense?: ExpenseDetail;
  /** Controlled — omit to use the default uncontrolled "Add expense" trigger
   *  button (create mode). Edit mode is always externally controlled, since
   *  its trigger lives per-row in the expense list. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const SPLIT_METHOD_OPTIONS: { label: string; value: SplitMethod }[] = [
  { label: 'Equal', value: 'equal' },
  { label: 'Amount', value: 'amount' },
  { label: 'Percentage', value: 'percentage' },
  { label: 'Shares', value: 'shares' },
];

function buildInitialState(members: MemberOption[], expense?: ExpenseDetail) {
  if (!expense) {
    return {
      description: '',
      amount: '',
      date: new Date(),
      category: EXPENSE_CATEGORIES[0].value as string,
      payerId: members[0]?.id ?? '',
      multiplePayers: false,
      payerIds: new Set<string>(),
      payerValues: {} as Record<string, string>,
      splitMethod: 'equal' as SplitMethod,
      participantIds: new Set(members.map((m) => m.id)),
      splitValues: {} as Record<string, string>,
    };
  }

  const payerIds = new Set(expense.payers.map((p) => p.memberId));
  const payerValues: Record<string, string> = {};
  for (const p of expense.payers) payerValues[p.memberId] = centsToDollars(p.amountPaidCents);

  const participantIds = new Set(expense.shares.map((s) => s.memberId));
  const splitValues: Record<string, string> = {};
  if (expense.splitMethod === 'amount') {
    for (const s of expense.shares) splitValues[s.memberId] = centsToDollars(s.shareAmountCents);
  } else if (expense.splitMethod === 'percentage') {
    for (const s of expense.shares) {
      splitValues[s.memberId] = ((s.shareAmountCents / expense.amountCents) * 100).toFixed(2);
    }
  } else if (expense.splitMethod === 'shares') {
    // Best-effort reconstruction — the schema only stores resulting cents,
    // not the original share counts (see centsToShareRatio's doc comment).
    const ratio = centsToShareRatio(expense.shares.map((s) => s.shareAmountCents));
    expense.shares.forEach((s, i) => {
      splitValues[s.memberId] = String(ratio[i] ?? 1);
    });
  }

  return {
    description: expense.description,
    amount: centsToDollars(expense.amountCents),
    date: fromISODate(expense.date),
    category: expense.category,
    payerId: expense.payers[0]?.memberId ?? members[0]?.id ?? '',
    multiplePayers: expense.payers.length > 1,
    payerIds,
    payerValues,
    splitMethod: expense.splitMethod,
    participantIds,
    splitValues,
  };
}

export function ExpenseFormDialog({ groupId, members, initialExpense, open: openProp, onOpenChange }: Props) {
  const router = useRouter();
  const isEdit = initialExpense !== undefined;
  const isControlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = isControlled ? openProp : openState;

  const initial = buildInitialState(members, initialExpense);
  const [description, setDescription] = useState(initial.description);
  const [amount, setAmount] = useState(initial.amount);
  const [date, setDate] = useState<Date>(initial.date);
  const [category, setCategory] = useState<string>(initial.category);
  const [payerId, setPayerId] = useState(initial.payerId);
  const [multiplePayers, setMultiplePayers] = useState(initial.multiplePayers);
  const [payerIds, setPayerIds] = useState<Set<string>>(initial.payerIds);
  // Raw per-payer text input, keyed by member id — only read when multiplePayers is on.
  const [payerValues, setPayerValues] = useState<Record<string, string>>(initial.payerValues);
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(initial.splitMethod);
  const [participantIds, setParticipantIds] = useState<Set<string>>(initial.participantIds);
  // Raw per-participant text input for the amount/percentage/shares methods,
  // keyed by member id — only read for whichever method is currently active.
  const [splitValues, setSplitValues] = useState<Record<string, string>>(initial.splitValues);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setOpen(next: boolean) {
    if (isControlled) onOpenChange?.(next);
    else setOpenState(next);
  }

  function reset() {
    // Members (create mode) or the expense itself (edit mode) can change
    // between opens while this component instance stays mounted across the
    // resulting router.refresh() — re-seed from current props every time,
    // not just once at mount (useState's initial value only applies once).
    const fresh = buildInitialState(members, initialExpense);
    setDescription(fresh.description);
    setAmount(fresh.amount);
    setDate(fresh.date);
    setCategory(fresh.category);
    setPayerId(fresh.payerId);
    setMultiplePayers(fresh.multiplePayers);
    setPayerIds(fresh.payerIds);
    setPayerValues(fresh.payerValues);
    setSplitMethod(fresh.splitMethod);
    setParticipantIds(fresh.participantIds);
    setSplitValues(fresh.splitValues);
    setError(null);
  }

  function togglePayer(memberId: string, checked: boolean) {
    setPayerIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(memberId);
      else next.delete(memberId);
      return next;
    });
  }

  function toggleParticipant(memberId: string, checked: boolean) {
    setParticipantIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(memberId);
      else next.delete(memberId);
      return next;
    });
  }

  const amountCentsPreview = dollarsToCents(amount);
  const participantList = members.filter((m) => participantIds.has(m.id));
  const payerList = members.filter((m) => payerIds.has(m.id));

  let payerHint: string | null = null;
  if (multiplePayers && amountCentsPreview !== null) {
    const enteredCents = payerList.reduce(
      (sum, m) => sum + (dollarsToCents(payerValues[m.id] ?? '') ?? 0),
      0,
    );
    payerHint = `Remaining: ${centsToDollars(amountCentsPreview - enteredCents)}`;
  }

  function buildPayerInputs(amountCents: number): ExpensePayerInput[] | null {
    if (!multiplePayers) {
      return payerId ? [{ memberId: payerId, amountPaidCents: amountCents }] : null;
    }
    if (payerList.length === 0) return null;
    const inputs: ExpensePayerInput[] = [];
    for (const m of payerList) {
      const cents = dollarsToCents(payerValues[m.id] ?? '');
      if (cents === null) return null;
      inputs.push({ memberId: m.id, amountPaidCents: cents });
    }
    return inputs;
  }

  let splitHint: string | null = null;
  if (splitMethod === 'amount' && amountCentsPreview !== null) {
    const enteredCents = participantList.reduce(
      (sum, m) => sum + (dollarsToCents(splitValues[m.id] ?? '') ?? 0),
      0,
    );
    const remaining = amountCentsPreview - enteredCents;
    splitHint = `Remaining: ${centsToDollars(remaining)}`;
  } else if (splitMethod === 'percentage') {
    const entered = participantList.reduce((sum, m) => sum + (Number(splitValues[m.id]) || 0), 0);
    splitHint = `Remaining: ${(100 - entered).toFixed(1)}%`;
  }

  function buildParticipantInputs(): ExpenseParticipantInput[] {
    return participantList.map((m) => {
      const raw = splitValues[m.id] ?? '';
      if (splitMethod === 'amount') return { memberId: m.id, amountCents: dollarsToCents(raw) ?? undefined };
      if (splitMethod === 'percentage') {
        const value = Number(raw);
        return { memberId: m.id, percentage: Number.isFinite(value) ? value : undefined };
      }
      if (splitMethod === 'shares') {
        const value = Number(raw);
        return { memberId: m.id, shares: Number.isFinite(value) ? value : undefined };
      }
      return { memberId: m.id };
    });
  }

  function submit() {
    setError(null);
    const amountCents = dollarsToCents(amount);
    if (amountCents === null) {
      setError('Enter a valid amount.');
      return;
    }
    const payers = buildPayerInputs(amountCents);
    if (!payers || payers.length === 0) {
      setError('Choose who paid.');
      return;
    }
    if (participantIds.size === 0) {
      setError('Select at least one person to split with.');
      return;
    }

    const input = {
      description,
      amountCents,
      date: toISODate(date),
      category,
      payers,
      splitMethod,
      participants: buildParticipantInputs(),
    };

    startTransition(async () => {
      const result = isEdit
        ? await updateExpense(groupId, initialExpense.id, input)
        : await addExpense(groupId, input);
      if (result.ok) {
        if (!isEdit) reset();
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function openDialog() {
    reset();
    setOpen(true);
  }

  return (
    <>
      {!isEdit && !isControlled && (
        <Button type="button" onClick={openDialog}>
          Add expense
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => {
          if (!isEdit) reset();
          setOpen(false);
        }}
        size="sm"
        title={isEdit ? 'Edit expense' : 'Add expense'}
      >
        <div className={styles.form}>
          <FormField label="Description" required>
            {(field) => (
              <Input
                {...field}
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
                placeholder="Groceries"
              />
            )}
          </FormField>
          <div className={styles.grid}>
            <FormField label="Amount" required>
              {(field) => (
                <Input
                  {...field}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.currentTarget.value)}
                  placeholder="0.00"
                />
              )}
            </FormField>
            <FormField label="Date" required>
              {() => <DatePicker value={date} onChange={setDate} aria-label="Expense date" />}
            </FormField>
          </div>
          <FormField label="Category">
            {(field) => (
              <Select {...field} value={category} onChange={(e) => setCategory(e.currentTarget.value)}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {multiplePayers ? (
            <div className={styles.participants}>
              <span className={styles.participantsLabel}>Paid by</span>
              {members.map((m) => {
                const included = payerIds.has(m.id);
                return (
                  <div key={m.id} className={styles.participantRow}>
                    <Checkbox
                      checked={included}
                      onChange={(checked) => togglePayer(m.id, checked)}
                      label={m.displayName}
                    />
                    {included && (
                      <Input
                        className={styles.splitValueInput}
                        inputMode="decimal"
                        value={payerValues[m.id] ?? ''}
                        onChange={(e) => {
                          const value = e.currentTarget.value;
                          setPayerValues((prev) => ({ ...prev, [m.id]: value }));
                        }}
                        placeholder="0.00"
                        aria-label={`${m.displayName}'s payment`}
                      />
                    )}
                  </div>
                );
              })}
              {payerHint && <span className={styles.splitHint}>{payerHint}</span>}
              <button type="button" className={styles.linkButton} onClick={() => setMultiplePayers(false)}>
                Use a single payer
              </button>
            </div>
          ) : (
            <>
              <FormField label="Paid by">
                {(field) => (
                  <Select {...field} value={payerId} onChange={(e) => setPayerId(e.currentTarget.value)}>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <button type="button" className={styles.linkButton} onClick={() => setMultiplePayers(true)}>
                Split payment between multiple people
              </button>
            </>
          )}

          <div className={styles.splitMethod}>
            <span className={styles.participantsLabel}>Split</span>
            <SegmentedControl
              value={splitMethod}
              onChange={setSplitMethod}
              options={SPLIT_METHOD_OPTIONS}
              aria-label="Split method"
              size="sm"
            />
          </div>

          <div className={styles.participants}>
            <span className={styles.participantsLabel}>Split between</span>
            {members.map((m) => {
              const included = participantIds.has(m.id);
              return (
                <div key={m.id} className={styles.participantRow}>
                  <Checkbox
                    checked={included}
                    onChange={(checked) => toggleParticipant(m.id, checked)}
                    label={m.displayName}
                  />
                  {splitMethod !== 'equal' && included && (
                    <Input
                      className={styles.splitValueInput}
                      inputMode={splitMethod === 'amount' ? 'decimal' : 'numeric'}
                      value={splitValues[m.id] ?? ''}
                      onChange={(e) => {
                        // Capture the value now — React 19 Strict Mode
                        // double-invokes state updater functions to check
                        // purity, and by the second call the synthetic
                        // event's currentTarget has already been released.
                        const value = e.currentTarget.value;
                        setSplitValues((prev) => ({ ...prev, [m.id]: value }));
                      }}
                      placeholder={
                        splitMethod === 'amount' ? '0.00' : splitMethod === 'percentage' ? '%' : '#'
                      }
                      aria-label={`${m.displayName}'s ${splitMethod}`}
                    />
                  )}
                </div>
              );
            })}
            {splitHint && <span className={styles.splitHint}>{splitHint}</span>}
          </div>

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
                if (!isEdit) reset();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add expense'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
