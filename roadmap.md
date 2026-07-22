# Tally — Roadmap

**Version:** 0.4 · **Last updated:** 2026-07-22

Chronological build index for the Tally plugin, derived from
[`SPEC.md`](SPEC.md). One row per task; each task = one branch = one PR in the
`sovereign-tally` repository. Tasks are sequenced — don't skip ahead unless
marked `[parallel]`.

**Label** distinguishes who owns the work:

- **Plugin** — built in `sovereign-tally`, no platform change needed.
- **Platform** — a gap in `claude-sovereign` (this repo) that blocks a Tally
  task. Tracked here so it's picked up in the right order instead of being
  discovered mid-build; the actual implementation PR lands in this repo's own
  `docs/roadmap.md`, not the Tally repo.

Status: ✅ done · 🚧 in progress · 📋 not started · 🔒 blocked (on a Platform row above it)

---

## v0.1 — Core (SPL-01–15, SPL-24–25)

| #     | Task                                                                 | Status | Requirement(s) | Label    |
| ----- | --------------------------------------------------------------------- | ------ | -------------- | -------- |
| 0.1.1 | `manifest.json` + `icon.svg` + directory scaffold                     | ✅     | —              | Plugin   |
| 0.1.2 | `db/schema.ts` — all `tally_*` tables + migrations                   | ✅     | —              | Plugin   |
| 0.1.3 | Groups: create, rename, archive                                       | ✅     | SPL-01         | Plugin   |
| 0.1.4 | Groups: delete when all balances zero                                 | ✅     | SPL-02         | Plugin   |
| 0.1.5 | Members: add instance users + guest members (name + optional email)   | ✅     | SPL-03         | Plugin   |
| 0.1.6 | Members: remove when balance zero                                     | ✅     | SPL-04         | Plugin   |
| 0.1.7 | `sdk.directory` integration for member search/select UI                | ✅     | (supports SPL-03) | Plugin |
| 0.1.8 | Expense CRUD: create with description, amount, date, category, payer   | ✅     | SPL-05         | Plugin   |
| 0.1.9 | Split methods: equal, exact amount, percentage, shares                 | ✅     | SPL-05, SPL-12, SPL-13, SPL-14 | Plugin |
| 0.1.10 | Multiple payers per expense                                          | ✅     | SPL-15         | Plugin   |
| 0.1.11 | Edit expense                                                          | ✅     | SPL-06         | Plugin   |
| 0.1.12 | Soft-delete expense (preserved in activity feed)                     | ✅     | SPL-07         | Plugin   |
| 0.1.13 | `lib/balance.ts` — balance calculation at query time                 | ✅     | SPL-09, SPL-10 | Plugin   |
| 0.1.14 | `lib/balance.ts` — greedy debt-simplification algorithm              | ✅     | SPL-11         | Plugin   |
| 0.1.15 | Activity feed per group (expenses + settlements, chronological)      | ✅     | SPL-08         | Plugin   |
| 0.1.16 | `sdk.activity` integration — platform-visible expense/settlement events | ✅   | (supports SPL-08) | Plugin |
| 0.1.17 | Balance view per group + overall summary across groups                | ✅     | SPL-09, SPL-10 | Plugin   |
| 0.1.18 | `sdk.notifications` integration — member added / expense added / payer set | ✅ | SPL-24         | Plugin   |
| 0.1.19 | Rely on platform Notification Center for read state, muting, push     | ✅     | SPL-25         | Plugin   |
| 0.1.20 | `@sovereignfs/ui` primitives: split-method selector, member multi-select w/ guest-add, integer currency input, balance chip | ✅ | (UI, see SPEC) | Plugin |

**0.1.7 note:** folded into 0.1.5's implementation rather than done as a
separate pass — you can't add an instance user without `sdk.directory` in the
first place, so `searchUsers` (debounced `SuggestionInput`) and
`resolveUsers` (member-list display names) landed together with the add-member
UI. Nothing left to do here that isn't already covered.

**0.1.8 note:** ships single-payer, equal-split expenses only — participant
selection (who's in on the split) is part of SPL-05 itself, so it's included
here rather than deferred. Exact-amount/percentage/shares split methods
(SPL-12–14) and multiple payers (SPL-15) are still 0.1.9/0.1.10.

**0.1.11 note:** the edit form pre-fills from the expense's stored data.
`tally_expense_shares` only stores the resulting cents, not the original
percentage/share-count inputs, so for those two split methods the form
reconstructs a best-effort equivalent (percentage: `share_amount /
expense_total × 100`; shares: the share amounts reduced to their integer
GCD ratio) — resubmitting unedited always still sums correctly, but the
displayed numbers may not byte-match what was originally typed.

**0.1.13 note:** `computeNetBalances` (pure, per-member net balance from
payer/share/settlement rows) now lives in `lib/balance.ts`; `actions.ts`
fetches the rows and delegates to it. `getOverallBalance` (SPL-10 calc) is
in place — per active group, the current user's net balance. No UI consumes
either yet; the balance/overall-summary *view* and debt simplification
(SPL-11) are 0.1.17/0.1.14.

**0.1.14 note:** `simplifyDebts` (`lib/balance.ts`) takes the net-balance map
from `computeNetBalances` and returns the minimal-transaction payment list via
the standard greedy largest-debtor/largest-creditor match. Pure function only,
covered by `__tests__/balance.test.ts` (zero-balance, two-member, chain, and
mixed-group cases, each asserting the output nets back to the input balances).
Not wired into any UI or server action yet — the group's existing
`simplifyDebts` boolean column only gates the toggle shown in
`CreateGroupDialog`/`[groupId]/page.tsx`; consuming the algorithm in the
balance view is 0.1.17.

**0.1.15 note:** `getActivityFeed` (`actions.ts`) merges every expense row
(including soft-deleted ones, marked `deleted: true` rather than dropped —
that's the entire reason `deleteExpense` preserves the row) and every
settlement row for a group into one list sorted by `createdAt` descending,
rendered by the new `ActivitySection` component. Settlements can't be
created until 0.2.1 ships, so the feed is expense-only in practice today; the
query already joins `tally_settlements` so nothing here needs to change when
that lands.

**0.1.16 note:** `recordActivity` (`_lib/activity.ts`) mirrors
`sovereign-healthlog`'s wrapper exactly — best-effort, swallows failures so
`sdk.activity.log` never blocks the mutation. Wired into `addExpense`,
`updateExpense`, and `deleteExpense` (`tally.expense.added/updated/deleted`,
metadata limited to `groupId`/amount, no participant names). Settlement
events will follow the same pattern once 0.2.1 adds `recordSettlement`.

**0.1.17 note:** per SPEC.md's "Balance calculation" data-model note, the
per-group view (`getGroupBalances`, `BalanceSection`) always lists each
member's net balance; the greedy `simplifyDebts` payment list is computed and
shown as "Suggested settle-up" only when the group's `simplifyDebts` toggle
is on — with it off you see raw per-member balances only, no derived
payments (there's no stored per-expense debtor/creditor edge to show a
non-simplified pairwise ledger from). The overall summary
(`getOverallBalance`, `OverallBalanceSummary`) replaces the old "Select a
group" placeholder on the Tally landing page (`app/page.tsx`) once at least
one group exists; sums per-currency total owed/owed separately rather than
converting, since groups can use different currencies (multi-currency
support itself is v0.3).

**0.1.18 note:** `notifyUser` (`_lib/notify.ts`) mirrors `sovereign-tritext`'s
wrapper exactly — best-effort, `sdk.notifications.send(input, await headers())`.
Wired into `addInstanceMember` (notifies the added instance user; guests have
no `userId` so can't receive one) and `addExpense` (notifies every other
instance-user member: a payer-specific "you paid for X" message, everyone
else a generic "new expense in <group>" message). `updateExpense`/
`deleteExpense` don't notify — SPL-24 only lists member-added/expense-added/
payer-set/settlement-recorded, and settlements aren't buildable until 0.2.1.

**0.1.19 note:** nothing to build — confirmed the plugin has no local
notification/push-subscription tables or read-state logic (SPEC.md's data
model explicitly calls this out: "Plugin-local notification and
push-subscription tables are no longer needed"). `sdk.notifications.send`
(0.1.18) is the only integration point; read/unread, category muting, and Web
Push delivery are entirely the platform Notification Center's and Account
plugin's responsibility.

**0.1.20 note:** four new components landed in `@sovereignfs/ui` (platform repo,
`0.41.0`) per SPEC.md's "drive these into `packages/ui`" instruction, each with
a story file and a `DesignSystemOverview.stories.tsx`/`docs/design-system.md`
entry: `CurrencyInput` (decimal entry that reports integer cents, keeps its
own text buffer so an in-progress trailing decimal point survives re-renders),
`BalanceChip` (green/red/neutral owed-owes-settled indicator, deliberately not
Tally-specific), `SplitMethodSelector` (a `SegmentedControl` preset for the
fixed Equal/Amount/Percentage/Shares options), and `MemberMultiSelect`
(checkbox list over an already-resolved `{id, label}` option set — no
special-casing needed for guest vs. instance-user options, since that
distinction lives entirely in the caller's data). `MembersSection`'s own
directory-search-plus-guest-add flow was deliberately left alone — it's a
different composite (search + add), not a "select from a known set" widget,
so `MemberMultiSelect` doesn't attempt to absorb it. `ExpenseFormDialog`,
`BalanceSection`, and `OverallBalanceSummary` were refactored to consume all
four; verified end-to-end in a real dev-server session (create group → add
guest → add expense with `CurrencyInput` mid-typing a trailing decimal →
balances/settle-up/activity feed/deletion all correct) before landing.

**Done when:** a user can create a group, add expenses with any split method
and multiple payers, view simplified balances, receive an in-app notification
when a group member adds an expense, and rely on platform push preferences for
browser push delivery.

---

## v0.2 — Settlements and power features (SPL-16, SPL-19–20)

| #     | Task                                          | Status | Requirement(s) | Label  |
| ----- | ---------------------------------------------- | ------ | -------------- | ------ |
| 0.2.1 | Record a settlement between two members        | ✅     | SPL-16         | Plugin |
| 0.2.2 | CSV export of group expenses + settlements     | ✅     | SPL-19         | Plugin |
| 0.2.3 | `sdk.portability` export/import/delete hooks for groups, memberships, guests | ✅ | (data sovereignty, see SPEC) | Plugin |
| 0.2.4 | Comments on expenses                           | ✅     | SPL-20         | Plugin |
| 0.2.5 | `sdk.data` read-only contracts: `Tally.groups`, `Tally.balances`, `Tally.expenses`, `Tally.memberships` | ✅ | (approved consumers, see SPEC) | Plugin |

**0.2.1 note:** `recordSettlement` (`actions.ts`) validates the two members
are distinct, belong to the group, and the amount is positive, inserts a
`tally_settlements` row, logs `tally.settlement.recorded` activity, and
notifies both members (excluding the actor) via `notifyUser` — same shape as
the 0.1.16/0.1.18 wiring, just for settlements instead of expenses.
`getGroupBalances`'s `SettleUpPayment` now carries `fromMemberId`/`toMemberId`
alongside the display names so `RecordSettlementButton` can prefill
`SettlementFormDialog` directly from a suggested payment; the group header
also gets a standalone "Record settlement" trigger (shown once a group has
≥2 members) for recording an out-of-band payment not tied to any suggestion.
Verified end-to-end in a dev-server session: recording a settlement with no
prior expense debt correctly inverts the two members' balances and the
debt-simplification engine correctly proposes reversing it — confirming
`computeNetBalances`'s settlement sign convention and `simplifyDebts` compose
correctly together.

**0.2.2 note:** `app/export/[groupId]/route.ts` is a plugin-owned Route
Handler, not a Server Action — same reasoning as `sovereign-tritext`'s DOCX
export precedent: a Server Action can't set `Content-Disposition`, and a
plain `GET` under the plugin's own `routePrefix` is gated by the normal
session middleware exactly like a page. Reuses `getContext`/
`requireMembership`/`resolveMemberDisplayNames` (now exported from
`actions.ts` for this purpose) rather than duplicating the membership check.
One unified CSV (not two separate files) with a `Type` column
(`Expense`/`Settlement`) distinguishing rows — matches the activity feed's
combined-history shape; soft-deleted expenses are included with
`Deleted: yes` rather than dropped, for a genuinely complete audit trail.
CSV escaping (`_lib/csv.ts`, `escapeCsvField`/`buildCsv`) is a small
dependency-free RFC-4180-ish implementation, covered by
`__tests__/csv.test.ts`. Verified end-to-end in a dev-server session: the
"Download CSV" link (`BalanceSection` header) resolves to the correct
per-group URL, and fetching it returns `200`, the right `Content-Type`/
`Content-Disposition`, and a correctly-escaped expense row.

**0.2.4 note:** new `tally_expense_comments` table (migration
`0001_expense_comments` — both SQLite, hand-written per
`docs/plugin-development.md`'s documented layout, and Postgres, generated via
`pnpm db:generate:pg`; no FK-qualification fix needed since this schema never
uses `.references()`). `getExpenseComments`/`addExpenseComment`
(`actions.ts`) resolve the author's display name via `sdk.directory` directly
(a comment's `created_by` is always a platform user id — guests can't log in
to comment) rather than `resolveMemberDisplayNames`, which also handles the
guest-name fallback this call site never needs. UI is
`ExpenseComments` — a collapsed-by-default, lazy-loaded-on-first-expand
thread per expense row in `ExpensesSection`, matching `EditExpenseButton`'s
fetch-then-render precedent. Comments post to the platform activity log
(`tally.expense.commented`) but intentionally don't appear in Tally's own
in-app Activity feed — SPL-08 scopes that feed to expenses and settlements
only. No edit/delete — SPEC.md's SPL-20 doesn't ask for it. Verified
end-to-end in a dev-server session, including confirming the new migration
applies cleanly on server startup with zero errors.

**0.2.5 note:** `_lib/data-contracts.ts` (registered from `app/layout.tsx`,
same best-effort try/catch precedent as `sovereign-plainwrite`'s
`registerDataContracts`) provides the four contracts named in SPEC.md's
"Data contracts" table, declared in `manifest.json`'s new `data.provides`
block (validated against `@sovereignfs/manifest`'s schema). `Tally.groups`
and `Tally.balances` are thin wrappers around the already-exported
`getGroups`/`getOverallBalance` actions rather than new queries.
`Tally.expenses`/`Tally.memberships` are new resolvers scoped to the current
user's active (non-archived) group memberships only —
`resolveMembershipsContract`'s `isOwner` field is the closest analog to
SPEC's "roles" language, since Tally has no admin/member role distinction
beyond implicit group-creator. Verified the plugin's own pages still load
without error across multiple requests (registration re-runs on every Tally
page load per the in-process/reset-on-restart model) — full cross-plugin
query-with-consent verification would need a second consumer plugin, which
doesn't exist in this repo yet.

**Done when:** a settlement reduces balances correctly; CSV export downloads a
complete group history; members can comment on expenses.

---

## v0.3 — Multi-currency (SPL-21–23)

| #     | Task                                                  | Status | Requirement(s) | Label  |
| ----- | ------------------------------------------------------ | ------ | -------------- | ------ |
| 0.3.1 | Record an expense in a non-default currency             | ✅     | SPL-21         | Plugin |
| 0.3.2 | Manual exchange-rate entry on non-default-currency expenses | ✅ | SPL-22       | Plugin |
| 0.3.3 | Per-currency balance display when a group has mixed currencies | ✅ | SPL-23     | Plugin |

**0.3.1–0.3.3 note:** `AddExpenseInput` gained optional `currency`/
`exchangeRateMicros` fields (`ExpenseFormDialog` shows a Currency select next
to Category, and an "Exchange rate" field only when the chosen currency
differs from the group's own — SPL-21/22). `tally_expenses.exchange_rate_micros`
(migration `0002_expense_exchange_rate`, both dialects) stores the rate as an
integer ×1,000,000 (`_lib/money.ts`'s `rateToMicros`/`microsToRate`/
`convertCentsWithRate`, unit-tested), consistent with the "amounts are always
smallest-unit integers, never a float" convention — a rate isn't itself a
monetary amount, but a float would reintroduce the exact precision drift that
convention exists to avoid. The expense list shows a "≈ {group currency}
{converted}" hint next to any foreign-currency expense's own-currency amount.

Balance computation (`computeGroupBalancesByCurrency`, replacing the old
single-currency `computeGroupBalances`) now buckets every payer/share/
settlement row by currency and runs `computeNetBalances`/`simplifyDebts`
independently per bucket (SPL-23) — `getGroupBalances` returns
`{ simplifyDebts, byCurrency: CurrencyBalances[] }`, one entry per currency
the group has ever used, group's own currency first; `BalanceSection` renders
one balance block per entry, with a currency-code subheading only when more
than one is present. The group-delete (SPL-02) and member-remove (SPL-04)
zero-balance guards now require zero across *every* currency bucket, not just
one. `getOverallBalance` (cross-group summary, SPL-10) deliberately stays
scoped to each group's own default-currency bucket only — foreign-currency
sub-balances are visible solely in the per-group view, matching SPL-23's
literal scope. `recordSettlement`/`SettlementFormDialog` gained a `currency`
field (required to settle the correct bucket in a mixed-currency group) with
a Currency select shown only when the group actually has more than one
currency in play — settling a suggested payment always passes its bucket's
currency through automatically via `RecordSettlementButton`.

Verified end-to-end in a dev-server session: created a USD group, added a
guest, then added a EUR expense at a 1.08 rate — the group page correctly
rendered separate "USD" and "EUR" balance blocks, the expense row showed
"EUR 50.00 (≈ USD 54.00)", the debt-simplification engine proposed "Alex
pays Dev Admin EUR 25.00" (correctly scoped to the EUR bucket only, leaving
USD settled), and the CSV export included the EUR row with the right
columns. Zero server errors throughout.

**Done when:** a group with USD and EUR expenses shows separate per-currency
balances; editing the exchange rate on an expense recalculates immediately.

---

## v0.4 — Email notifications (SPL-17–18)

| #     | Task                                                        | Status | Requirement(s) | Label  |
| ----- | -------------------------------------------------------------- | ------ | -------------- | ------ |
| 0.4.1 | `sdk.mailer` integration — new-expense notification email to group | ✅ | SPL-17     | Plugin |
| 0.4.2 | Settlement summary email (balances + suggested payments), on-demand + triggered on settle-up | ✅ | SPL-18 | Plugin |

**0.4.1/0.4.2 note:** uses `sdk.email.sendToUser` (RFC 0062), not the raw
`sdk.mailer.send` escape hatch — `sendToUser` resolves the recipient
server-side by user ID and only needs the `mailer:send` permission already
declared in `manifest.json`, whereas `mailer.send` additionally requires
`mailer:sendExternal` since its recipient is a caller-supplied address.
`_lib/email.ts`'s `sendUserEmail` mirrors `notifyUser`/`recordActivity`:
best-effort, try/catch, never blocks the mutation that triggered it (and
`sendToUser` already no-ops with `status: 'skipped'` when SMTP is
unconfigured, satisfying SPL-17's "no-ops when SMTP unconfigured" on its
own). `addExpense` sends the expense-added email alongside the existing
in-app notification, to the same recipient set (every other instance-user
member). `sendSettlementSummaryEmail` (new, in `actions.ts`) builds a
per-currency text summary — reusing `getGroupBalances`'s already-correct
multi-currency balance/settle-up data (0.3.3) rather than re-querying — and
emails it to every instance-user member; it's both exposed on-demand (new
"Email summary" button in `BalanceSection`'s header, `EmailSummaryButton`)
and fired automatically at the end of `recordSettlement` (wrapped in its own
try/catch so a summary-email failure can never undo an already-recorded
settlement). Verified end-to-end in a dev-server session: the on-demand
button flipped to "Sent!", and recording a settlement triggered the
automatic summary send, both with zero server errors (SMTP unconfigured in
dev, so both silently no-op past `sendToUser`, as designed).

**Done when:** expense notification emails send (or no-op without SMTP);
settlement summary email delivers current balances and suggested payments.

---

## v1.0 — Stable (target milestone name — not yet tagged as such)

Both tasks below are done, but this milestone's *name* is the original
target from the design-phase build plan, not a claim that the plugin is
actually tagged `1.0.0`/production-stable yet — see the 1.0.2 note and
`manifest.json`/`package.json` (currently `0.11.0`). Promote to a real
`1.0.0` after real usage, not automatically once every task box is checked.

| #     | Task                                          | Status | Requirement(s) | Label  |
| ----- | ------------------------------------------------ | ------ | -------------- | ------ |
| 1.0.1 | Plugin developer guide reference write-up          | ✅     | —              | Plugin |
| 1.0.2 | Documentation + polish pass, no scope expansion    | ✅     | —              | Plugin |

**1.0.1 note:** new plugin-root `CLAUDE.md`, modeled on `sovereign-tritext`'s
own (the most complete precedent in this monorepo for a standalone plugin
developer guide) — "What this is" / Working conventions / Architecture
(manifest summary, data model, balance calculation, multi-currency, SDK
integration points, route-handlers-vs-actions) / Software requirements /
Out-of-scope. Deliberately points to `roadmap.md`'s per-task notes for
task-level specifics rather than duplicating them, since those notes are
already the more detailed and more current record of *why* each decision was
made.

**1.0.2 note:** SPEC.md's four design-phase "Open questions" resolved against
what actually shipped (renamed to "Resolved decisions") — most notably,
group deletion **blocks** on unsettled balances rather than the originally-
recommended warn-and-allow, and settlement/expense-notification emails never
reach guest members at all (no `guest_email` send anywhere), both stricter
than the original draft's recommendation. `manifest.json`/`package.json`
bumped to `0.11.0` (minor — every v0.1–v0.4 requirement implemented in one
pass) rather than `1.0.0`: everything here has been self-verified in dev
only, with zero real-world usage, independent review, or server-action test
coverage (only pure helpers like `balance.ts`/`csv.ts`/`money.ts` have unit
tests — `actions.ts` itself doesn't) — a 1.0.0 stable-contract claim would
be premature until this has actually been used. `development: true` stays
set in the manifest for the same reason. No behavior changes beyond the
manifest/doc updates themselves — full
`tsc`/`eslint`/`prettier`/`vitest`/`design:tokens:check` pass confirmed
clean after every edit in this pass.

---

## Post-v1.0 — Assistant integration

| #     | Task                                                                 | Status | Requirement(s) | Label    |
| ----- | ----------------------------------------------------------------------- | ------ | -------------- | -------- |
| 1.1.0 | **`sdk.tools` (RFC 0047) — plugin tool contracts for assistant/automation mutations** | 📋 not started upstream | — | **Platform** |
| 1.1.1 | Expose "record settlement" as a plugin tool once RFC 0047 ships          | 🔒 blocked on 1.1.0 | (open question, see SPEC) | Plugin |

`sdk.tools` is a real gap, not yet in `packages/sdk/src` and still `📋` on the
main platform roadmap (`docs/roadmap.md`, epic
[`plugins-runtime.md`](../../docs/epics/plugins-runtime.md#-318)). Nothing in
v0.1–v1.0 depends on it — it only blocks the future "record settlement via
assistant" flow noted as an open question in `SPEC.md`. No other platform
capability is missing: `sdk.notifications`, `sdk.activity`, `sdk.directory`,
`sdk.data`, and `sdk.portability` are all implemented today (experimental
stability tier) and safe to build against for v0.1–v1.0.

---

## Open questions carried from SPEC.md

Resolve before or during the v0.1 build — see `SPEC.md` § Open questions for
full context:

1. Delete group with unsettled balances — recommend warn + allow.
2. Guest member emails have no join-instance link (flagged for a post-v1.1
   "join instance from Tally invite" flow).
3. Personal IOUs — confirm a two-member group is sufficient before v0.1 ships.
4. Balance computation performance — query-time is fine for v1; revisit with
   pre-aggregated snapshots only if needed.
