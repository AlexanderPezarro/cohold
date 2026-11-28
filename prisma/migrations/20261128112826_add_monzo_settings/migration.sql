-- CreateTable
CREATE TABLE "monzo_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "client_id" TEXT NOT NULL,
    "client_secret_encrypted" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "webhook_base_url" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
