-- Super Admin role removed: Admin is now the top role. Move any Super Admin accounts to Admin, then drop the role row.
UPDATE "users" SET "role_id" = 'admin' WHERE "role_id" = 'super_admin';
--> statement-breakpoint
DELETE FROM "roles" WHERE "id" = 'super_admin';
