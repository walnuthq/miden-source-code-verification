CREATE TYPE "package_type" AS ENUM('account', 'note-script', 'transaction-script', 'authentication-component');--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) DEFAULT '' NOT NULL,
	"type" "package_type" DEFAULT 'account'::"package_type" NOT NULL,
	"files" jsonb DEFAULT '{}' NOT NULL,
	"masp" text DEFAULT '' NOT NULL,
	"digest" varchar(66) DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"manifest" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_account_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"verified_account_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"packageDigest" varchar(66) DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"network_id" text DEFAULT 'mtst' NOT NULL,
	"account_id" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"network_id" text DEFAULT 'mtst' NOT NULL,
	"note_id" varchar(66) NOT NULL,
	"package_id" uuid NOT NULL,
	"packageDigest" varchar(66) DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verified_account_components" ADD CONSTRAINT "verified_account_components_p04OCKr65MKG_fkey" FOREIGN KEY ("verified_account_id") REFERENCES "verified_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "verified_account_components" ADD CONSTRAINT "verified_account_components_package_id_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "verified_notes" ADD CONSTRAINT "verified_notes_package_id_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE;