-- A package verified between the backfill and this deploy whose WIT couldn't be
-- parsed was stored with null; `{}` is what the backfill stored for those.
UPDATE "packages" SET "parameters" = '{}'::jsonb WHERE "parameters" IS NULL;--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "parameters" SET NOT NULL;