'use client';

import { useState, useTransition } from 'react';
import { Button, ConfirmDialog, Tooltip } from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { deleteGroup } from '../_lib/actions';

interface Props {
  groupId: string;
  groupName: string;
  canDelete: boolean;
}

export function DeleteGroupButton({ groupId, groupName, canDelete }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteGroup(groupId);
      if (result.ok) {
        setOpen(false);
        router.push('/tally');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const trigger = (
    <Button type="button" variant="destructive" onClick={() => setOpen(true)} disabled={!canDelete}>
      Delete group
    </Button>
  );

  return (
    <>
      {canDelete ? (
        trigger
      ) : (
        <Tooltip content="Settle all balances before deleting this group.">{trigger}</Tooltip>
      )}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete group"
        message={
          <>
            Delete <strong>{groupName}</strong> permanently? This removes the group and all its
            expenses and settlements. This can&apos;t be undone.
          </>
        }
        confirmLabel={pending ? 'Deleting…' : 'Delete'}
        destructive
        pending={pending}
        error={error}
        onConfirm={handleDelete}
      />
    </>
  );
}
