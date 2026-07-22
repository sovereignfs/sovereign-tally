import { notFound } from 'next/navigation';
import { Badge, PageHeader } from '@sovereignfs/ui';
import { ActivitySection } from '../_components/ActivitySection';
import { BalanceSection } from '../_components/BalanceSection';
import { DeleteGroupButton } from '../_components/DeleteGroupButton';
import { ExpensesSection } from '../_components/ExpensesSection';
import { MembersSection } from '../_components/MembersSection';
import {
  getActivityFeed,
  getExpenses,
  getGroup,
  getGroupBalances,
  getGroupMemberOptions,
  getGroupMembers,
} from '../_lib/actions';
import styles from './page.module.css';

export default async function TallyGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await getGroup(groupId);
  if (!group) notFound();

  const [members, memberOptions, expenses, activity, balances] = await Promise.all([
    getGroupMembers(groupId),
    getGroupMemberOptions(groupId),
    getExpenses(groupId),
    getActivityFeed(groupId),
    getGroupBalances(groupId),
  ]);

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
      <BalanceSection groupId={group.id} balances={balances} />
      <ExpensesSection
        groupId={group.id}
        currency={group.currency}
        expenses={expenses}
        members={memberOptions}
      />
      <MembersSection groupId={group.id} members={members} />
      <ActivitySection entries={activity} />
      <div className={styles.dangerZone}>
        <DeleteGroupButton groupId={group.id} groupName={group.name} canDelete={group.canDelete} />
      </div>
    </div>
  );
}
