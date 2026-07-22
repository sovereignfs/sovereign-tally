-- Tally plugin schema — SQLite dialect. v0.3 (SPL-22).
-- Adds the manual exchange-rate column to tally_expenses.

ALTER TABLE `tally_expenses` ADD COLUMN `exchange_rate_micros` integer;
