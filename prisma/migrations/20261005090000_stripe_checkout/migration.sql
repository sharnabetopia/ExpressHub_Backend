ALTER TABLE "payments"
  ADD COLUMN "providerIntentId" TEXT,
  ADD COLUMN "checkoutRequest" JSONB,
  ADD COLUMN "checkoutUrl" TEXT,
  ADD COLUMN "checkoutExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "payments_providerIntentId_key" ON "payments"("providerIntentId");

-- One live checkout or accepted charge per shipment. Failed attempts remain retryable.
-- Prisma 5 cannot express this partial unique index; retain it in future migrations.
CREATE UNIQUE INDEX "payments_one_active_per_shipment"
ON "payments"("shipmentId")
WHERE "status" IN ('PENDING', 'PAID', 'REFUND_PENDING', 'REFUNDED');
