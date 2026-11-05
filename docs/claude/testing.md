# Testing

The api-compile and api-registry suites call whatever is listening on `localhost:8080`/`8081` (`API_URL` overrides): normally the docker compose stack. To test a server change, rebuild and restart it first (`docker compose up -d --build`), or the suites test the old images.

API tests use `request()` from `miden-source-code-verification-test-utils` (a fetch-based, supertest-like builder), not supertest.

Fixtures (`packages/test-utils`) live on Testnet only. Mainnet (`mm`, Miden's invite-only Partner Mainnet) has none: creating an account there needs an invite code and costs real fees, so don't deploy to it. Mainnet tests only read the public USDCx fee faucet (`0xe69e6ca6e39df1b10c1e5399399feb`). Use `mxx` for a network the binaries don't serve: `mlcl` resolves on the host but not in the container.
