.PHONY: all test benchmark start docker-build clean

all: test

test:
	node --experimental-strip-types tests/run_tests.ts

benchmark:
	node --experimental-strip-types benchmarks/run_audit_benchmarks.ts

start:
	node --experimental-strip-types src/server.ts

docker-build:
	docker build -t ultra-rate-limit-mesh:local .

clean:
	rm -rf dist/ coverage/
