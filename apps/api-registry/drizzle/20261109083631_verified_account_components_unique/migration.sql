-- One component per package in an account code. Rows that share the pair came
-- from concurrent verifications of the same package into an already verified
-- account code, before the index: both read no component, then both inserted.
-- The oldest is kept and the others dropped; nothing references a component.
DELETE FROM "verified_account_components" c
USING (
  SELECT DISTINCT ON ("verified_account_id", "packageCommitment") "id", "verified_account_id", "packageCommitment"
  FROM "verified_account_components"
  ORDER BY "verified_account_id", "packageCommitment", "created_at", "id"
) k
WHERE k."verified_account_id" = c."verified_account_id"
  AND k."packageCommitment" = c."packageCommitment"
  AND c."id" <> k."id";--> statement-breakpoint
CREATE UNIQUE INDEX "verified_account_components_account_commitment_idx" ON "verified_account_components" ("verified_account_id","packageCommitment");
