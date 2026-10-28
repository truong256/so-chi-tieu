/**
 * backend/src/services/financial-cache.service.ts
 * ================================================
 * High-performance, In-Memory, Per-User Cache for Financial Context & System Knowledge.
 *
 * Security & Isolation Rules:
 * 1. ZERO Shared Cache: Every cache entry is strictly partitioned by `userId`.
 * 2. Short TTL: Financial context expires after 30 seconds by default to ensure freshness.
 * 3. Instant Mutation Invalidation: When transactions, wallets, budgets, or goals are mutated,
 *    `invalidateUserFinancialCache(userId)` clears the stale cache entry immediately.
 * 4. Zero PII Leakage: Stored purely in server memory; never written to public logs.
 */

import type { ServerFinancialContext } from "./financial-context.service.ts";

interface UserFinancialCacheEntry {
  context: ServerFinancialContext;
  expiresAt: number;
}

// In-memory cache map keyed strictly by userId
const userFinancialCache = new Map<string, UserFinancialCacheEntry>();

const DEFAULT_CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Retrieve cached financial context for a specific user if still valid.
 */
export function getCachedUserFinancialContext(userId: string): ServerFinancialContext | null {
  if (!userId) return null;
  const entry = userFinancialCache.get(userId);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    userFinancialCache.delete(userId);
    return null;
  }

  return entry.context;
}

/**
 * Store computed financial context in memory for a specific user.
 */
export function setCachedUserFinancialContext(
  userId: string,
  context: ServerFinancialContext,
  ttlMs = DEFAULT_CACHE_TTL_MS,
): void {
  if (!userId || !context) return;
  userFinancialCache.set(userId, {
    context,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Invalidate financial cache for a user (called after transaction / wallet / budget mutation).
 */
export function invalidateUserFinancialCache(userId?: string): void {
  if (userId) {
    userFinancialCache.delete(userId);
  } else {
    userFinancialCache.clear();
  }
}

/**
 * Get cache stats for observability.
 */
export function getFinancialCacheStats(): { size: number; activeUsers: string[] } {
  const now = Date.now();
  const activeUsers: string[] = [];
  for (const [userId, entry] of userFinancialCache.entries()) {
    if (entry.expiresAt > now) {
      activeUsers.push(userId);
    } else {
      userFinancialCache.delete(userId);
    }
  }
  return {
    size: userFinancialCache.size,
    activeUsers,
  };
}

