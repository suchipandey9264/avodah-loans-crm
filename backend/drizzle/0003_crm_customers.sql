CREATE SEQUENCE "public"."customer_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 5001 CACHE 1;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"application_id" uuid,
	"doc_type" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"note" text,
	"uploaded_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_type_check" CHECK ("documents"."doc_type" in ('pan', 'aadhaar', 'photo', 'address_proof', 'bank_statement', 'salary_slip', 'itr', 'form16', 'property', 'other')),
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('uploaded', 'verified', 'rejected')),
	CONSTRAINT "documents_size_check" CHECK ("documents"."size_bytes" > 0 and "documents"."size_bytes" <= 5242880)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "customer_code" text DEFAULT ('C-' || nextval('customer_code_seq'));--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kyc_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credit_score" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credit_score_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "relationship_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_customer_idx" ON "documents" USING btree ("customer_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_relationship_manager_id_users_id_fk" FOREIGN KEY ("relationship_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_rm_idx" ON "users" USING btree ("relationship_manager_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_customer_code_unique" UNIQUE("customer_code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_kyc_status_check" CHECK ("users"."kyc_status" in ('pending', 'verified', 're_kyc'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_credit_score_check" CHECK ("users"."credit_score" is null or "users"."credit_score" between 300 and 900);