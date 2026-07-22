# CLAUDE.md

Guidance for Claude Code working in this repository (`sovereign-tally`).

## What this is

Tally — a shared expense tracking and debt settlement app (Splitwise-style),
built as a [Sovereign](https://github.com/sovereignfs/sovereign) plugin. For
the product concept, problem statement, and requirement IDs (`SPL-*`), see
[SPEC.md](SPEC.md). For the phase-by-phase task index, see
[roadmap.md](roadmap.md) — read it before making any implementation choice
that isn't already spelled out in the code; each roadmap entry's "note"
records the concrete decisions and file-level detail behind that task.

## Working conventions

- Developed in-tree against a local Sovereign platform checkout via the
  documented `.local` convention: cloned at `plugins/sovereign-tally.local/`
  in the platform repo, gitignored there, a full pnpm workspace member (see
  the platform repo's `docs/plugin-development.md` → "Developing a sovereign
  plugin inside the platform monorepo"). This repository is the single
  source of truth for the plugin's own source and history — the platform
  repo never tracks it.
- One roadmap task = one branch = one PR, same discipline as the platform
  repo. Tasks are sequenced in [roadmap.md](roadmap.md) — don't skip ahead.
- Schema lives at `app/_db/schema.ts` (SQLite-typed, application-facing —
  imported by all server actions and route handlers) and
  `db/schema.postgres.ts` (structural mirror, migration-generation only via
  `pnpm db:generate:pg`). `db/schema.ts` just re-exports `app/_db/schema.ts`
  for drizzle-kit tooling. Never add a native Postgres `boolean`/`bigint`
  type to `schema.postgres.ts` — it would create physical columns the
  SQLite-typed query objects can't correctly serialize against.
- **SQLite migrations are hand-written, not generated** — there's no
  `drizzle.config.ts` for the sqlite dialect, only `drizzle.config.pg.ts` for
  Postgres. After changing `app/_db/schema.ts`: hand-write the matching
  `migrations/sqlite/000N_<name>.sql` (idempotent `CREATE TABLE IF NOT
  EXISTS` for new tables; a plain `ALTER TABLE … ADD COLUMN` for new columns
  — drizzle's migrator tracks applied migrations itself, so `IF NOT EXISTS`
  isn't needed there), then add the matching entry to
  `migrations/sqlite/meta/_journal.json`. Separately run
  `pnpm db:generate:pg` for the Postgres side, then rename the
  auto-generated file/journal tag from drizzle-kit's random adjective-noun
  name to the same `000N_<name>` used for SQLite, for readability — the
  auto-generated `meta/000N_snapshot.json` doesn't need renaming (drizzle-kit
  names snapshots by index, not tag).
- Verify before claiming a roadmap task done: `pnpm typecheck` (from the
  platform repo root, or `tsc --noEmit -p plugins/sovereign-tally.local/tsconfig.json`),
  `pnpm eslint`, `pnpm prettier --check`, the relevant Vitest suite
  (`app/_lib/__tests__/`), and a live dev-server pass through the actual
  feature — this plugin has a real DB and real UI, and several bugs during
  this build were only caught by exercising the running app (see roadmap.md
  notes for specifics).
- Package name is `@sovereignfs/sovereign-tally` for in-tree development
  only — not the published package name once distributed standalone.

## Architecture

### Manifest summary

| Field         | Value                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`          | `fs.sovereign.tally`                                                                                     |
| `type`        | `sovereign`                                                                                               |
| `routePrefix` | `/tally`                                                                                                  |
| `shell`       | `default`                                                                                                 |
| `permissions` | `auth:session`, `db:readWrite`, `mailer:send`, `notifications:send`, `activity:write`, `data:provide`, `data:export`, `data:import` |
| `data.provides` | `Tally.groups`, `Tally.balances`, `Tally.expenses`, `Tally.memberships` (all v1, read-only, RFC 0002)   |

Current, authoritative fields live in `manifest.json` — the table above is a
summary. No `database` field is declared, so this is a **shared-database**
plugin (writes into the platform DB with `tally_`-prefixed tables), not
`isolated` — every `tally_*` table carries `tenant_id`.

### Data model

All tables prefixed `tally_`, all IDs ULIDs-as-text, all timestamps Unix
epoch seconds, all booleans integer 0/1, all monetary amounts integer
smallest-unit (cents) — **never a float**, including the one place that
looks like it should be a float: exchange rates (see "Multi-currency" below).

| Table                   | Purpose                                                                 |
| ------------------------ | -------------------------------------------------------------------------- |
| `tally_groups`           | A group: name, description, default currency, debt-simplification toggle |
| `tally_group_members`    | Instance users (`user_id` set) and guests (`guest_name`/`guest_email`)   |
| `tally_expenses`         | Description, amount, currency, category, split method; soft-deleted via `deleted_at` |
| `tally_expense_payers`   | Who paid how much, per expense (supports multi-payer expenses)          |
| `tally_expense_shares`   | Who owes how much, per expense (the resolved per-method split)          |
| `tally_expense_comments` | Free-text comments on an expense, author = platform user id             |
| `tally_settlements`      | A recorded payment between two members: amount, currency, optional date/notes |

`tally_expense_shares`/`tally_expense_comments` and settlement rows are
soft-delete-free — only expenses are soft-deleted (`deleted_at`), preserved
for the activity feed and CSV export; deleting one immediately drops it from
every balance calculation, which filters on `deleted_at IS NULL`.

### Balance calculation

Computed at query time, never stored (SPEC.md's explicit data-model
decision). `app/_lib/balance.ts` holds the two pure functions:

- `computeNetBalances(payers, shares, settlements)` — sums each member's net
  balance (positive = owed, negative = owes) from raw rows. Currency-agnostic
  — the caller is responsible for only passing rows that share one currency.
- `simplifyDebts(balances)` — the greedy largest-debtor/largest-creditor
  minimum-transaction algorithm (SPL-11), given one currency's balance map.

`app/_lib/actions.ts`'s `computeGroupBalancesByCurrency` is the DB-layer
counterpart: fetches every non-deleted expense (tagged with its own
currency), payer/share row, and settlement (which already carries its own
currency) for a group, buckets them by currency, and calls
`computeNetBalances` once per bucket. Every balance-dependent read
(`getGroupBalances`, `getOverallBalance`) and every zero-balance guard
(`groupHasZeroBalances` for group deletion SPL-02, the per-member check in
`removeMember` for SPL-04) goes through this bucketed function — a member's
balance is only "zero" when it's zero in **every** currency they've touched.

### Multi-currency (SPL-21–23)

An expense can be recorded in a currency other than its group's own
(`tally_expenses.currency`, always set — defaults to the group's currency
when the user doesn't override it). When it differs, `exchange_rate_micros`
(integer, ×1,000,000: `1 unit of currency = exchangeRateMicros / 1,000,000
units of the group's currency`) is required and manually entered — automatic
conversion is explicitly out of scope. `_lib/money.ts`'s
`rateToMicros`/`microsToRate`/`convertCentsWithRate` are the only place this
value is parsed/formatted/applied; storing it as a plain float would
reintroduce the exact precision drift the platform's cents-as-integers
convention exists to avoid, even though a rate isn't itself a monetary
amount.

Balances are shown **per currency**, never converted into one combined
figure (`getGroupBalances` returns `{ simplifyDebts, byCurrency:
CurrencyBalances[] }`, one entry per currency the group has ever used, own
currency first) — `BalanceSection` renders one block per entry, with a
currency-code subheading only when there's more than one. The cross-group
overall summary (`getOverallBalance`, SPL-10) deliberately stays scoped to
each group's own default-currency bucket only; foreign-currency
sub-balances are visible solely in the per-group view.

### SDK integration points

| SDK surface         | Used for                                                              |
| -------------------- | -------------------------------------------------------------------------- |
| `sdk.auth`           | Every server action's `getContext()` — session + tenant + DB client       |
| `sdk.directory`      | Resolving instance-user display names/emails; member search/add          |
| `sdk.db`             | All `tally_*` table reads/writes                                          |
| `sdk.activity`       | `_lib/activity.ts`'s `recordActivity` — platform audit log, best-effort   |
| `sdk.notifications`  | `_lib/notify.ts`'s `notifyUser` — in-app notifications, best-effort       |
| `sdk.email`          | `_lib/email.ts`'s `sendUserEmail`, via `sendToUser` (RFC 0062) — best-effort, needs only `mailer:send` |
| `sdk.portability`    | `_lib/portability.ts` — export/import/delete (RFC 0007/0033/0068)        |
| `sdk.data`           | `_lib/data-contracts.ts` — the four read-only contracts, RFC 0002        |

**Every one of these is best-effort and wrapped in try/catch at its call
site** — a notification, activity-log, or email failure must never block the
mutation that triggered it, since that mutation (the expense/settlement/
group change) already succeeded by the time the platform integration runs.
This is a deliberate, repeated pattern across `activity.ts`, `notify.ts`,
`email.ts`, and every place they're called from `actions.ts` — follow it for
any new platform-integration call site rather than letting an unrelated
delivery failure surface as a user-facing error.

**`sdk.email.sendToUser` over raw `sdk.mailer.send`:** `sendToUser` resolves
the recipient server-side by platform user ID and only needs the
`mailer:send` permission already declared. The raw `mailer.send` escape
hatch takes a caller-supplied address directly and additionally requires
`mailer:sendExternal` — Tally never needs that, since every email recipient
is always a platform user (guests have no account and can't receive email
from this plugin).

### Route handlers vs. Server Actions

`app/export/[groupId]/route.ts` (CSV download, SPL-19) is a plugin-owned
Route Handler, not a Server Action — a Server Action can't set
`Content-Disposition: attachment`, and a plain `GET` under the plugin's own
`routePrefix` is gated by the normal session middleware exactly like a page.
It reuses `getContext`/`requireMembership`/`resolveMemberDisplayNames`
(exported from `actions.ts` specifically for this reuse) rather than
duplicating the membership-check logic.

## Software requirements

Full requirement list with IDs: [SPEC.md](SPEC.md) § Functional requirements.
Full phase-by-phase build history and the concrete decisions behind each
task: [roadmap.md](roadmap.md) — every completed task has a "note" recording
what was actually built and why, which is more detailed and more current
than this file for any single task's specifics.

### Out of scope (see SPEC.md for full list)

- Automatic currency conversion (manual exchange-rate entry only, SPL-22).
- Recording a settlement in the SDK-tools sense ("record settlement via
  assistant") — blocked on `sdk.tools` (RFC 0047), not yet implemented
  anywhere in the platform. Not part of any shipped v0.x scope.
- A non-simplified pairwise settlement ledger — there's no stored
  per-expense debtor/creditor edge to derive one from; with the
  simplify-debts toggle off, the balance view shows raw per-member net
  balances only, no derived suggested payments.
