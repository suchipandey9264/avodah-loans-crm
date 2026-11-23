ALTER TABLE "leads" DROP CONSTRAINT "leads_source_check";--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_check" CHECK ("leads"."source" in ('website', 'website_callback', 'website_credit_report', 'walk_in', 'call_centre', 'referral', 'partner_dsa', 'facebook_ads', 'google_ads', 'other'));--> statement-breakpoint
-- The website's forms insert leads without a source (default 'website'); record which form it was.
UPDATE "leads" SET "source" = 'website_' || replace("kind", '-', '_') WHERE "source" = 'website' AND "kind" IN ('callback', 'credit-report');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION leads_website_source() RETURNS trigger AS $$
BEGIN
  IF NEW.source = 'website' AND NEW.kind IN ('callback', 'credit-report') THEN
    NEW.source := 'website_' || replace(NEW.kind, '-', '_');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER leads_website_source BEFORE INSERT ON "leads" FOR EACH ROW EXECUTE FUNCTION leads_website_source();
