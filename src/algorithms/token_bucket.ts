import { RateLimiter, RateLimitResult } from '../types.ts';

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

/**
 * 1. Token Bucket Algorithm
 * - Tokens refilled at constant rate (tokensPerSec) up to capacity.
 * - Each request consumes 1 (or N) tokens.
 * - Permits traffic bursts up to capacity while bounding long-term average rate.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private capacity: number;
  private refillRatePerSec: number;
  private buckets: Map<string, BucketState> = new Map();

  constructor(capacity: number, refillRatePerSec: number) {
    this.capacity = capacity;
    this.refillRatePerSec = refillRatePerSec;
  }

  getAlgorithmName(): string {
    return 'Token Bucket';
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  consume(key: string, cost: number = 1): RateLimitResult {
    const now = Date.now();
    let state = this.buckets.get(key);

    if (!state) {
      state = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(key, state);
    } else {
      // Calculate refilled tokens
      const elapsedMs = Math.max(0, now - state.lastRefillMs);
      const tokensToAdd = (elapsedMs / 1000) * this.refillRatePerSec;
      state.tokens = Math.min(this.capacity, state.tokens + tokensToAdd);
      state.lastRefillMs = now;
    }

    if (state.tokens >= cost) {
      state.tokens -= cost;
      const resetTimeMs = now + Math.ceil(((this.capacity - state.tokens) / this.refillRatePerSec) * 1000);
      return {
        allowed: true,
        limit: this.capacity,
        remaining: Math.floor(state.tokens),
        resetTimeMs,
        algorithm: this.getAlgorithmName()
      };
    } else {
      const tokensNeeded = cost - state.tokens;
      const waitMs = Math.ceil((tokensNeeded / this.refillRatePerSec) * 1000);
      const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
      return {
        allowed: false,
        limit: this.capacity,
        remaining: 0,
        resetTimeMs: now + waitMs,
        retryAfterSec,
        algorithm: this.getAlgorithmName()
      };
    }
  }
}
