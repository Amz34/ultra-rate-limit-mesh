import http from 'node:http';
import { parse } from 'node:url';
import { TokenBucketRateLimiter } from './algorithms/token_bucket.ts';
import { FixedWindowRateLimiter } from './algorithms/fixed_window.ts';
import { LeakyBucketRateLimiter } from './algorithms/leaky_bucket.ts';
import { SlidingWindowLogRateLimiter } from './algorithms/sliding_window_log.ts';
import { SlidingWindowCounterRateLimiter } from './algorithms/sliding_window_counter.ts';
import { RateLimiter, RateLimitResult } from './types.ts';

const PORT = parseInt(process.env.PORT || '3000', 10);

// Initialize all 5 algorithms (Default quota: 10 requests / 5 seconds)
const limiters: Record<string, RateLimiter> = {
  token_bucket: new TokenBucketRateLimiter(10, 2), // 10 burst capacity, 2 tokens/sec
  fixed_window: new FixedWindowRateLimiter(10, 5000), // 10 reqs per 5 sec
  leaky_bucket: new LeakyBucketRateLimiter(10, 2), // 10 queue size, 2 drips/sec
  sliding_log: new SlidingWindowLogRateLimiter(10, 5000), // 10 reqs per 5000ms rolling log
  sliding_counter: new SlidingWindowCounterRateLimiter(10, 5000) // 10 reqs per 5000ms weighted
};

// Global telemetry metrics
const metrics = {
  totalRequests: 0,
  acceptedRequests: 0,
  rejectedRequests: 0,
  byAlgorithm: {} as Record<string, { accepted: number; rejected: number }>
};

for (const algo of Object.keys(limiters)) {
  metrics.byAlgorithm[algo] = { accepted: 0, rejected: 0 };
}

const server = http.createServer(async (req, res) => {
  metrics.totalRequests++;
  const parsedUrl = parse(req.url || '/', true);
  const pathname = parsedUrl.pathname || '/';

  // Health check endpoint
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', uptime: process.uptime(), timestamp: Date.now() }));
    return;
  }

  // Telemetry endpoint
  if (pathname === '/api/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics, null, 2));
    return;
  }

  // Rate limited protected endpoint
  if (pathname === '/api/resource') {
    const queryAlgo = (parsedUrl.query.algo as string) || req.headers['x-ratelimit-algorithm'] as string || 'sliding_counter';
    const limiter = limiters[queryAlgo] || limiters.sliding_counter;
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const clientKey = `${clientIp}:${queryAlgo}`;

    const decision: RateLimitResult = await limiter.consume(clientKey, 1);

    // Standard IETF & RFC RateLimit Response Headers
    res.setHeader('X-RateLimit-Limit', decision.limit);
    res.setHeader('X-RateLimit-Remaining', decision.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(decision.resetTimeMs / 1000));
    res.setHeader('X-RateLimit-Algorithm', decision.algorithm);

    if (decision.allowed) {
      metrics.acceptedRequests++;
      metrics.byAlgorithm[queryAlgo].accepted++;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Request granted access to enterprise protected resource.',
        decision,
        timestamp: Date.now()
      }));
    } else {
      metrics.rejectedRequests++;
      metrics.byAlgorithm[queryAlgo].rejected++;

      res.setHeader('Retry-After', decision.retryAfterSec || 1);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Too Many Requests',
        message: `Rate limit threshold exceeded via [${decision.algorithm}]. Back off and retry.`,
        retryAfterSec: decision.retryAfterSec,
        resetTimeMs: decision.resetTimeMs,
        decision
      }));
    }
    return;
  }

  // 404 fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found. Use /api/resource or /health.' }));
});

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Ultra Rate-Limiting Engine listening on port ${PORT}`);
    console.log(`📊 Available algorithms: ${Object.keys(limiters).join(', ')}`);
  });
}

export { server, limiters, metrics };
