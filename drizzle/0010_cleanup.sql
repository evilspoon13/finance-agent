CREATE TABLE "category_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"match" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "ai_cache" CASCADE;--> statement-breakpoint
DROP TABLE "alerts" CASCADE;--> statement-breakpoint
DROP TABLE "conversations" CASCADE;--> statement-breakpoint
DROP TABLE "messages" CASCADE;--> statement-breakpoint
ALTER TABLE "cards" RENAME COLUMN "ai_notes" TO "notes";--> statement-breakpoint
UPDATE "cards" SET "earn_rules" = jsonb_build_object('kind', 'category', 'baseBps', "earn_rules"->'bps', 'bonuses', '{}'::jsonb) WHERE "earn_rules"->>'kind' = 'flat';--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "network";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "discover_cap_cents";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "cashback_match_year_one";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "rewards_confirmed";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "ai_suggestion";--> statement-breakpoint
DROP TYPE "public"."alert_kind";--> statement-breakpoint
DROP TYPE "public"."message_role";