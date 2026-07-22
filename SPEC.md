# Tally

**Version:** 0.4\
**Date:** July 2026\
**Author(s):** kasunben, DishanRajapaksha\
**Purpose:** Canonical specification for the Sovereign Tally plugin — the single source of truth for its manifest, access model, data model, and build plan.\
**Status:** All v0.1–v0.4 requirements (SPL-01–25) implemented and self-verified, see roadmap.md — not yet burned in with real usage; premature to call this v1.0/Stable.

---

Sovereign Tally is a privacy-first, self-hosted alternative to Splitwise for
tracking shared expenses and settling debts. The scope is all Splitwise free-tier
functionality, plus features Splitwise gates behind its Pro tier (debt
simplification, CSV export). There are no ads, no limits, no bank or payment
integrations.

The plugin is `type: sovereign` — maintained in a separate external repository
(`sovereign-tally`) and the reference implementation for a plugin that
exercises `sdk.mailer`.

## Current platform refresh (July 2026)

The platform now provides several surfaces this draft originally modeled locally.
`sdk.notifications`, `sdk.activity`, `sdk.directory`, `sdk.data`, and
`sdk.portability` are all implemented today (still "experimental" per the SDK
stability tiers in `docs/sdk-stability.md` — shape may change before v1.0.0,
but the code is real, not proposed):

- Use `sdk.notifications` for in-app and push delivery instead of plugin-owned
  push subscription tables.
- Use `sdk.activity` for platform-visible settlement and expense events; keep
  the group activity feed as a domain timeline.
- Use the implemented user-directory SDK (`sdk.directory`, RFC 0041) for member
  selection.
- Add export/import/delete handling for group data and guest members via
  `sdk.portability`.
- Expose read-only data contracts for approved consumers via `sdk.data`: group
  balances, settlement suggestions, expenses, and memberships.
- Future assistant/automation mutations such as "record settlement" should use
  plugin tool contracts (RFC 0047) — **this one is genuinely not implemented
  yet**: no `sdk.tools` module exists in `packages/sdk/src`, and the RFC is
  still `📋` (not started) on the roadmap. Treat any "record settlement via
  assistant" functional requirement as blocked until RFC 0047 ships.

See [`roadmap.md`](roadmap.md) for the prioritized, sequenced task breakdown
(including tracked platform-capability gaps) derived from this spec.

## Contents

- [Identity and manifest](#identity-and-manifest)
- [Access control](#access-control)
- [Functional requirements](#functional-requirements)
- [Directory structure](#directory-structure)
- [Data model](#data-model)
- [SDK dependencies](#sdk-dependencies)
- [UI](#ui)
- [Build plan](#build-plan)
- [Open questions](#open-questions)
- [Changelog](#changelog)

---

## Identity and manifest

| Property                           | Value                                                      |
| ---------------------------------- | ---------------------------------------------------------- |
| `id`                               | `fs.sovereign.tally`                             |
| `name`                             | `Tally`                                                 |
| `type`                             | `sovereign`                                                |
| `runtime`                          | `native`                                                   |
| `routePrefix`                      | `/tally`                                                |
| `shell`                            | `default`                                                  |
| `adminOnly`                        | omitted (`false`)                                          |
| `icon`                             | `icon.svg`                                                 |
| `permissions`                      | `auth:session`, `db:readWrite`, `mailer:send`, `notifications:send`, `activity:write`, `data:provide` |
| `repository`                       | `https://github.com/sovereignfs/sovereign-tally` |
| `compatibility.minPlatformVersion` | `0.26.0`                                                   |

Proposed `manifest.json`:

```json
{
  "schemaVersion": 1,
  "id": "fs.sovereign.tally",
  "name": "Tally",
  "version": "0.1.0",
  "description": "Shared expense tracking and debt settlement.",
  "type": "sovereign",
  "runtime": "native",
  "routePrefix": "/tally",
  "shell": "default",
  "icon": "icon.svg",
  "permissions": [
    "auth:session",
    "db:readWrite",
    "mailer:send",
    "notifications:send",
    "activity:write",
    "data:provide"
  ],
  "repository": "https://github.com/sovereignfs/sovereign-tally",
  "compatibility": {
    "minPlatformVersion": "0.26.0"
  }
}
```

Tally is the first reference plugin to declare `mailer:send` — used for
expense notifications and settlement summary emails (v0.2). It validates the
`sdk.mailer` surface end-to-end.

## Access control

Available to authenticated users who can launch installed plugins. No admin gate.

Data-scoped within the plugin: a user sees only groups they are a member of.
**Guest members** (non-Sovereign users added by name and optional email) appear
in balances and can receive settlement emails at their address, but cannot log in
to the instance to view data.

## Functional requirements

Requirements are versioned to their milestone. IDs are stable — never renumber
or reuse an SPL-\* id.

### v0.1 — Core

| ID     | Requirement                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPL-01 | Create, rename, and archive groups. A group has: name, optional description, default currency (ISO 4217), and debt-simplification toggle (default on).                                                                                                                                |
| SPL-02 | Delete a group — only when all member balances are zero.                                                                                                                                                                                                                              |
| SPL-03 | Add instance users to a group. Add guest members by name + optional email address.                                                                                                                                                                                                    |
| SPL-04 | Remove a member from a group — only when their balance is zero.                                                                                                                                                                                                                       |
| SPL-05 | Add an expense: description, amount, date, category (fixed set), single payer, split among selected members using the chosen split method. Amounts stored as integers (smallest unit).                                                                                                |
| SPL-06 | Edit an expense.                                                                                                                                                                                                                                                                      |
| SPL-07 | Soft-delete an expense — preserved in the activity feed as deleted; balances recalculated immediately.                                                                                                                                                                                |
| SPL-08 | Activity feed per group — chronological list of all expenses and settlements.                                                                                                                                                                                                         |
| SPL-09 | Balance view per group — net balance per member pair; simplified when debt-simplification toggle is on.                                                                                                                                                                               |
| SPL-10 | Overall balance summary across all groups for the current user.                                                                                                                                                                                                                       |
| SPL-11 | Debt simplification: greedy minimum-transaction algorithm reduces N pairwise debts to the minimum number of payments needed to settle a group.                                                                                                                                        |
| SPL-12 | Split by exact amount: each member owes a specified amount; amounts must sum to the expense total.                                                                                                                                                                                    |
| SPL-13 | Split by percentage: each member owes a percentage; percentages must sum to 100%.                                                                                                                                                                                                     |
| SPL-14 | Split by shares: each member assigned a number of shares; amount divided proportionally.                                                                                                                                                                                              |
| SPL-15 | Multiple payers on a single expense: each payer records how much they paid; totals must equal expense amount.                                                                                                                                                                         |
| SPL-24 | Send platform notifications via `sdk.notifications` when a user is added to a group, a new expense is added, a user is set as payer, or a settlement is recorded involving them. |
| SPL-25 | Notification read/unread state, category muting, and browser push subscriptions are handled by the platform Notification Center and Account preferences. |

**Expense categories (fixed set):** Food & Drink, Housing, Transport,
Entertainment, Health, Shopping, Travel, Other.

### v0.2 — Settlements and power features

| ID     | Requirement                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| SPL-16 | Record a settlement (payment) from one member to another within a group. Fields: amount, optional date, optional notes. |
| SPL-19 | Export group expenses and settlements to CSV.                                                                           |
| SPL-20 | Comments on expenses: free-text notes added by any group member after the expense is created.                           |

### v0.3 — Multi-currency

| ID     | Requirement                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| SPL-21 | Record an expense in a currency other than the group's default currency.                                                        |
| SPL-22 | Manual exchange rate entry when recording a non-default-currency expense. Automatic currency conversion is explicitly deferred. |
| SPL-23 | Balances displayed per currency when a group contains expenses in multiple currencies.                                          |

### v0.4 — Email notifications

| ID     | Requirement                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| SPL-17 | Expense notification email to all group members when a new expense is added (uses `sdk.mailer`; no-ops when SMTP unconfigured).          |
| SPL-18 | Settlement summary email: current balances + minimum-transaction settlement suggestions, sent on demand or triggered on group settle-up. |

## Directory structure

```
sovereign-tally/
├── manifest.json
├── icon.svg                    # Tally icon — sidebar middle section + Launcher grid
├── app/
│   ├── layout.tsx              # groups sidebar + content area
│   ├── page.tsx                # all groups overview + overall balance
│   └── [groupId]/
│       └── page.tsx            # activity feed + balance view + actions
├── db/
│   └── schema.ts               # all Tally_* tables
├── migrations/                 # Drizzle migration files
├── components/
│   ├── ExpenseForm.tsx         # add/edit expense
│   ├── SplitEditor.tsx         # equal/amount/percentage/shares UI
│   ├── PayerSelector.tsx       # single + multiple payers
│   ├── BalanceView.tsx         # per-group balances + simplified debt list
│   ├── SettlementForm.tsx      # record a settlement
│   └── NotificationPrefs.tsx   # optional plugin category hints
├── lib/
│   ├── balance.ts              # balance calculation + debt simplification algorithm
│   └── notifications.ts        # sdk.notifications helpers
└── package.json
```

## Data model

Six tables for v0.1, all prefixed `tally_`. All carry `tenant_id` per the
platform architectural rule. A seventh table, `tally_expense_comments`, is
added in v0.2 (SPL-20).

### `Tally_groups`

| Column           | Type       | Notes                         |
| ---------------- | ---------- | ----------------------------- |
| `id`             | uuid / pk  |                               |
| `tenant_id`      | string     |                               |
| `created_by`     | string     | FK → users.                   |
| `name`           | string     |                               |
| `description`    | string?    | Nullable.                     |
| `currency`       | string     | ISO 4217 code (e.g. `"USD"`). |
| `simplify_debts` | boolean    | Default `true`.               |
| `archived_at`    | timestamp? | Nullable. Set on archive.     |
| `created_at`     | timestamp  |                               |

### `Tally_group_members`

| Column        | Type      | Notes                                                           |
| ------------- | --------- | --------------------------------------------------------------- |
| `id`          | uuid / pk |                                                                 |
| `tenant_id`   | string    |                                                                 |
| `group_id`    | uuid      | FK → `tally_groups`.                                         |
| `user_id`     | string?   | Nullable. FK → users. Null for guest members.                   |
| `guest_name`  | string?   | Nullable. Required when `user_id` is null.                      |
| `guest_email` | string?   | Nullable. Used for sending emails to guests without an account. |
| `joined_at`   | timestamp |                                                                 |

Constraint: exactly one of (`user_id`, `guest_name`) must be non-null (enforced
at app layer). Unique index on (`group_id`, `user_id`) for instance-user members.

### `tally_expenses`

| Column         | Type       | Notes                                                                                          |
| -------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `id`           | uuid / pk  |                                                                                                |
| `tenant_id`    | string     |                                                                                                |
| `group_id`     | uuid       | FK → `Tally_groups`.                                                                        |
| `description`  | string     |                                                                                                |
| `amount`       | integer    | Cents (smallest currency unit). Never store as float.                                          |
| `currency`     | string     | ISO 4217. Defaults to group currency. Set at creation.                                         |
| `category`     | enum       | `food_drink \| housing \| transport \| entertainment \| health \| shopping \| travel \| other` |
| `date`         | date       |                                                                                                |
| `notes`        | text?      | Nullable.                                                                                      |
| `split_method` | enum       | `equal \| amount \| percentage \| shares`                                                      |
| `created_by`   | string     | FK → users.                                                                                    |
| `created_at`   | timestamp  |                                                                                                |
| `updated_at`   | timestamp  |                                                                                                |
| `deleted_at`   | timestamp? | Nullable. Soft delete — row preserved for activity feed.                                       |

### `Tally_expense_payers`

| Column        | Type    | Notes                                                                         |
| ------------- | ------- | ----------------------------------------------------------------------------- |
| `expense_id`  | uuid    | FK → `tally_expenses`.                                                     |
| `tenant_id`   | string  |                                                                               |
| `member_id`   | uuid    | FK → `tally_group_members`.                                                |
| `amount_paid` | integer | Cents. In v0.1: one row per expense (full amount). v0.2 allows multiple rows. |

Composite PK: (`expense_id`, `member_id`).

### `Tally_expense_shares`

| Column         | Type    | Notes                                                                |
| -------------- | ------- | -------------------------------------------------------------------- |
| `expense_id`   | uuid    | FK → `tally_expenses`.                                            |
| `tenant_id`    | string  |                                                                      |
| `member_id`    | uuid    | FK → `tally_group_members`.                                       |
| `share_amount` | integer | Cents. Sum across all rows for an expense must equal expense amount. |

### `Tally_settlements`

| Column           | Type      | Notes                          |
| ---------------- | --------- | ------------------------------ |
| `id`             | uuid / pk |                                |
| `tenant_id`      | string    |                                |
| `group_id`       | uuid      | FK → `tally_groups`.        |
| `from_member_id` | uuid      | FK → `tally_group_members`. |
| `to_member_id`   | uuid      | FK → `tally_group_members`. |
| `amount`         | integer   | Cents.                         |
| `currency`       | string    | ISO 4217.                      |
| `date`           | date?     | Nullable.                      |
| `notes`          | string?   | Nullable.                      |
| `created_by`     | string    | FK → users.                    |
| `created_at`     | timestamp |                                |

**Balance calculation** is computed at query time (not stored). For each member
pair in a group: sum of `share_amount` they owe across all non-deleted expenses,
minus sum of `amount_paid` they contributed, adjusted by settlements. When
`simplify_debts` is on, the resulting net-balance array is passed through the
greedy minimum-transaction algorithm in `lib/balance.ts`.

Plugin-local notification and push-subscription tables are no longer needed.
Notification delivery, read state, category preferences, and Web Push fan-out
belong to the platform Notification Center.

## SDK dependencies

| SDK surface  | Used for                                        | Available from |
| ------------ | ----------------------------------------------- | -------------- |
| `sdk.auth`          | User session                                      | Stable       |
| `sdk.directory`     | User lookup for member management                 | Experimental (implemented, RFC 0041) |
| `sdk.db`            | Read/write all `tally_*` tables                | Stable       |
| `sdk.mailer`        | Settlement summary + expense emails               | Stable       |
| `sdk.notifications` | In-app and push notifications                     | Experimental |
| `sdk.activity`      | Platform-visible settlement and expense events    | Experimental |
| `sdk.data`          | Expose balances, memberships, and expenses        | Experimental |
| `sdk.portability`   | Export/import/delete participation                | Experimental |
| `sdk.tools`         | Future mutating actions such as record settlement | Not implemented — RFC 0047 still 📋 (not started) |

### Data contracts

Candidate read-only contracts:

| Contract                | Version | Shape                                          |
| ----------------------- | ------- | ---------------------------------------------- |
| `Tally.groups`       | 1       | Groups visible to the current user.            |
| `Tally.balances`     | 1       | Per-group balances and settlement suggestions. |
| `Tally.expenses`     | 1       | Expense summaries visible to the current user. |
| `Tally.memberships`  | 1       | Group member display data and roles.           |

### Portability and deletion

Export includes groups owned by or shared with the user, member rows, expenses,
shares, payers, settlements, comments, and domain activity events. Import
restores owned groups additively and remaps member/group IDs. User deletion
anonymizes historical group activity where needed, removes personal membership
from groups with zero balance, and blocks deletion or requires transfer when the
user is the last owner with unsettled balances.

## UI

Two-panel layout: groups list in a sidebar, content area showing the activity
feed or balance view for the selected group.

**Net-new `@sovereignfs/ui` primitives likely needed:** split-method selector
(segmented control), member multi-select with guest-add support, integer currency
input (amount entry with proper decimal display), inline balance chip
(green/red for owed/owing), CSV download trigger button.

Drive these into `packages/ui` rather than building inline — balance chips and
currency inputs are broadly useful across future financial plugins.

## Build plan

### v0.1 — Core (SPL-01–15, SPL-24–25)

Groups with default currency and debt-simplification toggle, guest members,
expense CRUD with all four split methods (equal, by amount, by percentage, by
shares), multi-payer expenses, activity feed, per-group and overall balance views,
debt simplification, and platform notifications.

**Done when:** A user can create a group, add expenses with any split method and
multiple payers, view simplified balances, receive an in-app notification when a
group member adds an expense, and rely on platform push preferences for browser
push delivery.

### v0.2 — Settlements and power features (SPL-16, SPL-19–20)

Record settlements, CSV export, expense comments.

**Done when:** A settlement reduces balances correctly; CSV export downloads a
complete group history; members can comment on expenses.

### v0.3 — Multi-currency (SPL-21–23)

Record expenses in non-default currencies with manual exchange rate. Balances
display per currency when mixed.

**Done when:** A group with USD and EUR expenses shows separate per-currency
balances; editing the exchange rate on an expense recalculates immediately.

### v0.4 — Email notifications (SPL-17–18)

Expense notification emails and settlement summary emails via `sdk.mailer`.

**Done when:** Expense notification emails send (or no-op without SMTP);
settlement summary email delivers current balances and suggested payments.

### v1.0 — Stable

Documentation, polish, plugin developer guide reference. No scope expansion.

## Resolved decisions (formerly "Open questions")

All four questions below were open during the design phase and are now
resolved by what actually shipped through the v0.1–v0.4 build — recorded
here rather than left as speculative "recommendations" that no longer match
the code.

1. **Delete group with unsettled balances: blocked, not warn-and-allow.**
   SPL-02 as written ("only when all member balances are zero") is what
   shipped — `groupHasZeroBalances` hard-blocks deletion with an inline error
   until every member is settled in every currency (0.1.4, extended for
   multi-currency in 0.3.3). The original "warn + allow" recommendation was
   never implemented; a full block was judged safer for real financial
   records than an override a user could click through by habit. Revisit if
   real usage shows this is too strict.
2. **Guest member emails: guests receive no email at all.** Neither the
   expense-added email (SPL-17) nor the settlement-summary email (SPL-18)
   sends to `tally_group_members.guest_email` — both are scoped to instance
   users only (`sendSettlementSummaryEmail`/`addExpense` filter to rows with
   a non-null `user_id`). This matches the platform's broader
   no-invite-by-email convention (see e.g. `sovereign-tritext`'s Collaborator
   model): a person without a platform account has no inbox this plugin
   should be emailing on the instance's behalf. A "join instance from Tally
   invite" flow remains a real post-v1.1 opportunity, not yet scoped.
3. **Personal IOUs: no dedicated flow — confirmed sufficient.** A two-member
   group covers this throughout v0.1–v0.4 with no special-cased UI or schema;
   nothing surfaced during the build that needed one.
4. **Balance computation performance: still query-time, unchanged.**
   `computeGroupBalancesByCurrency` (0.3.3) added a currency-bucketing pass
   but stayed query-time-only — no pre-aggregated snapshot table was needed
   through v0.4. Revisit only if a real instance's group size/expense count
   makes this measurably slow, not preemptively.

## Changelog

| Version | Date     | Change                                                                                    |
| ------- | -------- | ----------------------------------------------------------------------------------------- |
| 0.4     | Jul 2026 | All v0.1–v0.4 requirements (SPL-01–25) implemented and self-verified — not yet used in production, so **not** tagged v1.0/Stable (see Status above). Resolved the four design-phase "Open questions" against actual implemented behavior (see "Resolved decisions" above) rather than leaving them as stale recommendations. |
| 0.3     | Jul 2026 | Corrected stale "proposed" framing: `sdk.directory` (RFC 0041), `sdk.data`, `sdk.portability`, `sdk.notifications`, and `sdk.activity` are all implemented (still experimental-tier, not stable). `sdk.tools` (RFC 0047) confirmed genuinely not implemented — flagged as the one real blocking gap for any assistant-driven settlement flow. |
| 0.2     | Jun 2026 | Added manifest `icon` field; added missing `tenant_id` to member/payer/share/push tables. |
| 0.1     | Jun 2026 | Initial draft — feature set designed from Splitwise analysis and design session.          |
