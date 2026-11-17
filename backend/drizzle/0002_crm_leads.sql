CREATE SEQUENCE "public"."lead_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE TABLE "followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"type" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"assigned_to" uuid,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followups_type_check" CHECK ("followups"."type" in ('call', 'whatsapp', 'meeting', 'visit', 'email')),
	CONSTRAINT "followups_status_check" CHECK ("followups"."status" in ('pending', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"body" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_kind_check";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ref" text DEFAULT ('L-' || nextval('lead_ref_seq')) NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source" text DEFAULT 'website' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "temperature" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "loan_type" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "loan_amount" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "annual_income" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "employment" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "converted_by" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followups_lead_due_idx" ON "followups" USING btree ("lead_id","due_at");--> statement-breakpoint
CREATE INDEX "followups_assigned_due_idx" ON "followups" USING btree ("assigned_to","status","due_at");--> statement-breakpoint
CREATE INDEX "timeline_entity_created_idx" ON "timeline_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_by_users_id_fk" FOREIGN KEY ("converted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_status_created_idx" ON "leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_lead_id_unique" UNIQUE("lead_id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_ref_unique" UNIQUE("ref");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_check" CHECK ("leads"."status" in ('new', 'contacted', 'interested', 'docs_pending', 'qualified', 'converted', 'lost'));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_check" CHECK ("leads"."source" in ('website', 'walk_in', 'call_centre', 'referral', 'partner_dsa', 'facebook_ads', 'google_ads', 'other'));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_temperature_check" CHECK ("leads"."temperature" is null or "leads"."temperature" in ('hot', 'warm', 'cold'));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_kind_check" CHECK ("leads"."kind" in ('callback', 'credit-report', 'crm'));--> statement-breakpoint
-- Website leads already marked handled start the pipeline as "contacted" (handled = status is not "new").
UPDATE "leads" SET "status" = 'contacted' WHERE "handled" = true;
