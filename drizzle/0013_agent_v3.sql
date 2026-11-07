CREATE TABLE "agent_knowledge" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"topic" text NOT NULL,
	"body" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"session_url" text,
	"verified_at" timestamp with time zone,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_scorecards" (
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_scorecards_kind_period_pk" PRIMARY KEY("kind","period")
);
--> statement-breakpoint
CREATE TABLE "investment_ideas" (
	"ticker" text PRIMARY KEY NOT NULL,
	"name" text,
	"status" text DEFAULT 'researching' NOT NULL,
	"thesis" text,
	"bear_case" text,
	"valuation" text,
	"invalidation" text,
	"next_review_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"action" text NOT NULL,
	"account" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"rationale" text NOT NULL,
	"entry_condition" text,
	"invalidation" text,
	"review_on" date,
	"entry_price_cents" integer,
	"benchmark_ticker" text NOT NULL,
	"benchmark_price_cents" integer,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"ticker" text NOT NULL,
	"day" date NOT NULL,
	"close_cents" integer NOT NULL,
	CONSTRAINT "price_snapshots_ticker_day_pk" PRIMARY KEY("ticker","day")
);
--> statement-breakpoint
CREATE TABLE "research_memos" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"session_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD COLUMN "kind" text DEFAULT 'action' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD COLUMN "answer" text;--> statement-breakpoint
CREATE INDEX "agent_knowledge_slug_idx" ON "agent_knowledge" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "agent_knowledge_status_idx" ON "agent_knowledge" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_knowledge_active_slug_idx" ON "agent_knowledge" USING btree ("slug") WHERE "agent_knowledge"."status" = 'active';--> statement-breakpoint
CREATE INDEX "investment_proposals_created_idx" ON "investment_proposals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "research_memos_created_idx" ON "research_memos" USING btree ("created_at");