import { notFound } from 'next/navigation';
import { Badge, PageHeader } from '@sovereignfs/ui';
import { DeleteGroupButton } from '../_components/DeleteGroupButton';
import { MembersSection } from '../_components/MembersSection';
import { getGroup, getGroupMembers } from '../_lib/actions';
import styles from './page.module.css';

export default async function TallyGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await getGroup(groupId);
  if (!group) notFound();

  const members = await getGroupMembers(groupId);

  return (
    <div className={styles.page}>
      <PageHeader title={group.name} />
      <div className={styles.badges}>
        <Badge variant="mono">{group.currency}</Badge>
        <Badge variant="status" status={group.simplifyDebts ? 'active' : 'neutral'}>
          {group.simplifyDebts ? 'Simplifying debts' : 'Debt simplification off'}
        </Badge>
      </div>
      {group.description && <p className={styles.description}>{group.description}</p>}
      <p className={styles.comingSoon}>
        Expenses, balances, and activity for this group are coming soon.
      </p>
      <MembersSection groupId={group.id} members={members} />
      <div className={styles.dangerZone}>
        <DeleteGroupButton groupId={group.id} groupName={group.name} canDelete={group.canDelete} />
      </div>
    </div>
  );
}
