ALTER TABLE "applications" ADD COLUMN "stage" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "processing_fee" double precision;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "lender_ref" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "sanctioned_amount" double precision;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "sanctioned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "disbursed_amount" double precision;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "disbursed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_stage_created_idx" ON "applications" USING btree ("stage","created_at");--> statement-breakpoint
CREATE INDEX "applications_assigned_idx" ON "applications" USING btree ("assigned_to");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_stage_check" CHECK ("applications"."stage" in ('new', 'login', 'documents', 'credit_review', 'sanctioned', 'disbursed', 'rejected'));--> statement-breakpoint
-- Existing applications start at the stage matching their status; files from converted leads were logged with the lender.
UPDATE "applications" SET "stage" = CASE "status"
  WHEN 'in_review' THEN 'documents' WHEN 'approved' THEN 'sanctioned' WHEN 'rejected' THEN 'rejected' WHEN 'disbursed' THEN 'disbursed'
  ELSE CASE WHEN "lead_id" IS NOT NULL THEN 'login' ELSE 'new' END END;--> statement-breakpoint
UPDATE "applications" a SET "assigned_to" = l."owner_id" FROM "leads" l WHERE a."lead_id" = l."id" AND a."assigned_to" IS NULL;--> statement-breakpoint
-- New permission for the roles already stored (built-in roles are only inserted when missing).
UPDATE "roles" SET "permissions" = "permissions" || '["applications.approve"]'::jsonb
WHERE "id" IN ('admin', 'manager', 'credit_analyst') AND NOT ("permissions" @> '["applications.approve"]'::jsonb) AND NOT ("permissions" @> '["*"]'::jsonb);