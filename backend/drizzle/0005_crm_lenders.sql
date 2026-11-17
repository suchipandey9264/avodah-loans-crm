ALTER TABLE "lenders" ADD COLUMN "contacts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lenders" ADD COLUMN "payout_pct" double precision;--> statement-breakpoint
ALTER TABLE "lenders" ADD COLUMN "tat_days" integer;--> statement-breakpoint
ALTER TABLE "lenders" ADD COLUMN "agreement_until" date;