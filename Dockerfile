FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY src/ ./src/
COPY client-sdk/ ./client-sdk/
COPY edge-worker/ ./edge-worker/
COPY tests/ ./tests/
COPY benchmarks/ ./benchmarks/

# Run unit tests during container build as an immutable CI gate
RUN node --experimental-strip-types tests/run_tests.ts

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Install curl for docker healthcheck
RUN apk add --no-cache curl

COPY --from=builder /app ./

EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "--experimental-strip-types", "src/server.ts"]
