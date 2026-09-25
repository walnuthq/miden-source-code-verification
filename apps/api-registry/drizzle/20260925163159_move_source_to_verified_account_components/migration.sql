-- `source` moves from the account code to each of its verified components: the
-- code row is written once, when its first component is verified, so later
-- components verified from another client had their source dropped. Existing
-- components inherit their account's source, the only one on record — exact for
-- each account's first component, a best guess for the rest.
ALTER TABLE "verified_account_components" ADD COLUMN "source" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
UPDATE "verified_account_components" SET "source" = "verified_accounts_code"."source" FROM "verified_accounts_code" WHERE "verified_account_components"."verified_account_id" = "verified_accounts_code"."id";--> statement-breakpoint
ALTER TABLE "verified_accounts_code" DROP COLUMN "source";--> statement-breakpoint
-- `package_type` becomes miden-mast-package's `TargetType`, by its canonical
-- names. Of the old values, 'authentication-component' has no counterpart (an
-- auth component is an account component) and 'tx-script' is only an alias of
-- 'transaction-script', so both are mapped while the column is text.
ALTER TABLE "packages" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "package_type";--> statement-breakpoint
CREATE TYPE "package_type" AS ENUM('library', 'executable', 'kernel', 'account-component', 'note', 'transaction-script');--> statement-breakpoint
UPDATE "packages" SET "type" = 'account-component' WHERE "type" = 'authentication-component';--> statement-breakpoint
UPDATE "packages" SET "type" = 'transaction-script' WHERE "type" = 'tx-script';--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "type" SET DATA TYPE "package_type" USING "type"::"package_type";--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "type" SET DEFAULT 'account-component'::"package_type";
