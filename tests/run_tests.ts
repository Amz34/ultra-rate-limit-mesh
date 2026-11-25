import { TokenBucketRateLimiter } from '../src/algorithms/token_bucket.ts';
import { FixedWindowRateLimiter } from '../src/algorithms/fixed_window.ts';
import { LeakyBucketRateLimiter } from '../src/algorithms/leaky_bucket.ts';
import { SlidingWindowLogRateLimiter } from '../src/algorithms/sliding_window_log.ts';
import { SlidingWindowCounterRateLimiter } from '../src/algorithms/sliding_window_counter.ts';
import { UltraResilientClient } from '../client-sdk/resilient_client.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('🧪 RUNNING ULTRA RATE-LIMITING & RESILIENCE TEST SUITE');
  console.log('====================================================\n');

  // 1. Token Bucket Tests
  console.log('▶ Testing 1. Token Bucket:');
  const tb = new TokenBucketRateLimiter(5, 5); // 5 capacity, 5 refill/sec
  assert(tb.consume('user1').allowed === true, 'Allows request when tokens available');
  assert(tb.consume('user1').allowed === true, 'Allows request 2');
  assert(tb.consume('user1').allowed === true, 'Allows request 3');
  assert(tb.consume('user1').allowed === true, 'Allows request 4');
  assert(tb.consume('user1').allowed === true, 'Allows request 5 (capacity exhausted)');
  const tbRejected = tb.consume('user1');
  assert(tbRejected.allowed === false, 'Rejects 6th request when bucket is empty');
  assert(tbRejected.retryAfterSec! >= 1, 'Calculates valid retryAfterSec');

  // Refill test
  await new Promise(r => setTimeout(r, 450));
  assert(tb.consume('user1').allowed === true, 'Allows request after token refill');

  // 2. Fixed Window Tests
  console.log('\n▶ Testing 2. Fixed Window Counter:');
  const fw = new FixedWindowRateLimiter(3, 500); // 3 per 500ms
  assert(fw.consume('user2').allowed === true, 'Allows request 1');
  assert(fw.consume('user2').allowed === true, 'Allows request 2');
  assert(fw.consume('user2').allowed === true, 'Allows request 3');
  assert(fw.consume('user2').allowed === false, 'Rejects request 4 within same window');

  // 3. Leaky Bucket Tests
  console.log('\n▶ Testing 3. Leaky Bucket:');
  const lb = new LeakyBucketRateLimiter(3, 2); // 3 capacity, 2 leak/sec
  assert(lb.consume('user3').allowed === true, 'Enqueues request 1');
  assert(lb.consume('user3').allowed === true, 'Enqueues request 2');
  assert(lb.consume('user3').allowed === true, 'Enqueues request 3');
  assert(lb.consume('user3').allowed === false, 'Rejects request 4 (bucket overflow)');

  // 4. Sliding Window Log Tests
  console.log('\n▶ Testing 4. Sliding Window Log:');
  const swl = new SlidingWindowLogRateLimiter(3, 300); // 3 per 300ms
  assert(swl.consume('user4').allowed === true, 'Logs and allows request 1');
  assert(swl.consume('user4').allowed === true, 'Logs and allows request 2');
  assert(swl.consume('user4').allowed === true, 'Logs and allows request 3');
  assert(swl.consume('user4').allowed === false, 'Rejects request 4');
  await new Promise(r => setTimeout(r, 320));
  assert(swl.consume('user4').allowed === true, 'Allows request after rolling window expiration');

  // 5. Sliding Window Counter Tests
  console.log('\n▶ Testing 5. Sliding Window Counter:');
  const swc = new SlidingWindowCounterRateLimiter(4, 400); // 4 per 400ms
  assert(swc.consume('user5').allowed === true, 'Allows request 1');
  assert(swc.consume('user5').allowed === true, 'Allows request 2');
  assert(swc.consume('user5').allowed === true, 'Allows request 3');
  assert(swc.consume('user5').allowed === true, 'Allows request 4');
  assert(swc.consume('user5').allowed === false, 'Rejects request 5 when weighted limit exceeded');

  // 6. Senior Frontend Resilient Client Tests
  console.log('\n▶ Testing 6. Sr FE Resilient Client SDK:');
  const client = new UltraResilientClient(10, 5, { maxRetries: 3, baseDelayMs: 50 });
  const headers = new Headers();
  headers.set('retry-after', '3');
  headers.set('x-ratelimit-reset', '1700000000');
  const parsed = client.parseRetryHeaders(headers);
  assert(parsed.retryAfterMs === 3000, 'Accurately parses Retry-After header in seconds to ms');
  assert(parsed.resetTimeMs === 1700000000000, 'Accurately parses X-RateLimit-Reset epoch');

  const jitterDelay = client.calculateJitterDelay(2, 2000);
  assert(jitterDelay >= 2000 && jitterDelay <= 2200, 'Calculates server-instructed jittered delay');

  const fullJitterDelay = client.calculateJitterDelay(2);
  assert(fullJitterDelay >= 0 && fullJitterDelay <= 200, 'Calculates full jitter exponential delay');

  console.log('\n====================================================');
  console.log(`📊 Test Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite();
