import { headers } from 'next/headers';
import { sdk } from '@sovereignfs/sdk';
import type { SendNotificationInput } from '@sovereignfs/sdk';

/**
 * Sends a Tally notification (SPL-24). Mirrors `sovereign-tritext`'s
 * `notifyUser` — best-effort, never lets a notification failure block the
 * group/expense mutation that triggered it. `sdk.notifications.send` reads
 * the calling plugin's id off the passed Headers object, so it must be
 * forwarded explicitly.
 */
export async function notifyUser(input: SendNotificationInput): Promise<void> {
  try {
    await sdk.notifications.send(input, await headers());
  } catch {
    // See docblock — never let a notification failure surface to the user.
  }
}
