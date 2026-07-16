import { EmptyState } from '@sovereignfs/ui';
import { CreateGroupDialog } from './_components/CreateGroupDialog';
import { getGroups } from './_lib/actions';

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

  return (
    <EmptyState heading="Select a group" description="Choose a group from the sidebar to view it." />
  );
}
