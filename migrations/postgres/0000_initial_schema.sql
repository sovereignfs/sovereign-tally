CREATE TABLE "tally_expense_payers" (
	"expense_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"amount_paid" integer NOT NULL,
	CONSTRAINT "tally_expense_payers_expense_id_member_id_pk" PRIMARY KEY("expense_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "tally_expense_shares" (
	"expense_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"share_amount" integer NOT NULL,
	CONSTRAINT "tally_expense_shares_expense_id_member_id_pk" PRIMARY KEY("expense_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "tally_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"group_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"category" text NOT NULL,
	"date" text NOT NULL,
	"notes" text,
	"split_method" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	"deleted_at" integer
);
--> statement-breakpoint
CREATE TABLE "tally_group_members" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text,
	"guest_name" text,
	"guest_email" text,
	"joined_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"currency" text NOT NULL,
	"simplify_debts" integer DEFAULT 1 NOT NULL,
	"archived_at" integer,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"group_id" text NOT NULL,
	"from_member_id" text NOT NULL,
	"to_member_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"date" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tally_group_members_group_user_idx" ON "tally_group_members" USING btree ("group_id","user_id");