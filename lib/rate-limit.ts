import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const limiters = new Map<string, Ratelimit>();
let hasWarnedAboutLocalLimiter = false;
const localBuckets = new Map<string, { count: number; resetAt: number }>();

function getLimiter(limit: number, windowMs: number) {
  const key = `${limit}:${windowMs}`;
  const existingLimiter = limiters.get(key);
  if (existingLimiter) return existingLimiter;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured.");
    }

    return null;
  }

  const duration: `${number} m` | `${number} s` = windowMs % 60_000 === 0
    ? `${windowMs / 60_000} m`
    : `${windowMs / 1_000} s`;
  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(limit, duration),
    analytics: true,
    prefix: `expresshub:${key}`,
  });
  limiters.set(key, limiter);

  return limiter;
}

export async function limitApiRequests(
  identifier: string,
  scope: string,
  limit = 100,
  windowMs = 15 * 60 * 1000,
) {
  const sharedLimiter = getLimiter(limit, windowMs);

  if (sharedLimiter) {
    return sharedLimiter.limit(`${scope}:${identifier}`);
  }

  if (!hasWarnedAboutLocalLimiter) {
    console.warn("Upstash is not configured; using process-local development rate limiting.");
    hasWarnedAboutLocalLimiter = true;
  }

  const now = Date.now();
  const key = `${scope}:${identifier}`;
  let bucket = localBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    localBuckets.set(key, bucket);
  }

  bucket.count += 1;

  for (const [bucketKey, value] of localBuckets) {
    if (value.resetAt <= now) localBuckets.delete(bucketKey);
  }

  return {
    success: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    reset: bucket.resetAt,
    pending: Promise.resolve(),
  };
}

export function getRateLimitIdentifier(request: Request) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  return realIp || forwardedFor || "unknown";
}
