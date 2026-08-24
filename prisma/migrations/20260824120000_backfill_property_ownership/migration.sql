-- Backfill PropertyOwnership rows for properties that have none.
--
-- REST endpoints are being changed to scope Property (and related Lease/Tenant/
-- Event/Document) access by PropertyOwnership, mirroring the GraphQL API. Some
-- properties in existing databases were created before ownership rows existed
-- (the old seed script, and the old REST POST /api/properties handler, never
-- created one), so without this backfill those properties would become
-- invisible to every non-admin user the moment scoping goes live.
--
-- Rule: any property with zero ownership rows is assigned 100% ownership to the
-- earliest-created ADMIN user. This is non-destructive: ADMIN users already
-- bypass ownership scoping and can see every property regardless, so granting
-- them an explicit ownership record does not change what they can see - it just
-- gives previously owner-less properties a valid owner of record so non-admin
-- scoping doesn't strand them. If no ADMIN user exists yet, this backfill is a
-- no-op (properties are left owner-less, i.e. unchanged) and is safe to run
-- again later once one does.
--
-- Idempotent: only properties currently lacking any ownership row are touched,
-- so re-running this migration (or applying it to a database that already has
-- ownership rows for some/all properties) inserts nothing extra.
INSERT INTO "property_ownership" ("id", "user_id", "property_id", "ownership_percentage", "created_at", "updated_at")
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ) AS id,
  admin_user."id" AS user_id,
  p."id" AS property_id,
  100 AS ownership_percentage,
  CURRENT_TIMESTAMP AS created_at,
  CURRENT_TIMESTAMP AS updated_at
FROM "properties" p
CROSS JOIN (
  SELECT "id" FROM "users" WHERE "role" = 'ADMIN' ORDER BY "created_at" ASC LIMIT 1
) AS admin_user
WHERE NOT EXISTS (
  SELECT 1 FROM "property_ownership" po WHERE po."property_id" = p."id"
);
