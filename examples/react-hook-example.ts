import { useState, useCallback } from 'react';
import { UltraResilientClient, CircuitState } from '../client-sdk/resilient_client.ts';

/**
 * Senior Frontend React Hook (@ultra-fe/use-resilient-fetch)
 * Demonstrates how client-side resilience transforms UI UX during rate limiting.
 */
export function useResilientFetch() {
  const [circuitState, setCircuitState] = useState<CircuitState>('CLOSED');
  const [isThrottled, setIsThrottled] = useState(false);
  const [retryCountdownSec, setRetryCountdownSec] = useState<number | null>(null);

  // Initialize client with 15 burst capacity, 5 refill/sec, and full jitter backoff
  const [client] = useState(() => {
    const instance = new UltraResilientClient(15, 5, {
      maxRetries: 3,
      baseDelayMs: 400,
      jitterStrategy: 'full'
    });

    instance.onCircuitStateChange = (state) => {
      setCircuitState(state);
    };

    instance.onBackoffTick = (attempt, delayMs, retryAfterSec) => {
      setIsThrottled(true);
      setRetryCountdownSec(retryAfterSec);
    };

    return instance;
  });

  const resilientFetch = useCallback(
    async (url: string, options?: RequestInit) => {
      try {
        const response = await client.fetch(url, options);
        setIsThrottled(false);
        setRetryCountdownSec(null);
        return response;
      } catch (err) {
        setIsThrottled(false);
        setRetryCountdownSec(null);
        throw err;
      }
    },
    [client]
  );

  return {
    fetch: resilientFetch,
    circuitState,
    isThrottled,
    retryCountdownSec,
    telemetry: client.telemetry
  };
}
