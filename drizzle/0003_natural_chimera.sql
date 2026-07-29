ALTER TABLE "cards" ADD COLUMN "rewards_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "annual_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "signup_bonus" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "ai_notes" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "ai_suggestion" jsonb;