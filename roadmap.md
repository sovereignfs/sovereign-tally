# Tally — Roadmap

**Version:** 0.1 · **Last updated:** 2026-07-16

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
| 0.1.4 | Groups: delete when all balances zero                                 | 📋     | SPL-02         | Plugin   |
| 0.1.5 | Members: add instance users + guest members (name + optional email)   | 📋     | SPL-03         | Plugin   |
| 0.1.6 | Members: remove when balance zero                                     | 📋     | SPL-04         | Plugin   |
| 0.1.7 | `sdk.directory` integration for member search/select UI                | 📋     | (supports SPL-03) | Plugin |
| 0.1.8 | Expense CRUD: create with description, amount, date, category, payer   | 📋     | SPL-05         | Plugin   |
| 0.1.9 | Split methods: equal, exact amount, percentage, shares                 | 📋     | SPL-05, SPL-12, SPL-13, SPL-14 | Plugin |
| 0.1.10 | Multiple payers per expense                                          | 📋     | SPL-15         | Plugin   |
| 0.1.11 | Edit expense                                                          | 📋     | SPL-06         | Plugin   |
| 0.1.12 | Soft-delete expense (preserved in activity feed)                     | 📋     | SPL-07         | Plugin   |
| 0.1.13 | `lib/balance.ts` — balance calculation at query time                 | 📋     | SPL-09, SPL-10 | Plugin   |
| 0.1.14 | `lib/balance.ts` — greedy debt-simplification algorithm              | 📋     | SPL-11         | Plugin   |
| 0.1.15 | Activity feed per group (expenses + settlements, chronological)      | 📋     | SPL-08         | Plugin   |
| 0.1.16 | `sdk.activity` integration — platform-visible expense/settlement events | 📋   | (supports SPL-08) | Plugin |
| 0.1.17 | Balance view per group + overall summary across groups                | 📋     | SPL-09, SPL-10 | Plugin   |
| 0.1.18 | `sdk.notifications` integration — member added / expense added / payer set | 📋 | SPL-24         | Plugin   |
| 0.1.19 | Rely on platform Notification Center for read state, muting, push     | 📋     | SPL-25         | Plugin   |
| 0.1.20 | `@sovereignfs/ui` primitives: split-method selector, member multi-select w/ guest-add, integer currency input, balance chip | 📋 | (UI, see SPEC) | Plugin |

**Done when:** a user can create a group, add expenses with any split method
and multiple payers, view simplified balances, receive an in-app notification
when a group member adds an expense, and rely on platform push preferences for
browser push delivery.

---

## v0.2 — Settlements and power features (SPL-16, SPL-19–20)

| #     | Task                                          | Status | Requirement(s) | Label  |
| ----- | ---------------------------------------------- | ------ | -------------- | ------ |
| 0.2.1 | Record a settlement between two members        | 📋     | SPL-16         | Plugin |
| 0.2.2 | CSV export of group expenses + settlements     | 📋     | SPL-19         | Plugin |
| 0.2.3 | `sdk.portability` export/import/delete hooks for groups, memberships, guests | 📋 | (data sovereignty, see SPEC) | Plugin |
| 0.2.4 | Comments on expenses                           | 📋     | SPL-20         | Plugin |
| 0.2.5 | `sdk.data` read-only contracts: `Tally.groups`, `Tally.balances`, `Tally.expenses`, `Tally.memberships` | 📋 | (approved consumers, see SPEC) | Plugin |

**Done when:** a settlement reduces balances correctly; CSV export downloads a
complete group history; members can comment on expenses.

---

## v0.3 — Multi-currency (SPL-21–23)

| #     | Task                                                  | Status | Requirement(s) | Label  |
| ----- | ------------------------------------------------------ | ------ | -------------- | ------ |
| 0.3.1 | Record an expense in a non-default currency             | 📋     | SPL-21         | Plugin |
| 0.3.2 | Manual exchange-rate entry on non-default-currency expenses | 📋 | SPL-22       | Plugin |
| 0.3.3 | Per-currency balance display when a group has mixed currencies | 📋 | SPL-23     | Plugin |

**Done when:** a group with USD and EUR expenses shows separate per-currency
balances; editing the exchange rate on an expense recalculates immediately.

---

## v0.4 — Email notifications (SPL-17–18)

| #     | Task                                                        | Status | Requirement(s) | Label  |
| ----- | -------------------------------------------------------------- | ------ | -------------- | ------ |
| 0.4.1 | `sdk.mailer` integration — new-expense notification email to group | 📋 | SPL-17     | Plugin |
| 0.4.2 | Settlement summary email (balances + suggested payments), on-demand + triggered on settle-up | 📋 | SPL-18 | Plugin |

**Done when:** expense notification emails send (or no-op without SMTP);
settlement summary email delivers current balances and suggested payments.

---

## v1.0 — Stable

| #     | Task                                          | Status | Requirement(s) | Label  |
| ----- | ------------------------------------------------ | ------ | -------------- | ------ |
| 1.0.1 | Plugin developer guide reference write-up          | 📋     | —              | Plugin |
| 1.0.2 | Documentation + polish pass, no scope expansion    | 📋     | —              | Plugin |

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
