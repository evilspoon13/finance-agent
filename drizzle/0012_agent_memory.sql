CREATE TYPE "public"."agent_action_status" AS ENUM('open', 'done', 'dismissed');--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"due_on" date,
	"status" "agent_action_status" DEFAULT 'open' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "agent_actions_status_idx" ON "agent_actions" USING btree ("status");