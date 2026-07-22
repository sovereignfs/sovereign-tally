-- Tally plugin schema — SQLite dialect. v0.2 (SPL-20).
-- Idempotent (IF NOT EXISTS) — safe to run against an existing store.

CREATE TABLE IF NOT EXISTS `tally_expense_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`expense_id` text NOT NULL,
	`group_id` text NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
