# Open follow-ups: integrations-backend

Tracks the remaining follow-up work for `integrations-backend` and
`integrations-node` after the scoped / shared-subject-index refactor.

This file replaces the older `TODO-statelessness.md` and
`TODO-github-app-resolution.md` lists and keeps only the items that still
appear to be live.

---

## 1. `POST /github-app/token` should not fall back to an unrelated installation

**Status:** Open  
**Risk:** Medium - a token request for org `A` can mint a token for org `B`
when the app exists but no installation matches the requested org.

### Problem

The bare-host case is already fixed: requests like `https://github.com` are
rejected when no org can be resolved from the URL.

The remaining issue is narrower. `GithubAppService.createToken` still falls back
to `GithubAppInstallationDao.list(appId)[0]` when:

- the request URL resolves an org, and
- the app exists for the host and purpose, but
- no installation matches that org

That can silently mint a token for the wrong installation.

### Fix options

- Return `404` or `400` when an org is resolved but no installation matches it
- Require the caller to supply an explicit, validated target org and reject
  mismatches before minting

---

## 2. Org-less GitHub API endpoints still cannot use GitHub App auth automatically

**Status:** Partially addressed  
**Risk:** Medium - requests with no org context still fall back to static auth
instead of a GitHub App installation token.

### Problem

`IntegrationClient` now resolves org context from more places than the original
TODO captured:

- REST path segments where the first segment is `repos`, `orgs`, or `users`
- `org:` or `user:` qualifiers in the `q` query parameter
- GraphQL variables such as `login`, `org`, `organization`, or `owner`
- Inline GraphQL queries such as `organization(login: "...")`

Requests that still cannot be resolved to an org fall back to the integration's
configured static/header auth. Common examples include:

- `/user/orgs`, `/user/repos`, `/user/installations`
- `/rate_limit`, `/meta`
- `/search/...` without `org:` or `user:` qualifiers
- `/teams/{team_id}`
- `/notifications`, `/gists`

### Fix options

- Add explicit `targetOrg` support on the data-source configuration and use it
  before request-based org extraction
- Reject GitHub App-backed configurations that only make org-less requests

---

## 3. Do not delete shared rate-limit state during normal pod shutdown

**Status:** Open  
**Risk:** Medium - rolling deploys or pod restarts can temporarily over-grant
tokens for an integration.

### Problem

`PostgresRateLimiter` correctly uses PostgreSQL as the shared source of truth for
token bucket state, but `destroy()` deletes the `rate_limit_state` row.

That row is shared across replicas. If one pod shuts down and destroys its local
rate limiter, it should not wipe the shared row out from under other running
pods. The next request recreates the row, which resets the effective bucket to
`burst`.

### Fix

Split cleanup semantics:

- Process shutdown closes only local resources
- Explicit integration removal or reset is the only path that deletes shared DB
  state

If row cleanup is still desired, it should happen in an operation scoped to
integration deletion, not instance shutdown.

---

## 4. Make token and TLS cache invalidation replica-safe

**Status:** Open  
**Risk:** Medium - credential rotation or CA changes can take effect at
different times on different replicas.

### Problem

Several caches are process-local:

- `LocalGitHubAppTokenProvider.tokenCache`
- `KmsGitHubAppTokenProvider.tokenCache`
- `HttpBackend.oauth2TokenCache`
- `HttpBackend.dispatcherCache`

Those are acceptable as performance caches, but invalidation is local-only.
When integration auth or CA configuration changes, only the handling replica
clears its cached state. Other replicas keep serving with old entries until
expiry, and `dispatcherCache` has no natural expiry.

### Fix options

- Publish cache invalidation events for integration and GitHub App changes so
  every replica clears the affected entries
- Reduce cache lifetimes and add TTL-based expiry where practical, especially
  for dispatcher state

---

## 5. Move remaining startup side effects onto coordinated execution paths

**Status:** Partially addressed  
**Risk:** Low-medium - duplicate work and duplicate upstream fetches during
deploys.

### Problem

Scheduled follow-up work already uses the platform scheduler, but some startup
work still runs on every replica. The main remaining example is
startup-triggered spec processing kicked off via `setTimeout`.

These operations are mostly idempotent because the database absorbs the writes,
so they do not create the same correctness problem as the old in-memory
integration map. But they still produce duplicated work and make behavior less
predictable under horizontal scaling.

### Fix

Move these tasks onto a coordinated path, for example:

- Schedule them through the existing scheduler service
- Guard them with a DB lock or leader-election mechanism
- Restrict startup work to queueing a job rather than doing the work inline

The goal is not "no background work", it is "background work should not assume a
single process."
