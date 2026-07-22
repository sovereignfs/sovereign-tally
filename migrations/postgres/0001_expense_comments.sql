CREATE TABLE "tally_expense_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"expense_id" text NOT NULL,
	"group_id" text NOT NULL,
	"body" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL
);
