import { EmptyState } from '@sovereignfs/ui';
import { CreateGroupDialog } from './_components/CreateGroupDialog';
import { OverallBalanceSummary } from './_components/OverallBalanceSummary';
import { getGroups, getOverallBalance } from './_lib/actions';

export default async function TallyIndexPage() {
  const groups = await getGroups();

  if (groups.length === 0) {
    return (
      <EmptyState
        heading="No groups yet"
        description="Create a group to start tracking shared expenses."
        action={<CreateGroupDialog />}
      />
    );
  }

  const summaries = await getOverallBalance();
  return <OverallBalanceSummary summaries={summaries} />;
}
