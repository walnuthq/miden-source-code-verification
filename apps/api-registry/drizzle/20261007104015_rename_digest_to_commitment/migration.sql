-- A package is now identified by miden-mast-package's
-- `Package::dependency_commitment()`, which binds its code, name, version, kind,
-- manifest and component metadata, instead of the MAST forest commitment
-- alone, and the columns are renamed to match.
-- Existing values are carried over as-is, not recomputed: rows written before
-- this change keep the identifier they were stored with (a pre-0.35 MAST root,
-- or a 0.35 `mast_forest_commitment()`), and re-verifying their sources records
-- a new package under its commitment.
ALTER TABLE "packages" RENAME COLUMN "digest" TO "commitment";--> statement-breakpoint
ALTER TABLE "verified_account_components" RENAME COLUMN "packageDigest" TO "packageCommitment";--> statement-breakpoint
ALTER TABLE "verified_notes_script" RENAME COLUMN "packageDigest" TO "packageCommitment";