import type { ReactNode } from 'react';
import { GroupSidebar } from './_components/GroupSidebar';
import { getGroups } from './_lib/actions';
import styles from './layout.module.css';

export default async function TallyLayout({ children }: { children: ReactNode }) {
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
