CREATE TABLE "investment_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"security_id" text,
	"ticker" text,
	"security_name" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"quantity" numeric NOT NULL,
	"price_cents" integer,
	"amount_cents" integer NOT NULL,
	"fees_cents" integer,
	"iso_currency" text DEFAULT 'USD',
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_txns_account_idx" ON "investment_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "investment_txns_posted_idx" ON "investment_transactions" USING btree ("posted_at");