import { sdk } from '@sovereignfs/sdk';
import type { ActivityLogEntry } from '@sovereignfs/sdk';

/**
 * Records a Tally activity event (roadmap 0.1.16, supports SPL-08). Mirrors
 * `sovereign-healthlog`'s `recordActivity`: best-effort, never lets a
 * logging failure block the expense/settlement mutation that triggered it.
 */
export async function recordActivity(entry: ActivityLogEntry): Promise<void> {
  try {
    await sdk.activity.log(entry);
  } catch {
    // See docblock — never let an activity-log failure surface to the user.
  }
}
