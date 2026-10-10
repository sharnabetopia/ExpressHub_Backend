import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type Payment, type PaymentStatus } from "@prisma/client";
import type Stripe from "stripe";
import prisma from "@/lib/prisma";
import { requireRole, type AuthenticatedUser } from "@/lib/auth/require-user";
import { AppError } from "@/lib/http/errors";
import {
  amountInMinorUnits,
  checkoutConfiguration,
  stripeGateway,
  type PaymentGateway,
} from "@/lib/payments/stripe";
import type { ListPaymentsInput } from "@/validators/payment";

const safeSelect = {
  id: true,
  shipmentId: true,
  payerId: true,
  provider: true,
  amount: true,
  currency: true,
  status: true,
  paidAt: true,
  refundedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentSelect;
const missing = () =>
  new AppError(404, "Payment not found", "PAYMENT_NOT_FOUND");
const conflict = (message: string) =>
  new AppError(409, message, "PAYMENT_CONFLICT");
const mismatch = () =>
  new AppError(
    400,
    "Stripe payment details do not match the booking",
    "PAYMENT_MISMATCH",
  );

async function atomic<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(error.code)
      ) {
        if (attempt < 2) continue;
        throw conflict(
          "Concurrent payment change; retry with the same Idempotency-Key",
        );
      }
      throw error;
    }
  }
  throw new Error("Unreachable transaction retry state");
}

async function audit(
  tx: Prisma.TransactionClient,
  payment: Payment,
  action: string,
  details: Prisma.InputJsonObject,
  actorId?: string,
) {
  await tx.auditLog.create({
    data: {
      actorId,
      entityType: "PAYMENT",
      entityId: payment.id,
      paymentId: payment.id,
      shipmentId: payment.shipmentId,
      action,
      details,
    },
  });
}

export async function getPayment(actor: AuthenticatedUser, id: string) {
  if (actor.role === "COURIER")
    throw new AppError(403, "Payment access is not allowed", "FORBIDDEN");
  const payment = await prisma.payment.findFirst({
    where: { id, ...(actor.role === "ADMIN" ? {} : { payerId: actor.id }) },
    select: safeSelect,
  });
  if (!payment) throw missing();
  return payment;
}

export async function listMyPayments(
  actor: AuthenticatedUser,
  input: ListPaymentsInput,
) {
  requireRole(actor, "CUSTOMER", "ADMIN");
  const where = {
    payerId: actor.id,
    status: input.status,
    shipmentId: input.shipmentId,
  };
  const [payments, total] = await prisma.$transaction(
    [
      prisma.payment.findMany({
        where,
        select: safeSelect,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      prisma.payment.count({ where }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return {
    payments,
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
}

function checkSession(payment: Payment, session: Stripe.Checkout.Session) {
  if (
    session.mode !== "payment" ||
    session.client_reference_id !== payment.id ||
    session.metadata?.paymentId !== payment.id ||
    session.metadata?.shipmentId !== payment.shipmentId ||
    session.metadata?.payerId !== payment.payerId ||
    session.amount_total !==
      amountInMinorUnits(payment.amount, payment.currency) ||
    session.currency?.toUpperCase() !== payment.currency ||
    (payment.providerReference && payment.providerReference !== session.id)
  )
    throw mismatch();
  const request = payment.checkoutRequest as Record<string, unknown> | null;
  if (request && session.livemode !== request.livemode) throw mismatch();
}

export async function initiatePayment(
  actor: AuthenticatedUser,
  shipmentId: string,
  key: string,
  gateway?: PaymentGateway,
) {
  requireRole(actor, "CUSTOMER");
  const config = checkoutConfiguration();
  const idempotencyKey = createHash("sha256")
    .update(`${actor.id}:${key}`)
    .digest("hex");
  const payment = await atomic(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id: actor.id, isActive: true, deletedAt: null },
    });
    if (!current)
      throw new AppError(401, "Authentication required", "UNAUTHENTICATED");
    requireRole(current, "CUSTOMER");
    const existing = await tx.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.shipmentId !== shipmentId)
        throw conflict("Idempotency-Key was used for another shipment");
      return existing;
    }
    const shipment = await tx.shipment.findFirst({
      where: { id: shipmentId, customerId: actor.id, deletedAt: null },
    });
    if (!shipment)
      throw new AppError(404, "Shipment not found", "SHIPMENT_NOT_FOUND");
    if (
      shipment.status !== "CREATED" ||
      !["PENDING", "FAILED"].includes(shipment.paymentStatus)
    ) {
      throw conflict("Shipment is not eligible for payment");
    }
    if (
      await tx.payment.findFirst({
        where: { shipmentId, status: { not: "FAILED" } },
      })
    ) {
      throw conflict(
        "A payment already exists; retry its original Idempotency-Key",
      );
    }
    const amount = amountInMinorUnits(shipment.price, shipment.currency);
    const created = await tx.payment.create({
      data: {
        shipmentId,
        payerId: actor.id,
        provider: "STRIPE",
        idempotencyKey,
        amount: shipment.price,
        currency: shipment.currency,
      },
    });
    const metadata = { paymentId: created.id, shipmentId, payerId: actor.id };
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      allowed_payment_method_types: ["card"],
      client_reference_id: created.id,
      success_url: config.successUrl,
      cancel_url: config.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      metadata,
      payment_intent_data: { metadata },
      adaptive_pricing: { enabled: false },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: shipment.currency.toLowerCase(),
            unit_amount: amount,
            product_data: {
              name: `ExpressHub shipment ${shipment.trackingNumber}`,
            },
          },
        },
      ],
    };
    const saved = await tx.payment.update({
      where: { id: created.id },
      data: {
        checkoutRequest: {
          params: params as unknown as Prisma.InputJsonObject,
          livemode: config.live,
        },
      },
    });
    await tx.shipment.update({
      where: { id: shipmentId },
      data: { paymentStatus: "PENDING" },
    });
    await audit(
      tx,
      saved,
      "PAYMENT_INITIATED",
      { amount: saved.amount.toString(), currency: saved.currency },
      actor.id,
    );
    return saved;
  });
  if (payment.status !== "PENDING")
    return { payment: await getPayment(actor, payment.id), checkoutUrl: null };
  const provider = gateway ?? stripeGateway();
  if (
    !payment.providerReference &&
    Date.now() - payment.createdAt.getTime() > 23 * 60 * 60 * 1000
  ) {
    throw conflict(
      "Unresolved payment needs Stripe reconciliation; do not create another checkout",
    );
  }
  const stored = payment.checkoutRequest as {
    params: unknown;
    livemode: boolean;
  } | null;
  if (!stored || stored.livemode !== config.live)
    throw conflict(
      "Payment belongs to a different Stripe mode or requires reconciliation",
    );
  let session: Stripe.Checkout.Session;
  try {
    session = payment.providerReference
      ? await provider.retrieve(payment.providerReference)
      : await provider.create(
          stored.params as Stripe.Checkout.SessionCreateParams,
          `expresshub:${payment.id}`,
        );
  } catch {
    // An uncertain network result must never release the pending-payment guard.
    throw new AppError(
      502,
      "Stripe request failed; retry with the same Idempotency-Key",
      "PAYMENT_PROVIDER_UNAVAILABLE",
    );
  }
  checkSession(payment, session);
  await atomic(async (tx) => {
    const current = await tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    if (current.providerReference && current.providerReference !== session.id)
      throw mismatch();
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        providerReference: session.id,
        checkoutUrl: session.url,
        checkoutExpiresAt: new Date(session.expires_at * 1000),
      },
    });
  });
  // Initiation never confirms payment. Stripe's webhook is the settlement authority.
  const current = await getPayment(actor, payment.id);
  return {
    payment: current,
    checkoutUrl:
      current.status === "PENDING" && session.status === "open"
        ? session.url
        : null,
  };
}

const sessionEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const refundEvents = new Set([
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
]);
const objectId = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;

async function observation(
  payment: Payment,
  session: Stripe.Checkout.Session,
  gateway: PaymentGateway,
  eventType: string,
) {
  checkSession(payment, session);
  let status: PaymentStatus = "PENDING";
  const intentId = objectId(session.payment_intent);
  if (session.payment_status === "paid") {
    if (!intentId) throw mismatch();
    const intent = await gateway.intent(intentId);
    if (
      intent.id !== intentId ||
      intent.status !== "succeeded" ||
      intent.amount_received !==
        amountInMinorUnits(payment.amount, payment.currency) ||
      intent.amount !== amountInMinorUnits(payment.amount, payment.currency) ||
      intent.currency.toUpperCase() !== payment.currency ||
      intent.metadata.paymentId !== payment.id ||
      intent.metadata.shipmentId !== payment.shipmentId ||
      intent.metadata.payerId !== payment.payerId ||
      intent.livemode !== session.livemode ||
      (payment.providerIntentId && payment.providerIntentId !== intentId)
    )
      throw mismatch();
    const refunds = await gateway.refunds(intentId);
    let refunded = 0;
    let pending = false;
    for (const refund of refunds) {
      if (
        objectId(refund.payment_intent) !== intentId ||
        refund.currency.toUpperCase() !== payment.currency
      )
        throw mismatch();
      if (refund.status === "succeeded") refunded += refund.amount;
      if (["pending", "requires_action"].includes(refund.status ?? ""))
        pending = true;
    }
    if (refunded > intent.amount_received) throw mismatch();
    status =
      refunded === intent.amount_received
        ? "REFUNDED"
        : refunded > 0 || pending
          ? "REFUND_PENDING"
          : "PAID";
  } else if (
    session.status === "expired" ||
    eventType === "checkout.session.async_payment_failed"
  ) {
    status = "FAILED";
  }
  return { status, intentId };
}

export async function processStripeEvent(
  event: Stripe.Event,
  payloadHash: string,
  gateway?: PaymentGateway,
) {
  const key = {
    provider_providerEventId: {
      provider: "STRIPE" as const,
      providerEventId: event.id,
    },
  };
  const receipt = await prisma.paymentWebhookEvent.upsert({
    where: key,
    create: {
      provider: "STRIPE",
      providerEventId: event.id,
      eventType: event.type,
      payloadHash,
    },
    update: {},
  });
  if (receipt.payloadHash !== payloadHash)
    throw new AppError(
      400,
      "Webhook ID was reused with different content",
      "WEBHOOK_CONFLICT",
    );
  if (["PROCESSED", "IGNORED"].includes(receipt.processingStatus))
    return { received: true, duplicate: true };
  try {
    const provider = gateway ?? stripeGateway();
    let paymentId: string | undefined;
    let session: Stripe.Checkout.Session | undefined;
    if (sessionEvents.has(event.type)) {
      session = await provider.retrieve(
        (event.data.object as Stripe.Checkout.Session).id,
      );
      paymentId = session.metadata?.paymentId;
    } else if (refundEvents.has(event.type)) {
      const intentId = objectId(
        (event.data.object as Stripe.Charge | Stripe.Refund).payment_intent,
      );
      if (intentId)
        paymentId = (await provider.intent(intentId)).metadata.paymentId;
    }
    const payment = paymentId
      ? await prisma.payment.findUnique({ where: { id: paymentId } })
      : null;
    if (!payment || payment.provider !== "STRIPE") {
      await prisma.paymentWebhookEvent.update({
        where: key,
        data: { processingStatus: "IGNORED", processedAt: new Date() },
      });
      return { received: true, ignored: true };
    }
    if (!session) {
      if (!payment.providerReference)
        throw new AppError(
          503,
          "Checkout reference is awaiting reconciliation",
          "PAYMENT_RETRY",
        );
      session = await provider.retrieve(payment.providerReference);
    }
    const observed = await observation(payment, session, provider, event.type);
    await atomic(async (tx) => {
      const savedReceipt = await tx.paymentWebhookEvent.findUniqueOrThrow({
        where: key,
      });
      if (savedReceipt.processingStatus === "PROCESSED") return;
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { shipment: true },
      });
      // Provider reads happen outside the transaction. A competing handler may
      // have committed a newer observation while those reads were in flight.
      if (current.updatedAt.getTime() !== payment.updatedAt.getTime()) {
        throw new AppError(
          503,
          "Payment changed during verification; retry this event",
          "PAYMENT_RETRY",
        );
      }
      if (
        current.providerReference &&
        current.providerReference !== session!.id
      )
        throw mismatch();
      if (
        current.providerIntentId &&
        observed.intentId &&
        current.providerIntentId !== observed.intentId
      )
        throw mismatch();
      if (
        !current.amount.equals(current.shipment.price) ||
        current.currency !== current.shipment.currency ||
        current.payerId !== current.shipment.customerId
      )
        throw mismatch();
      let status = observed.status;
      // Provider events are unordered. Never regress an accepted payment/refund.
      if (
        current.status === "REFUNDED" ||
        (current.status === "REFUND_PENDING" &&
          ["PENDING", "FAILED"].includes(status)) ||
        (current.status === "PAID" && ["PENDING", "FAILED"].includes(status)) ||
        (current.status === "FAILED" && status === "PENDING")
      )
        status = current.status;
      if (
        status !== "FAILED" &&
        (await tx.payment.findFirst({
          where: {
            shipmentId: current.shipmentId,
            id: { not: current.id },
            status: { not: "FAILED" },
          },
        }))
      ) {
        throw conflict(
          "Shipment already has another active or confirmed payment",
        );
      }
      const updated = await tx.payment.update({
        where: { id: current.id },
        data: {
          status,
          providerReference: session!.id,
          providerIntentId: observed.intentId,
          ...(["PAID", "REFUND_PENDING", "REFUNDED"].includes(status) &&
          !current.paidAt
            ? { paidAt: new Date() }
            : {}),
          ...(status === "REFUNDED" && !current.refundedAt
            ? { refundedAt: new Date() }
            : {}),
        },
      });
      if (current.status !== status) {
        // A late failure for an older attempt cannot overwrite a newer attempt's state.
        const other = await tx.payment.findFirst({
          where: {
            shipmentId: current.shipmentId,
            id: { not: current.id },
            status: { not: "FAILED" },
          },
        });
        if (!other)
          await tx.shipment.update({
            where: { id: current.shipmentId },
            data: { paymentStatus: status },
          });
        await audit(tx, updated, "PAYMENT_STATUS_UPDATED", {
          before: current.status,
          after: status,
          providerEventId: event.id,
        });
      }
      await tx.paymentWebhookEvent.update({
        where: key,
        data: {
          paymentId: current.id,
          processingStatus: "PROCESSED",
          processedAt: new Date(),
        },
      });
    });
    return { received: true };
  } catch (error) {
    // Keep a retryable receipt without logging provider payloads or credentials.
    await prisma.paymentWebhookEvent.updateMany({
      where: {
        id: receipt.id,
        processingStatus: { notIn: ["PROCESSED", "IGNORED"] },
      },
      data: { processingStatus: "FAILED" },
    });
    if (error instanceof AppError) throw error;
    throw new AppError(
      503,
      "Payment processing failed; Stripe should retry this event",
      "PAYMENT_RETRY",
    );
  }
}
