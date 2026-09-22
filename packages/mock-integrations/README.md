# @roadiehq/mock-integrations

A tiny webserver that impersonates third-party integration APIs for testing
data sources. It exposes one path prefix per integration (`/github`, `/azure`,
`/shortcut`, …) and answers each request with a previously saved real response,
read from S3 (deployed) or a local directory (dev/CI).

This lets anyone exercise the seeded data sources without holding live
accounts for all the integrations — including trial-gated ones (Wiz,
Dynatrace) whose responses outlive the expired trial.

## Run

```bash
# against local fixtures
MOCK_INTEGRATIONS_DIR=./fixtures yarn workspace @roadiehq/mock-integrations start

# against the shared S3 bucket
MOCK_INTEGRATIONS_S3_BUCKET=<bucket> MOCK_INTEGRATIONS_S3_PREFIX=fixtures \
  yarn workspace @roadiehq/mock-integrations start
```

Listens on `PORT` (default `7050`). `GET /healthz` for liveness.

## Point an integration at it

Set the integration's host to the proxy prefix instead of the real API, e.g.
`http://localhost:7050/github` instead of `https://api.github.com`. Auth
secrets can be dummy values — the stored responses were recorded with real
auth, the mock ignores auth entirely. For oauth2 integrations, point the token
URL at the proxy too and save a canned token response
(`{ "status": 200, "body": { "access_token": "mock", "expires_in": 3600 } }`).

## Storage layout

One JSON object per recorded request, keyed by integration, method, path, and
sorted query string:

```
github/GET/user/repos.json
github/GET/user/repos__page=2&per_page=50.json
wiz/POST/oauth/token.json
```

Each object is `{ "status": number, "body": <parsed response>, "headers"?: {} }`.
Unknown requests return `404` with the key the server looked for — save a
response under exactly that key to make it pass.

Responses recorded from real accounts stay in the private S3 bucket; do not
commit them to this repository.
