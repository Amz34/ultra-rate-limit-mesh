import { RateLimiter, RateLimitResult } from '../types.ts';

interface WindowState {
  count: number;
  windowIndex: number;
}

/**
 * 2. Fixed Window Counter Algorithm
 * - Divides time into discrete fixed windows (windowMs).
 * - Counts requests within the active window.
 * - Simple & O(1) memory, but allows 2x burst boundary spikes (e.g. 100% limit in last 100ms of W1 + 100% in first 100ms of W2).
 */
export class FixedWindowRateLimiter implements RateLimiter {
  private limit: number;
  private windowMs: number;
  private windows: Map<string, WindowState> = new Map();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  getAlgorithmName(): string {
    return 'Fixed Window Counter';
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  consume(key: string, cost: number = 1): RateLimitResult {
    const now = Date.now();
    const currentWindowIndex = Math.floor(now / this.windowMs);
    const windowStartMs = currentWindowIndex * this.windowMs;
    const resetTimeMs = windowStartMs + this.windowMs;

    let state = this.windows.get(key);

    if (!state || state.windowIndex !== currentWindowIndex) {
      state = { count: 0, windowIndex: currentWindowIndex };
      this.windows.set(key, state);
    }

    if (state.count + cost <= this.limit) {
      state.count += cost;
      return {
        allowed: true,
        limit: this.limit,
        remaining: this.limit - state.count,
        resetTimeMs,
        algorithm: this.getAlgorithmName()
      };
    } else {
      const retryAfterSec = Math.max(1, Math.ceil((resetTimeMs - now) / 1000));
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetTimeMs,
        retryAfterSec,
        algorithm: this.getAlgorithmName()
      };
    }
  }
}
