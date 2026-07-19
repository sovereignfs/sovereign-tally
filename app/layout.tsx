import type { ReactNode } from 'react';
import { GroupSidebar } from './_components/GroupSidebar';
import { getGroups } from './_lib/actions';
import { registerPortabilityHandlers } from './_lib/portability';
import styles from './layout.module.css';

export default async function TallyLayout({ children }: { children: ReactNode }) {
  // In-process and reset on restart — the platform SDK requires
  // re-registering from a request-scoped plugin route, so this runs on
  // every request. Best-effort: a registration failure must not block the
  // plugin's own UI (matches sovereign-tasks' layout.tsx).
  try {
    await registerPortabilityHandlers();
  } catch {
    // Portability is a best-effort platform integration.
  }

  const groups = await getGroups();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <GroupSidebar groups={groups} />
      </aside>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
