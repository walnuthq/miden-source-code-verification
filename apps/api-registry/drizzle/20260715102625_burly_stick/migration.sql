ALTER TABLE "packages" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "package_type";--> statement-breakpoint
CREATE TYPE "package_type" AS ENUM('library', 'account-component', 'authentication-component', 'note', 'tx-script');--> statement-breakpoint
UPDATE "packages" SET "type" = 'account-component' WHERE "type" = 'account';--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "type" SET DATA TYPE "package_type" USING "type"::"package_type";--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "type" SET DEFAULT 'account-component'::"package_type";