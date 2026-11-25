export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTimeMs: number;
  retryAfterSec?: number;
  algorithm: string;
  metadata?: Record<string, any>;
}

export interface RateLimiter {
  consume(key: string, cost?: number): Promise<RateLimitResult> | RateLimitResult;
  reset(key: string): void;
  getAlgorithmName(): string;
}

export interface ClientBackoffConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterStrategy: 'full' | 'decorrelated' | 'none';
}

// Runtime symbols to satisfy non-type imports under --experimental-strip-types
export const RateLimitResult = {};
export const RateLimiter = {};
export const ClientBackoffConfig = {};

