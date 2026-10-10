import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Approved flat delivery rate, covering the shipment validator's weight range.
const pricing = {
  name: "Standard flat delivery",
  minWeightKg: "0.001",
  maxWeightKg: "9999999.999",
  baseFee: "100.00",
  additionalPerKgFee: "0.00",
  currency: "BDT",
  isActive: true,
};

const prisma = new PrismaClient();
try {
  const result = await prisma.$transaction(async (tx) => {
    // Serialize repeated/concurrent setup commands without overwriting custom rates.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(742398104252::bigint)::text`;
    const now = new Date();
    const rules = await tx.pricingRule.findMany({
      where: {
        isActive: true,
        minWeightKg: { lte: pricing.maxWeightKg },
        maxWeightKg: { gte: pricing.minWeightKg },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
    });
    if (rules.length) {
      const rule = rules[0];
      if (
        rules.length === 1 &&
        rule.minWeightKg.equals(pricing.minWeightKg) &&
        rule.maxWeightKg.equals(pricing.maxWeightKg) &&
        rule.baseFee.equals(pricing.baseFee) &&
        rule.additionalPerKgFee.equals(pricing.additionalPerKgFee) &&
        rule.currency === pricing.currency &&
        rule.effectiveFrom <= now && rule.effectiveTo === null
      ) return "Flat delivery pricing already exists; no changes made.";
      throw new Error("Active or scheduled pricing overlaps this range. Review existing rules before applying flat pricing.");
    }
    const rule = await tx.pricingRule.create({
      data: { ...pricing, effectiveFrom: now },
    });
    await tx.auditLog.create({
      data: {
        entityType: "PRICING_RULE",
        entityId: rule.id,
        action: "PRICING_RULE_CREATED",
        details: { source: "prisma:seed:pricing", ...pricing },
      },
    });
    return "Created flat delivery pricing: 100 BDT per shipment, no additional weight fee.";
  });
  console.info(result);
} catch (error) {
  // Prisma connection errors may contain deployment details; only expose safe setup errors.
  console.error(error instanceof Error && error.message.startsWith("Active or scheduled")
    ? error.message : "Pricing setup failed. Check database connectivity and applied migrations.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
