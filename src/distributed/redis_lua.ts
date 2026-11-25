/**
 * Distributed Redis Lua Scripts
 * Solves race conditions under high concurrency (e.g. 10,000 req/sec across cluster nodes).
 * Ensures atomic check-and-increment operations without multi-step round trips.
 */

export const REDIS_TOKEN_BUCKET_LUA = `
-- KEYS[1]: bucket key
-- ARGV[1]: capacity
-- ARGV[2]: refill_rate_per_sec
-- ARGV[3]: now_ms
-- ARGV[4]: requested_tokens

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if tokens == nil then
    tokens = capacity
    last_refill = now
else
    local elapsed = math.max(0, now - last_refill) / 1000.0
    tokens = math.min(capacity, tokens + (elapsed * refill_rate))
    last_refill = now
end

if tokens >= requested then
    tokens = tokens - requested
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
    redis.call('PEXPIRE', key, math.ceil((capacity / refill_rate) * 2000))
    return {1, math.floor(tokens)}
else
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
    redis.call('PEXPIRE', key, math.ceil((capacity / refill_rate) * 2000))
    local needed = requested - tokens
    local wait_ms = math.ceil((needed / refill_rate) * 1000)
    return {0, 0, wait_ms}
end
`;

export const REDIS_SLIDING_WINDOW_COUNTER_LUA = `
-- KEYS[1]: base rate limit key
-- ARGV[1]: limit
-- ARGV[2]: window_ms
-- ARGV[3]: now_ms
-- ARGV[4]: cost

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local current_window = math.floor(now / window_ms)
local prev_window = current_window - 1
local time_elapsed = now % window_ms
local prev_weight = 1.0 - (time_elapsed / window_ms)

local curr_key = key .. ":" .. current_window
local prev_key = key .. ":" .. prev_window

local curr_count = tonumber(redis.call('GET', curr_key) or 0)
local prev_count = tonumber(redis.call('GET', prev_key) or 0)

local estimated = (prev_count * prev_weight) + curr_count

if estimated + cost <= limit then
    redis.call('INCRBY', curr_key, cost)
    redis.call('PEXPIRE', curr_key, window_ms * 2)
    return {1, math.floor(limit - (estimated + cost))}
else
    local reset_ms = (current_window + 1) * window_ms - now
    return {0, 0, reset_ms}
end
`;
