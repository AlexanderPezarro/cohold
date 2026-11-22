-- AlterTable
ALTER TABLE "users" ADD COLUMN "onboarding_dismissed_at" DATETIME;

-- CreateTable
CREATE TABLE "onboarding_step_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "onboarding_step_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "onboarding_step_overrides_user_id_idx" ON "onboarding_step_overrides"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_step_overrides_user_id_step_id_key" ON "onboarding_step_overrides"("user_id", "step_id");
