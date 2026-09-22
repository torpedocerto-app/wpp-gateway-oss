-- AlterEnum
ALTER TYPE "AccountEventType" ADD VALUE 'OPT_OUT';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "media_file_name" TEXT,
ADD COLUMN     "media_mime_type" TEXT;

-- CreateTable
CREATE TABLE "suppressed_contacts" (
    "id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'opt_out_keyword',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppressed_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppressed_contacts_phone_number_key" ON "suppressed_contacts"("phone_number");
