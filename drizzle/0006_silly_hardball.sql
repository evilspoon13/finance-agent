CREATE TABLE "net_worth_snapshots" (
	"day" date PRIMARY KEY NOT NULL,
	"assets_cents" integer NOT NULL,
	"liabilities_cents" integer NOT NULL,
	"net_worth_cents" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
