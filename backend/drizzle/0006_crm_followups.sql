ALTER TABLE "followups" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followups_customer_due_idx" ON "followups" USING btree ("customer_id","due_at");--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_target_check" CHECK ("followups"."lead_id" is not null or "followups"."customer_id" is not null);