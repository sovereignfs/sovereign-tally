'use client';

import { useState } from 'react';
import { Button, Checkbox, Dialog, FormField, Input, Select, Textarea } from '@sovereignfs/ui';
import { createGroup } from '../_lib/actions';
import { DEFAULT_GROUP_CURRENCY, GROUP_CURRENCIES } from '../_lib/currencies';
import styles from './CreateGroupDialog.module.css';

interface Props {
  /** Controlled open state — omit to render an uncontrolled "New group"
   *  trigger button (e.g. an EmptyState CTA). Sidebar's header "+" button
   *  controls this externally, same pattern as sovereign-shopper's
   *  CreateListForm. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateGroupDialog({ open: openProp, onOpenChange }: Props = {}) {
  const isControlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = isControlled ? openProp : openState;
  const [simplifyDebts, setSimplifyDebts] = useState(true);

  function setOpen(next: boolean) {
    if (isControlled) onOpenChange?.(next);
    else setOpenState(next);
  }

  return (
    <>
      {!isControlled && (
        <Button type="button" onClick={() => setOpen(true)}>
          New group
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="New group">
        <form action={createGroup} className={styles.form}>
          <FormField label="Group name" required>
            {(field) => <Input {...field} name="name" required placeholder="Cabin trip" />}
          </FormField>
          <FormField label="Description">
            {(field) => <Textarea {...field} name="description" rows={2} placeholder="Optional" />}
          </FormField>
          <FormField label="Default currency">
            {(field) => (
              <Select {...field} name="currency" defaultValue={DEFAULT_GROUP_CURRENCY}>
                {GROUP_CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} — {currency.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <Checkbox
            name="simplifyDebts"
            checked={simplifyDebts}
            onChange={setSimplifyDebts}
            label="Simplify debts automatically"
          />
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create group</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
