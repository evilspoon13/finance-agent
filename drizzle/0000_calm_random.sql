CREATE TYPE "public"."alert_kind" AS ENUM('budget', 'wrong_card', 'anomaly');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('good', 'login_required', 'error');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text,
	"type" text NOT NULL,
	"subtype" text,
	"mask" text,
	"current_balance_cents" integer,
	"available_balance_cents" integer,
	"iso_currency" text DEFAULT 'USD',
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"monthly_limit_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"label" text NOT NULL,
	"network" text NOT NULL,
	"earn_rules" jsonb NOT NULL,
	"discover_cap_cents" integer,
	"cashback_match_year_one" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"security_id" text NOT NULL,
	"ticker" text,
	"name" text NOT NULL,
	"quantity" numeric NOT NULL,
	"value_cents" integer NOT NULL,
	"cost_basis_cents" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"plaid_item_id" text NOT NULL,
	"institution_name" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"cursor" text,
	"status" "item_status" DEFAULT 'good' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_plaid_item_id_unique" UNIQUE("plaid_item_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"merchant_name" text,
	"name" text NOT NULL,
	"pfc_primary" text,
	"pfc_detailed" text,
	"mcc" text,
	"pending" boolean DEFAULT false NOT NULL,
	"pending_transaction_id" text,
	"authorized_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"optimal_card_id" text,
	"reward_delta_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holdings_account_idx" ON "holdings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_account_idx" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_posted_idx" ON "transactions" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "transactions_pfc_primary_idx" ON "transactions" USING btree ("pfc_primary");--> statement-breakpoint
CREATE INDEX "transactions_pending_txn_idx" ON "transactions" USING btree ("pending_transaction_id");