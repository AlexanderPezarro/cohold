/*
  Warnings:

  - You are about to drop the column `status` on the `leases` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `properties` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `tenants` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_leases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "property_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME,
    "monthly_rent" REAL NOT NULL,
    "security_deposit_amount" REAL NOT NULL,
    "security_deposit_paid_date" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "leases_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "leases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_leases" ("created_at", "end_date", "id", "monthly_rent", "property_id", "security_deposit_amount", "security_deposit_paid_date", "start_date", "tenant_id", "updated_at") SELECT "created_at", "end_date", "id", "monthly_rent", "property_id", "security_deposit_amount", "security_deposit_paid_date", "start_date", "tenant_id", "updated_at" FROM "leases";
DROP TABLE "leases";
ALTER TABLE "new_leases" RENAME TO "leases";
CREATE TABLE "new_properties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "property_type" TEXT NOT NULL,
    "purchase_date" DATETIME,
    "purchase_price" REAL,
    "listing_state" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
-- Backfill listing_state from the old status column before it is dropped:
-- 'Under Maintenance' -> 'UNDER_MAINTENANCE', 'For Sale' -> 'FOR_SALE', anything else -> NULL.
INSERT INTO "new_properties" ("city", "county", "created_at", "id", "name", "notes", "postcode", "property_type", "purchase_date", "purchase_price", "listing_state", "street", "updated_at")
SELECT "city", "county", "created_at", "id", "name", "notes", "postcode", "property_type", "purchase_date", "purchase_price",
  CASE "status"
    WHEN 'Under Maintenance' THEN 'UNDER_MAINTENANCE'
    WHEN 'For Sale' THEN 'FOR_SALE'
    ELSE NULL
  END,
  "street", "updated_at" FROM "properties";
DROP TABLE "properties";
ALTER TABLE "new_properties" RENAME TO "properties";
CREATE TABLE "new_tenants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_tenants" ("created_at", "email", "emergency_contact_name", "emergency_contact_phone", "first_name", "id", "last_name", "notes", "phone", "updated_at") SELECT "created_at", "email", "emergency_contact_name", "emergency_contact_phone", "first_name", "id", "last_name", "notes", "phone", "updated_at" FROM "tenants";
DROP TABLE "tenants";
ALTER TABLE "new_tenants" RENAME TO "tenants";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
