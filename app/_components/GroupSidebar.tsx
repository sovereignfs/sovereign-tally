'use client';

import { ConfirmDialog, Icon, useCommitOnEnterOrBlur } from '@sovereignfs/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { archiveGroup, renameGroup, type GroupRow } from '../_lib/actions';
import { CreateGroupDialog } from './CreateGroupDialog';
import styles from './GroupSidebar.module.css';

interface Props {
  groups: GroupRow[];
}

export function GroupSidebar({ groups }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<GroupRow | null>(null);
  const [pending, startTransition] = useTransition();
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) renameInputRef.current?.focus();
  }, [editingId]);

  function startRename(group: GroupRow) {
    setEditingId(group.id);
    setEditName(group.name);
  }

  function commitRename(group: GroupRow) {
    const trimmed = editName.trim();
    setEditingId(null);
    if (trimmed && trimmed !== group.name) {
      startTransition(async () => {
        await renameGroup(group.id, trimmed);
        router.refresh();
      });
    }
  }

  const renameHandlers = useCommitOnEnterOrBlur(() => {
    const group = groups.find((g) => g.id === editingId);
    if (group) commitRename(group);
  });

  function confirmArchive() {
    const group = archiveTarget;
    if (!group) return;
    startTransition(async () => {
      await archiveGroup(group.id);
      setArchiveTarget(null);
      if (pathname === `/tally/${group.id}`) router.push('/tally');
      router.refresh();
    });
  }

  return (
    <nav className={styles.nav} aria-label="Your groups">
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>Groups</span>
        <button
          type="button"
          className={styles.newGroupButton}
          aria-label="New group"
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size="sm" aria-hidden />
        </button>
      </div>

      {groups.length === 0 ? (
        <p className={styles.emptyHint}>No groups yet</p>
      ) : (
        <ul className={styles.list}>
          {groups.map((group) => {
            const href = `/tally/${group.id}`;
            const active = pathname === href;
            return (
              <li key={group.id} className={styles.item}>
                {editingId === group.id ? (
                  <input
                    ref={renameInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={renameHandlers.onBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditingId(null);
                        return;
                      }
                      renameHandlers.onKeyDown(e);
                    }}
                    aria-label={`Rename ${group.name}`}
                    className={styles.renameInput}
                  />
                ) : (
                  <>
                    <Link
                      href={href}
                      className={active ? `${styles.link} ${styles.linkActive}` : styles.link}
                    >
                      {group.name}
                    </Link>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.rowAction}
                        onClick={() => startRename(group)}
                        aria-label={`Rename ${group.name}`}
                        disabled={pending}
                      >
                        <Icon name="pencil" size="sm" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.rowAction}
                        onClick={() => setArchiveTarget(group)}
                        aria-label={`Archive ${group.name}`}
                        disabled={pending}
                      >
                        <Icon name="trash-2" size="sm" aria-hidden />
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CreateGroupDialog open={creating} onOpenChange={setCreating} />

      <ConfirmDialog
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        title="Archive group"
        message={
          <>
            Archive <strong>{archiveTarget?.name}</strong>? The group and its expenses stay in the
            database but disappear from your groups.
          </>
        }
        onConfirm={confirmArchive}
        confirmLabel={pending ? 'Archiving…' : 'Archive'}
        destructive
        pending={pending}
      />
    </nav>
  );
}
