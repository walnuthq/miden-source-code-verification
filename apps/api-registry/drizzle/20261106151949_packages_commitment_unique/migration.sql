-- One row per package. Rows that share a commitment came from concurrent
-- verifications of the same new package, before the index: their records are
-- moved to one of them, the one with a debug build, else the oldest, and the
-- others are dropped. The artifact, keyed by commitment, is the same for all.
CREATE TEMP TABLE "kept_packages" AS
SELECT DISTINCT ON ("commitment") "id", "commitment"
FROM "packages"
ORDER BY "commitment", ("debug_commitment" IS NULL), "created_at", "id";--> statement-breakpoint
UPDATE "verified_account_components" c
SET "package_id" = k."id"
FROM "packages" p
JOIN "kept_packages" k ON k."commitment" = p."commitment"
WHERE c."package_id" = p."id" AND p."id" <> k."id";--> statement-breakpoint
UPDATE "verified_notes_script" n
SET "package_id" = k."id"
FROM "packages" p
JOIN "kept_packages" k ON k."commitment" = p."commitment"
WHERE n."package_id" = p."id" AND p."id" <> k."id";--> statement-breakpoint
DELETE FROM "packages" p
USING "kept_packages" k
WHERE k."commitment" = p."commitment" AND p."id" <> k."id";--> statement-breakpoint
DROP TABLE "kept_packages";--> statement-breakpoint
CREATE UNIQUE INDEX "packages_commitment_idx" ON "packages" ("commitment");
