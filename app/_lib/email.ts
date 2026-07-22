import { headers } from 'next/headers';
import { sdk } from '@sovereignfs/sdk';
import type { SendToUserEmailInput } from '@sovereignfs/sdk';

/**
 * Sends a Tally email via `sdk.email.sendToUser` (RFC 0062) — resolves the
 * recipient server-side by user ID, so it only needs the `mailer:send`
 * permission already declared for `notifyUser`, unlike the raw
 * `sdk.mailer.send` escape hatch (which additionally needs
 * `mailer:sendExternal` for a caller-supplied address). No-ops when SMTP is
 * unconfigured (returns `status: 'skipped'`) — wrapped in try/catch anyway,
 * matching `notifyUser`/`recordActivity`: a delivery failure must never
 * block the mutation that triggered it (SPL-17).
 */
export async function sendUserEmail(input: SendToUserEmailInput): Promise<void> {
  try {
    await sdk.email.sendToUser(input, await headers());
  } catch {
    // See docblock — never let an email-send failure surface to the user.
  }
}
