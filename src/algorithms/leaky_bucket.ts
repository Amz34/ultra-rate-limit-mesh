import { RateLimiter, RateLimitResult } from '../types.ts';

interface LeakyBucketState {
  waterLevel: number; // Current queued items
  lastLeakMs: number;
}

/**
 * 3. Leaky Bucket Algorithm
 * - Queue with capacity B. Requests enter queue and drip out at fixed leakRatePerSec.
 * - Overflow requests dropped or rejected when waterLevel + cost > capacity.
 * - Smooths traffic spikes into an invariant, perfectly steady stream.
 */
export class LeakyBucketRateLimiter implements RateLimiter {
  private capacity: number;
  private leakRatePerSec: number;
  private buckets: Map<string, LeakyBucketState> = new Map();

  constructor(capacity: number, leakRatePerSec: number) {
    this.capacity = capacity;
    this.leakRatePerSec = leakRatePerSec;
  }

  getAlgorithmName(): string {
    return 'Leaky Bucket';
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  consume(key: string, cost: number = 1): RateLimitResult {
    const now = Date.now();
    let state = this.buckets.get(key);

    if (!state) {
      state = { waterLevel: 0, lastLeakMs: now };
      this.buckets.set(key, state);
    } else {
      // Leak water based on elapsed time
      const elapsedMs = Math.max(0, now - state.lastLeakMs);
      const leaked = (elapsedMs / 1000) * this.leakRatePerSec;
      state.waterLevel = Math.max(0, state.waterLevel - leaked);
      state.lastLeakMs = now;
    }

    if (state.waterLevel + cost <= this.capacity) {
      state.waterLevel += cost;
      const drainTimeMs = (state.waterLevel / this.leakRatePerSec) * 1000;
      return {
        allowed: true,
        limit: this.capacity,
        remaining: Math.max(0, Math.floor(this.capacity - state.waterLevel)),
        resetTimeMs: now + Math.ceil(drainTimeMs),
        algorithm: this.getAlgorithmName(),
        metadata: { currentQueueDepth: state.waterLevel }
      };
    } else {
      const overflow = (state.waterLevel + cost) - this.capacity;
      const waitMs = Math.ceil((overflow / this.leakRatePerSec) * 1000);
      const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
      return {
        allowed: false,
        limit: this.capacity,
        remaining: 0,
        resetTimeMs: now + waitMs,
        retryAfterSec,
        algorithm: this.getAlgorithmName(),
        metadata: { currentQueueDepth: state.waterLevel }
      };
    }
  }
}
