-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('DISCONNECTED', 'QR_PENDING', 'CONNECTED', 'RECONNECTING', 'BANNED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AttemptResult" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AccountEventType" AS ENUM ('CONNECTED', 'DISCONNECTED', 'QR_GENERATED', 'BAN_DETECTED', 'RECONNECT_ATTEMPT', 'MANUALLY_DISABLED', 'LIMIT_REACHED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "phone_number" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "session_path" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "daily_limit" INTEGER NOT NULL DEFAULT 300,
    "hourly_limit" INTEGER NOT NULL DEFAULT 40,
    "connected_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "banned_at" TIMESTAMPTZ(6),
    "warmup_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "webhook_url" TEXT,
    "webhook_secret" TEXT,
    "webhook_events" TEXT[],
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "daily_quota" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- ⚠️ PARTICIONADA POR MÊS (doc 02 §2.4 e §3). A PK inclui a chave de partição.
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "api_token_id" UUID,
    "account_id" UUID,
    "direction" "MessageDirection" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "to_number" TEXT NOT NULL,
    "from_number" TEXT,
    "content" TEXT NOT NULL,
    "external_id" TEXT,
    "whatsapp_message_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" TIMESTAMPTZ(6),
    "queued_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- Função: cria a partição mensal para uma data-alvo, se ainda não existir.
-- Idempotente. Usada pela migration (partições iniciais) e pelo job de
-- manutenção da Fase 7, que deve rodar com 2 meses de antecedência (doc 02 §3).
CREATE OR REPLACE FUNCTION create_messages_partition(target_month DATE)
RETURNS void AS $$
DECLARE
    start_date DATE := date_trunc('month', target_month)::date;
    end_date   DATE := (date_trunc('month', target_month) + INTERVAL '1 month')::date;
    part_name  TEXT := 'messages_' || to_char(start_date, 'YYYY_MM');
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = part_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF messages FOR VALUES FROM (%L) TO (%L)',
            part_name, start_date, end_date
        );
        -- Índice único parcial de idempotência, POR PARTIÇÃO (doc 02 §2.4).
        -- Em tabela particionada, um índice único global precisaria conter a
        -- chave de partição; criá-lo por partição preserva a semântica desejada
        -- (project_id + external_id únicos dentro do mês).
        EXECUTE format(
            'CREATE UNIQUE INDEX %I ON %I ("project_id", "external_id") WHERE "external_id" IS NOT NULL',
            part_name || '_project_external_uniq', part_name
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Partições iniciais: mês anterior (dados de teste), atual e os 2 próximos.
SELECT create_messages_partition((date_trunc('month', now()) - INTERVAL '1 month')::date);
SELECT create_messages_partition(date_trunc('month', now())::date);
SELECT create_messages_partition((date_trunc('month', now()) + INTERVAL '1 month')::date);
SELECT create_messages_partition((date_trunc('month', now()) + INTERVAL '2 month')::date);

-- CreateTable
CREATE TABLE "message_attempts" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "result" "AttemptResult" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_events" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" "AccountEventType" NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "message_id" UUID,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "http_status" INTEGER,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "project_id" UUID,
    "account_id" UUID,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "read_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "received_count" INTEGER NOT NULL DEFAULT 0,
    "error_breakdown" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_status_is_enabled_idx" ON "accounts"("status", "is_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_project_id_idx" ON "api_tokens"("project_id");

-- CreateIndex
CREATE INDEX "messages_project_id_created_at_idx" ON "messages"("project_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_account_id_created_at_idx" ON "messages"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_to_number_created_at_idx" ON "messages"("to_number", "created_at" DESC);

-- CreateIndex (manual — Prisma não gera índice parcial com IN)
-- Acelera o polling da fila: mensagens ainda não finalizadas (doc 02 §2.4).
CREATE INDEX "messages_status_pending_idx" ON "messages"("status")
    WHERE "status" IN ('QUEUED', 'SENDING');

-- CreateIndex
CREATE INDEX "message_attempts_message_id_idx" ON "message_attempts"("message_id");

-- CreateIndex
CREATE INDEX "account_events_account_id_created_at_idx" ON "account_events"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_project_id_created_at_idx" ON "webhook_deliveries"("project_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_date_project_id_account_id_key" ON "daily_stats"("date", "project_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_api_token_id_fkey" FOREIGN KEY ("api_token_id") REFERENCES "api_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_events" ADD CONSTRAINT "account_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
