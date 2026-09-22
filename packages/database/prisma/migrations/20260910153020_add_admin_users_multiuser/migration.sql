-- CreateEnum
CREATE TYPE "AdminTokenPurpose" AS ENUM ('RESET', 'INVITE');

-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "disabled_at" TIMESTAMPTZ(6),
ADD COLUMN     "invited_by_id" UUID,
ADD COLUMN     "name" TEXT;

-- CreateTable
CREATE TABLE "admin_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "AdminTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_tokens_token_hash_key" ON "admin_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "admin_tokens_user_id_idx" ON "admin_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_tokens" ADD CONSTRAINT "admin_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
