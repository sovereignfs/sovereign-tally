'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  FormField,
  Icon,
  Input,
  SuggestionInput,
  Tooltip,
} from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import {
  addGuestMember,
  addInstanceMember,
  removeMember,
  searchMembersToAdd,
  type MemberRow,
} from '../_lib/actions';
import styles from './MembersSection.module.css';

interface Props {
  groupId: string;
  members: MemberRow[];
}

const DEBOUNCE_MS = 200;

export function MembersSection({ groupId, members }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; label: string; meta: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingGuest, setAddingGuest] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchMembersToAdd(groupId, trimmed)
        .then((users) => setResults(users.map((u) => ({ id: u.id, label: u.name, meta: u.email }))))
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [groupId, query]);

  function handleAddInstanceMember(userId: string) {
    setQuery('');
    setResults([]);
    startTransition(async () => {
      await addInstanceMember(groupId, userId);
      router.refresh();
    });
  }

  function confirmRemove() {
    const member = removeTarget;
    if (!member) return;
    setRemoveError(null);
    startTransition(async () => {
      const result = await removeMember(groupId, member.id);
      if (result.ok) {
        setRemoveTarget(null);
        router.refresh();
      } else {
        setRemoveError(result.error);
      }
    });
  }

  function submitGuest() {
    const trimmed = guestName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await addGuestMember(groupId, trimmed, guestEmail);
      setGuestName('');
      setGuestEmail('');
      setAddingGuest(false);
      router.refresh();
    });
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Members</h2>

      <ul className={styles.list}>
        {members.map((member) => {
          const removeButton = (
            <button
              type="button"
              className={styles.removeButton}
              onClick={() => setRemoveTarget(member)}
              disabled={!member.canRemove}
              aria-label={`Remove ${member.displayName}`}
            >
              <Icon name="x" size="sm" aria-hidden />
            </button>
          );
          return (
            <li key={member.id} className={styles.item}>
              <Avatar name={member.displayName} size="sm" />
              <span className={styles.name}>{member.displayName}</span>
              {member.userId === null && <Badge variant="mono">Guest</Badge>}
              <span className={styles.spacer} />
              {member.canRemove ? (
                removeButton
              ) : (
                <Tooltip
                  content={
                    members.length <= 1
                      ? 'A group needs at least one member.'
                      : "Settle this member's balance before removing them."
                  }
                >
                  {removeButton}
                </Tooltip>
              )}
            </li>
          );
        })}
      </ul>

      <SuggestionInput
        value={query}
        onChange={setQuery}
        options={results}
        onSelect={(option) => handleAddInstanceMember(option.id)}
        placeholder="Add a member by name or email…"
        aria-label="Search people to add"
        loading={searching}
        disabled={pending}
      />

      {addingGuest ? (
        <div className={styles.guestForm}>
          <FormField label="Guest name" required>
            {(field) => (
              <Input
                {...field}
                value={guestName}
                onChange={(e) => setGuestName(e.currentTarget.value)}
                placeholder="Jamie"
              />
            )}
          </FormField>
          <FormField label="Guest email" hint="Optional">
            {(field) => (
              <Input
                {...field}
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.currentTarget.value)}
                placeholder="Optional"
              />
            )}
          </FormField>
          <div className={styles.guestFormActions}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAddingGuest(false);
                setGuestName('');
                setGuestEmail('');
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submitGuest} disabled={!guestName.trim() || pending}>
              {pending ? 'Adding…' : 'Add guest'}
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.addGuestLink} onClick={() => setAddingGuest(true)}>
          Add a guest instead
        </button>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => {
          setRemoveTarget(null);
          setRemoveError(null);
        }}
        title="Remove member"
        message={
          <>
            Remove <strong>{removeTarget?.displayName}</strong> from this group?
          </>
        }
        onConfirm={confirmRemove}
        confirmLabel={pending ? 'Removing…' : 'Remove'}
        destructive
        pending={pending}
        error={removeError}
      />
    </section>
  );
}
