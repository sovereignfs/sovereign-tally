'use client';

import { useState, useTransition } from 'react';
import {
  Button,
  CurrencyInput,
  DatePicker,
  Dialog,
  FormField,
  Input,
  MemberMultiSelect,
  Select,
  SplitMethodSelector,
} from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { EXPENSE_CATEGORIES } from '../_lib/categories';
import { GROUP_CURRENCIES } from '../_lib/currencies';
import { fromISODate, toISODate } from '../_lib/date';
import { centsToDollars, centsToShareRatio, microsToRate, rateToMicros } from '../_lib/money';
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
  groupCurrency: string;
  members: MemberOption[];
  /** When set, the dialog edits this expense instead of creating a new one. */
  initialExpense?: ExpenseDetail;
  /** Controlled — omit to use the default uncontrolled "Add expense" trigger
   *  button (create mode). Edit mode is always externally controlled, since
   *  its trigger lives per-row in the expense list. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function buildInitialState(groupCurrency: string, members: MemberOption[], expense?: ExpenseDetail) {
  if (!expense) {
    return {
      description: '',
      amountCents: null as number | null,
      date: new Date(),
      category: EXPENSE_CATEGORIES[0].value as string,
      currency: groupCurrency,
      exchangeRateText: '',
      payerId: members[0]?.id ?? '',
      multiplePayers: false,
      payerIds: new Set<string>(),
      payerAmountCents: {} as Record<string, number | null>,
      splitMethod: 'equal' as SplitMethod,
      participantIds: new Set(members.map((m) => m.id)),
      splitAmountCents: {} as Record<string, number | null>,
      splitValues: {} as Record<string, string>,
    };
  }

  const payerIds = new Set(expense.payers.map((p) => p.memberId));
  const payerAmountCents: Record<string, number | null> = {};
  for (const p of expense.payers) payerAmountCents[p.memberId] = p.amountPaidCents;

  const participantIds = new Set(expense.shares.map((s) => s.memberId));
  const splitAmountCents: Record<string, number | null> = {};
  const splitValues: Record<string, string> = {};
  if (expense.splitMethod === 'amount') {
    for (const s of expense.shares) splitAmountCents[s.memberId] = s.shareAmountCents;
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
    amountCents: expense.amountCents as number | null,
    date: fromISODate(expense.date),
    category: expense.category,
    currency: expense.currency,
    exchangeRateText: expense.exchangeRateMicros != null ? microsToRate(expense.exchangeRateMicros) : '',
    payerId: expense.payers[0]?.memberId ?? members[0]?.id ?? '',
    multiplePayers: expense.payers.length > 1,
    payerIds,
    payerAmountCents,
    splitMethod: expense.splitMethod,
    participantIds,
    splitAmountCents,
    splitValues,
  };
}

export function ExpenseFormDialog({
  groupId,
  groupCurrency,
  members,
  initialExpense,
  open: openProp,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const isEdit = initialExpense !== undefined;
  const isControlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = isControlled ? openProp : openState;

  const initial = buildInitialState(groupCurrency, members, initialExpense);
  const [description, setDescription] = useState(initial.description);
  const [amountCents, setAmountCents] = useState<number | null>(initial.amountCents);
  const [date, setDate] = useState<Date>(initial.date);
  const [category, setCategory] = useState<string>(initial.category);
  const [currency, setCurrency] = useState(initial.currency);
  const [exchangeRateText, setExchangeRateText] = useState(initial.exchangeRateText);
  const [payerId, setPayerId] = useState(initial.payerId);
  const [multiplePayers, setMultiplePayers] = useState(initial.multiplePayers);
  const [payerIds, setPayerIds] = useState<Set<string>>(initial.payerIds);
  // Per-payer amount, keyed by member id — only read when multiplePayers is on.
  const [payerAmountCents, setPayerAmountCents] = useState<Record<string, number | null>>(
    initial.payerAmountCents,
  );
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(initial.splitMethod);
  const [participantIds, setParticipantIds] = useState<Set<string>>(initial.participantIds);
  // Per-participant amount, keyed by member id — only read for the 'amount' split method.
  const [splitAmountCents, setSplitAmountCents] = useState<Record<string, number | null>>(
    initial.splitAmountCents,
  );
  // Raw per-participant text input for the percentage/shares methods, keyed by member id.
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
    const fresh = buildInitialState(groupCurrency, members, initialExpense);
    setDescription(fresh.description);
    setAmountCents(fresh.amountCents);
    setDate(fresh.date);
    setCategory(fresh.category);
    setCurrency(fresh.currency);
    setExchangeRateText(fresh.exchangeRateText);
    setPayerId(fresh.payerId);
    setMultiplePayers(fresh.multiplePayers);
    setPayerIds(fresh.payerIds);
    setPayerAmountCents(fresh.payerAmountCents);
    setSplitMethod(fresh.splitMethod);
    setParticipantIds(fresh.participantIds);
    setSplitAmountCents(fresh.splitAmountCents);
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

  const participantList = members.filter((m) => participantIds.has(m.id));
  const payerList = members.filter((m) => payerIds.has(m.id));

  let payerHint: string | null = null;
  if (multiplePayers && amountCents !== null) {
    const enteredCents = payerList.reduce((sum, m) => sum + (payerAmountCents[m.id] ?? 0), 0);
    payerHint = `Remaining: ${centsToDollars(amountCents - enteredCents)}`;
  }

  function buildPayerInputs(totalAmountCents: number): ExpensePayerInput[] | null {
    if (!multiplePayers) {
      return payerId ? [{ memberId: payerId, amountPaidCents: totalAmountCents }] : null;
    }
    if (payerList.length === 0) return null;
    const inputs: ExpensePayerInput[] = [];
    for (const m of payerList) {
      const cents = payerAmountCents[m.id];
      if (cents == null) return null;
      inputs.push({ memberId: m.id, amountPaidCents: cents });
    }
    return inputs;
  }

  let splitHint: string | null = null;
  if (splitMethod === 'amount' && amountCents !== null) {
    const enteredCents = participantList.reduce((sum, m) => sum + (splitAmountCents[m.id] ?? 0), 0);
    splitHint = `Remaining: ${centsToDollars(amountCents - enteredCents)}`;
  } else if (splitMethod === 'percentage') {
    const entered = participantList.reduce((sum, m) => sum + (Number(splitValues[m.id]) || 0), 0);
    splitHint = `Remaining: ${(100 - entered).toFixed(1)}%`;
  }

  function buildParticipantInputs(): ExpenseParticipantInput[] {
    return participantList.map((m) => {
      if (splitMethod === 'amount') {
        return { memberId: m.id, amountCents: splitAmountCents[m.id] ?? undefined };
      }
      if (splitMethod === 'percentage') {
        const value = Number(splitValues[m.id] ?? '');
        return { memberId: m.id, percentage: Number.isFinite(value) ? value : undefined };
      }
      if (splitMethod === 'shares') {
        const value = Number(splitValues[m.id] ?? '');
        return { memberId: m.id, shares: Number.isFinite(value) ? value : undefined };
      }
      return { memberId: m.id };
    });
  }

  function submit() {
    setError(null);
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
    let exchangeRateMicros: number | undefined;
    if (currency !== groupCurrency) {
      const micros = rateToMicros(exchangeRateText);
      if (micros === null) {
        setError('Enter a valid exchange rate.');
        return;
      }
      exchangeRateMicros = micros;
    }

    const input = {
      description,
      amountCents,
      date: toISODate(date),
      category,
      currency,
      exchangeRateMicros,
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
                <CurrencyInput
                  {...field}
                  valueCents={amountCents}
                  onValueChange={setAmountCents}
                  placeholder="0.00"
                />
              )}
            </FormField>
            <FormField label="Date" required>
              {() => <DatePicker value={date} onChange={setDate} aria-label="Expense date" />}
            </FormField>
          </div>
          <div className={styles.grid}>
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
            <FormField label="Currency">
              {(field) => (
                <Select {...field} value={currency} onChange={(e) => setCurrency(e.currentTarget.value)}>
                  {GROUP_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          {currency !== groupCurrency && (
            <FormField
              label={`Exchange rate (1 ${currency} = ? ${groupCurrency})`}
              hint={`How much is 1 ${currency} worth in ${groupCurrency}? Manually entered — not auto-converted.`}
              required
            >
              {(field) => (
                <Input
                  {...field}
                  inputMode="decimal"
                  value={exchangeRateText}
                  onChange={(e) => setExchangeRateText(e.currentTarget.value)}
                  placeholder="1.00"
                />
              )}
            </FormField>
          )}
          {multiplePayers ? (
            <div className={styles.participants}>
              <MemberMultiSelect
                label="Paid by"
                options={members.map((m) => ({ id: m.id, label: m.displayName }))}
                selectedIds={payerIds}
                onToggle={togglePayer}
                hint={payerHint}
                renderTrailing={(id) => (
                  <CurrencyInput
                    valueCents={payerAmountCents[id] ?? null}
                    onValueChange={(cents) =>
                      setPayerAmountCents((prev) => ({ ...prev, [id]: cents }))
                    }
                    placeholder="0.00"
                    aria-label={`${members.find((m) => m.id === id)?.displayName}'s payment`}
                  />
                )}
              />
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
            <SplitMethodSelector value={splitMethod} onChange={setSplitMethod} size="sm" />
          </div>

          <MemberMultiSelect
            label="Split between"
            options={members.map((m) => ({ id: m.id, label: m.displayName }))}
            selectedIds={participantIds}
            onToggle={toggleParticipant}
            hint={splitHint}
            renderTrailing={
              splitMethod === 'equal'
                ? undefined
                : (id) => {
                    const displayName = members.find((m) => m.id === id)?.displayName;
                    if (splitMethod === 'amount') {
                      return (
                        <CurrencyInput
                          valueCents={splitAmountCents[id] ?? null}
                          onValueChange={(cents) =>
                            setSplitAmountCents((prev) => ({ ...prev, [id]: cents }))
                          }
                          placeholder="0.00"
                          aria-label={`${displayName}'s amount`}
                        />
                      );
                    }
                    return (
                      <Input
                        className={styles.splitValueInput}
                        inputMode="numeric"
                        value={splitValues[id] ?? ''}
                        onChange={(e) => {
                          // Capture the value now — React 19 Strict Mode
                          // double-invokes state updater functions to check
                          // purity, and by the second call the synthetic
                          // event's currentTarget has already been released.
                          const value = e.currentTarget.value;
                          setSplitValues((prev) => ({ ...prev, [id]: value }));
                        }}
                        placeholder={splitMethod === 'percentage' ? '%' : '#'}
                        aria-label={`${displayName}'s ${splitMethod}`}
                      />
                    );
                  }
            }
          />

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
