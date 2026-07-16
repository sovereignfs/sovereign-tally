'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sdk } from '@sovereignfs/sdk';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { tallyGroupMembers, tallyGroups } from '../_db/schema';

// The SDK intentionally returns an opaque dialect-agnostic DB client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  simplifyDebts: boolean;
  archivedAt: number | null;
  createdAt: number;
}

function now() {
  return Math.floor(Date.now() / 1000);
}

async function getContext() {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return { db, userId: session.user.id, tenantId: session.user.tenantId };
}

async function requireMembership(db: Db, tenantId: string, groupId: string, userId: string) {
  const [row] = await db
    .select({ id: tallyGroupMembers.id })
    .from(tallyGroupMembers)
    .where(
      and(
        eq(tallyGroupMembers.tenantId, tenantId),
        eq(tallyGroupMembers.groupId, groupId),
        eq(tallyGroupMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new Error('Group not found.');
}

/** Active (non-archived) groups the current user belongs to, alphabetical. */
export async function getGroups(): Promise<GroupRow[]> {
  const { db, userId, tenantId } = await getContext();

  const rows = await db
    .select({ group: tallyGroups })
    .from(tallyGroups)
    .innerJoin(
      tallyGroupMembers,
      and(eq(tallyGroupMembers.groupId, tallyGroups.id), eq(tallyGroupMembers.userId, userId)),
    )
    .where(and(eq(tallyGroups.tenantId, tenantId), isNull(tallyGroups.archivedAt)))
    .orderBy(asc(tallyGroups.name));

  return rows.map((r) => r.group);
}

/** A single group, or null when it doesn't exist or the user isn't a member. */
export async function getGroup(groupId: string): Promise<GroupRow | null> {
  const { db, userId, tenantId } = await getContext();

  const [membership] = await db
    .select({ id: tallyGroupMembers.id })
    .from(tallyGroupMembers)
    .where(
      and(
        eq(tallyGroupMembers.tenantId, tenantId),
        eq(tallyGroupMembers.groupId, groupId),
        eq(tallyGroupMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!membership) return null;

  const [row] = await db
    .select()
    .from(tallyGroups)
    .where(and(eq(tallyGroups.id, groupId), eq(tallyGroups.tenantId, tenantId)))
    .limit(1);

  return row ?? null;
}

export async function createGroup(formData: FormData) {
  const { db, userId, tenantId } = await getContext();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Group name is required.');

  const description = String(formData.get('description') ?? '').trim();
  const currency = String(formData.get('currency') ?? 'USD').trim().toUpperCase() || 'USD';
  const simplifyDebts = formData.get('simplifyDebts') === 'on';

  const id = randomUUID();
  const ts = now();

  await db.insert(tallyGroups).values({
    id,
    tenantId,
    createdBy: userId,
    name,
    description: description || null,
    currency,
    simplifyDebts,
    archivedAt: null,
    createdAt: ts,
  });

  await db.insert(tallyGroupMembers).values({
    id: randomUUID(),
    tenantId,
    groupId: id,
    userId,
    guestName: null,
    guestEmail: null,
    joinedAt: ts,
  });

  revalidatePath('/tally');
  redirect(`/tally/${id}`);
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Group name is required.');

  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  await db
    .update(tallyGroups)
    .set({ name: trimmed })
    .where(and(eq(tallyGroups.id, groupId), eq(tallyGroups.tenantId, tenantId)));

  revalidatePath('/tally');
}

export async function archiveGroup(groupId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  await requireMembership(db, tenantId, groupId, userId);

  await db
    .update(tallyGroups)
    .set({ archivedAt: now() })
    .where(and(eq(tallyGroups.id, groupId), eq(tallyGroups.tenantId, tenantId)));

  revalidatePath('/tally');
}
