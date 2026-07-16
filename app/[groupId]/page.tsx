export default async function TallyGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;

  return <div>Group {groupId}</div>;
}
