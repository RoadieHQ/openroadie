# @roadiehq/secrets-node

Node library package that defines the `SecretStoreService` contract used
by every backend plugin that needs to resolve or manage a scope-scoped
secret reference.

Ships two out-of-the-box stores:

- `envSecretStore` — read-only adapter over `process.env`. Use when
  secrets are mounted by the host (Kubernetes, ECS, systemd).
- `dotenvSecretStore` — file-backed read + write store over a local
  `.env`-format file. Use for `yarn dev` and small OSS deployments.

Consumers depend on this package for the contract and on
`secretStoreServiceRef` to inject the currently-registered store. Scoped
deployments register a scope-aware override in `internal/scope-secrets`.
