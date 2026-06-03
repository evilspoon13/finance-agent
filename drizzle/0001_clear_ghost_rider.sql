CREATE TABLE "ai_cache" (
	"scope" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"model" text NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
