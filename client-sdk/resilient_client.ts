import { TokenBucketRateLimiter } from '../src/algorithms/token_bucket.ts';
import { ClientBackoffConfig } from '../src/types.ts';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ResilientRequestOptions extends RequestInit {
  id?: string;
  maxRetries?: number;
  skipClientLimiter?: boolean;
}

export interface ClientTelemetry {
  totalInitiated: number;
  preflightThrottled: number;
  server429Encountered: number;
  retriesExecuted: number;
  circuitTrips: number;
  successfulResponses: number;
}

/**
 * Senior Frontend Resilient Client SDK (@ultra-fe/resilient-client)
 * Integrates:
 * 1. Client-Side Pre-Flight Token Bucket (Saves bandwidth & prevents client floods)
 * 2. Exponential Backoff with Full Jitter and Decorrelated Jitter
 * 3. Exact Retry-After & X-RateLimit-Reset HTTP header parsing
 * 4. Circuit Breaker to prevent UI freeze and thundering herd cascades
 * 5. Reactive UI callbacks for stateful UI spinners / banner degraded states
 */
export class UltraResilientClient {
  private preflightLimiter: TokenBucketRateLimiter;
  private backoffConfig: ClientBackoffConfig;
  private circuitState: CircuitState = 'CLOSED';
  private consecutive429s: number = 0;
  private circuitBreakerThreshold: number = 4;
  private circuitOpenUntilMs: number = 0;
  private circuitCooldownMs: number = 8000;

  public telemetry: ClientTelemetry = {
    totalInitiated: 0,
    preflightThrottled: 0,
    server429Encountered: 0,
    retriesExecuted: 0,
    circuitTrips: 0,
    successfulResponses: 0
  };

  // UI Event hooks
  public onBackoffTick?: (attempt: number, delayMs: number, retryAfterSec: number) => void;
  public onCircuitStateChange?: (state: CircuitState) => void;

  constructor(
    preflightBurstCapacity: number = 15,
    preflightRefillRate: number = 5,
    backoffConfig: Partial<ClientBackoffConfig> = {}
  ) {
    this.preflightLimiter = new TokenBucketRateLimiter(preflightBurstCapacity, preflightRefillRate);
    this.backoffConfig = {
      maxRetries: backoffConfig.maxRetries ?? 3,
      baseDelayMs: backoffConfig.baseDelayMs ?? 500,
      maxDelayMs: backoffConfig.maxDelayMs ?? 10000,
      jitterStrategy: backoffConfig.jitterStrategy ?? 'full'
    };
  }

  public getCircuitState(): CircuitState {
    const now = Date.now();
    if (this.circuitState === 'OPEN' && now >= this.circuitOpenUntilMs) {
      this.transitionCircuit('HALF_OPEN');
    }
    return this.circuitState;
  }

  private transitionCircuit(newState: CircuitState): void {
    if (this.circuitState !== newState) {
      this.circuitState = newState;
      if (newState === 'OPEN') {
        this.telemetry.circuitTrips++;
        this.circuitOpenUntilMs = Date.now() + this.circuitCooldownMs;
      }
      if (this.onCircuitStateChange) {
        this.onCircuitStateChange(newState);
      }
    }
  }

  /**
   * Calculates exponential backoff with Full Jitter (AWS Best Practice)
   * Formula: random(0, min(cap, base * 2^attempt))
   */
  public calculateJitterDelay(attempt: number, serverRetryAfterMs?: number): number {
    if (serverRetryAfterMs && serverRetryAfterMs > 0) {
      // Respect server Retry-After, adding minor jitter (+0-200ms) to desynchronize herd
      return serverRetryAfterMs + Math.floor(Math.random() * 200);
    }

    const { baseDelayMs, maxDelayMs, jitterStrategy } = this.backoffConfig;
    const exponentialLimit = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));

    if (jitterStrategy === 'full') {
      return Math.floor(Math.random() * exponentialLimit);
    } else if (jitterStrategy === 'decorrelated') {
      const prev = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
      return Math.floor(Math.min(maxDelayMs, baseDelayMs + Math.random() * (prev * 3 - baseDelayMs)));
    }
    return exponentialLimit;
  }

  /**
   * Parses standard HTTP headers: Retry-After (seconds or date) and X-RateLimit-Reset
   */
  public parseRetryHeaders(headers: Headers): { retryAfterMs?: number; resetTimeMs?: number } {
    let retryAfterMs: number | undefined;
    const retryAfterHeader = headers.get('retry-after');

    if (retryAfterHeader) {
      const parsedSeconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsedSeconds)) {
        retryAfterMs = parsedSeconds * 1000;
      } else {
        const parsedDate = Date.parse(retryAfterHeader);
        if (!isNaN(parsedDate)) {
          retryAfterMs = Math.max(0, parsedDate - Date.now());
        }
      }
    }

    const resetHeader = headers.get('x-ratelimit-reset');
    let resetTimeMs: number | undefined;
    if (resetHeader) {
      const parsedReset = parseInt(resetHeader, 10);
      if (!isNaN(parsedReset)) {
        resetTimeMs = parsedReset > 10000000000 ? parsedReset : parsedReset * 1000;
      }
    }

    return { retryAfterMs, resetTimeMs };
  }

  /**
   * Resilient Fetch with full client-side rate-limiting and backoff recovery
   */
  public async fetch(url: string, options: ResilientRequestOptions = {}): Promise<Response> {
    this.telemetry.totalInitiated++;

    // 1. Check Circuit Breaker
    const currentCircuit = this.getCircuitState();
    if (currentCircuit === 'OPEN') {
      throw new Error(`Circuit Breaker OPEN: Gateway shedding load until ${new Date(this.circuitOpenUntilMs).toISOString()}`);
    }

    // 2. Client-Side Pre-Flight Token Bucket Check
    if (!options.skipClientLimiter) {
      const preflightDecision = this.preflightLimiter.consume('client_local', 1);
      if (!preflightDecision.allowed) {
        this.telemetry.preflightThrottled++;
        // Preemptively delay without hitting network
        const waitMs = (preflightDecision.retryAfterSec || 1) * 1000;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    const maxRetries = options.maxRetries ?? this.backoffConfig.maxRetries;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, options);

        if (response.status === 429) {
          this.telemetry.server429Encountered++;
          this.consecutive429s++;

          if (this.consecutive429s >= this.circuitBreakerThreshold) {
            this.transitionCircuit('OPEN');
            throw new Error(`Circuit Breaker Tripped after ${this.consecutive429s} consecutive 429s.`);
          }

          if (attempt >= maxRetries) {
            return response; // Return 429 response if max retries exhausted
          }

          // Parse server backoff instructions
          const { retryAfterMs } = this.parseRetryHeaders(response.headers);
          const delayMs = this.calculateJitterDelay(attempt, retryAfterMs);

          this.telemetry.retriesExecuted++;
          if (this.onBackoffTick) {
            this.onBackoffTick(attempt + 1, delayMs, Math.ceil(delayMs / 1000));
          }

          await new Promise((r) => setTimeout(r, delayMs));
          attempt++;
          continue;
        }

        // On successful response, reset consecutive failure count
        if (response.ok) {
          this.consecutive429s = 0;
          if (this.circuitState === 'HALF_OPEN') {
            this.transitionCircuit('CLOSED');
          }
          this.telemetry.successfulResponses++;
        }

        return response;
      } catch (err) {
        if (attempt >= maxRetries || this.circuitState === 'OPEN') {
          throw err;
        }
        const delayMs = this.calculateJitterDelay(attempt);
        await new Promise((r) => setTimeout(r, delayMs));
        attempt++;
      }
    }

    throw new Error('Resilient fetch exhausted max retries without success.');
  }
}
