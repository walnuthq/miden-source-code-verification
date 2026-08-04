-- Records are keyed on (network_id, code) / (network_id, script) from here on: a
-- code root is only meaningful within the network it was read from. Existing
-- rows predate the distinction and were all recorded against testnet, so they
-- are backfilled with 'mtst'. The default is then dropped so future inserts
-- must supply a network — it exists only to make the column addable on tables
-- that already hold data.
ALTER TABLE "verified_accounts_code" ADD COLUMN "network_id" varchar(16) DEFAULT 'mtst' NOT NULL;--> statement-breakpoint
ALTER TABLE "verified_accounts_code" ALTER COLUMN "network_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "verified_notes_script" ADD COLUMN "network_id" varchar(16) DEFAULT 'mtst' NOT NULL;--> statement-breakpoint
ALTER TABLE "verified_notes_script" ALTER COLUMN "network_id" DROP DEFAULT;
