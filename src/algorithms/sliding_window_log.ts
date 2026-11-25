import { RateLimiter, RateLimitResult } from '../types.ts';

/**
 * 4. Sliding Window Log Algorithm
 * - Retains timestamp of each accepted request in an in-memory or Redis sorted set.
 * - Prunes all timestamps older than (now - windowMs).
 * - Exact accuracy (0% boundary error), but O(N) memory complexity.
 */
export class SlidingWindowLogRateLimiter implements RateLimiter {
  private limit: number;
  private windowMs: number;
  private logs: Map<string, number[]> = new Map();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  getAlgorithmName(): string {
    return 'Sliding Window Log';
  }

  reset(key: string): void {
    this.logs.delete(key);
  }

  getLogLength(key: string): number {
    return this.logs.get(key)?.length || 0;
  }

  consume(key: string, cost: number = 1): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.logs.get(key);
    if (!timestamps) {
      timestamps = [];
      this.logs.set(key, timestamps);
    }

    // Prune expired timestamps
    while (timestamps.length > 0 && timestamps[0] <= windowStart) {
      timestamps.shift();
    }

    if (timestamps.length + cost <= this.limit) {
      for (let i = 0; i < cost; i++) {
        timestamps.push(now);
      }
      const resetTimeMs = timestamps[0] + this.windowMs;
      return {
        allowed: true,
        limit: this.limit,
        remaining: this.limit - timestamps.length,
        resetTimeMs,
        algorithm: this.getAlgorithmName(),
        metadata: { loggedTimestampsCount: timestamps.length }
      };
    } else {
      const earliestExpiry = timestamps[0] || now;
      const waitMs = Math.max(1, (earliestExpiry + this.windowMs) - now);
      const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetTimeMs: now + waitMs,
        retryAfterSec,
        algorithm: this.getAlgorithmName(),
        metadata: { loggedTimestampsCount: timestamps.length }
      };
    }
  }
}
