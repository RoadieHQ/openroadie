# Microsoft Graph — Teams seed dossier

Covers only the Microsoft Teams seeds (`microsoft-graph-teams.js`,
`microsoft-graph-team-channels.js`, `microsoft-graph-team-members.js`). The
Entra ID directory seeds in this folder predate this file and are not
re-documented here.

## Base host + version

- Host: `https://graph.microsoft.com` — already registered on the existing
  `microsoft-graph` integration row (migration
  `20260306000002_add_msgraph_integration.js`).
- Version: Microsoft Graph **v1.0** — every path is prefixed `/v1.0/...`,
  matching the row's `config.apiVersion: 'v1.0'` and the existing Entra seeds.
- Docs: https://learn.microsoft.com/en-us/graph/api/overview?view=graph-rest-1.0

## Auth

- Reuses the registered integration row unchanged: engine auth type
  **`oauth2-client-credentials`** against
  `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`
  with scope `https://graph.microsoft.com/.default`.
- The `.default` scope grants whatever **application permissions** the app
  registration has been consented. The Teams seeds additionally require
  (verified per-endpoint below, application column, least privileged for
  tenant-wide access):
  - `Team.ReadBasic.All` — list teams
  - `Channel.ReadBasic.All` — list channels per team (the docs' least
    privileged `ChannelSettings.Read.Group` is resource-specific consent,
    per-team; `Channel.ReadBasic.All` is the tenant-wide equivalent)
  - `TeamMember.Read.All` — list members per team (the docs' least privileged
    `TeamMember.Read.Group` is resource-specific consent, per-team)
- Permission types doc:
  https://learn.microsoft.com/en-us/graph/permissions-overview

## Pagination

All three endpoints page via a **`@odata.nextLink` property in the response
body** holding the absolute URL of the next page; pagination ends when the
property is absent. Docs: https://learn.microsoft.com/en-us/graph/paging

Mapped to the engine's **`body-link`** pagination type
(`plugins/integrations-node/src/backends/http/Backend.ts`): sets
`perPageParam` on the first request (skipped when `perPage: 0`), evaluates
`nextLinkExpression` against each response body, and follows the URL's
path + query until it is absent — exactly Graph's contract, and the same
config the existing Entra seeds in this folder use:

```js
pagination: {
  type: 'body-link',
  nextLinkExpression: '$."@odata.nextLink"',
  perPageParam: '$top',
  perPage: 100,
}
```

The channels endpoint does **not** document `$top` support, so that seed sets
`perPage: 0` (the engine then sends no page-size param and still follows
`@odata.nextLink` — same pattern as the Sentry members seed).

## Why `GET /teams` and not `/groups?$filter=resourceProvisioningOptions/...`

`GET /teams` is the current v1.0 API whose reference page is titled "List all
teams in an organization" and which supports `$filter`, `$select`, `$top`,
`$skiptoken`, and `$count` directly — the `/groups` filter on
`resourceProvisioningOptions` is the legacy pre-`/teams` approach. Verified
against https://learn.microsoft.com/en-us/graph/api/teams-list?view=graph-rest-1.0

## Seeds

### 1. Microsoft Teams teams (`microsoft-graph-teams.js`)

- Endpoint: `GET /v1.0/teams?$select=id,displayName,description,visibility`
- Application permission: **`Team.ReadBasic.All`** (least privileged; higher:
  `TeamSettings.Read.All`, `TeamSettings.ReadWrite.All`)
- Docs: https://learn.microsoft.com/en-us/graph/api/teams-list?view=graph-rest-1.0
- Query params: "This method supports the `$filter`, `$select`, `$top`,
  `$skiptoken`, and `$count` OData query parameters."
- Documented caveat driving the `$select`: "Currently, this API call returns
  all properties of a team object, but only populates the **id**,
  **displayName**, **description**, and **visibility** properties. All other
  properties are returned as `null`." — so the seed selects exactly those four.
- Documented response: `{ "value": [ { "id": "172b0cce-...", "displayName":
"Contoso Team", "description": "...", "visibility": "public" }, ... ] }`
- Derived: `arrayExpression: 'value'`, `objectIdExpression: '$string(id)'`
  (team ID = the group's GUID), sink `id_selector: '$string(id)'`,
  `items_selector: '$'`.
- Pagination: `body-link`, `$top=100`.

### 2. Microsoft Teams channels per team (`microsoft-graph-team-channels.js`)

- Chain: teams → `GET /v1.0/teams/{{id}}/channels?$select=id,displayName,description,membershipType,webUrl,createdDateTime,isArchived`
- Application permission: **`Channel.ReadBasic.All`** for tenant-wide access
  (the table's least privileged application permission,
  `ChannelSettings.Read.Group`, uses resource-specific consent) — plus
  `Team.ReadBasic.All` for the parent step.
- Docs: https://learn.microsoft.com/en-us/graph/api/channel-list?view=graph-rest-1.0
- Query params: "This method supports the `$filter` and `$select` OData query
  parameters." No `$top` → `perPage: 0`.
- The `$select` also follows the docs' performance guidance: "Populating the
  **email** property for a channel is an expensive operation … Use `$select`
  to exclude the **email** property to improve performance."
- Documented response: `{ "value": [ { "id":
"19:561fbdbbfca848a484f0a6f00ce9dbbd@thread.tacv2", "createdDateTime":
"2020-05-27T19:22:25.692Z", "displayName": "General", "description": "...",
"membershipType": "standard", "isArchived": false } ] }` — and "When the
  result set spans multiple pages, the response includes an
  **@odata.nextLink** property".
- Derived: `arrayExpression: 'value'`, `objectIdExpression: '$string(id)'`,
  `resultMode: 'flatten'` (each channel keeps `_parent` = the team), sink
  `id_selector: '$string(_parent.id) & ":" & $string(id)'`,
  `items_selector: '$'`.
- Note: private/shared channels a caller isn't a member of are omitted for
  delegated callers; application permissions with tenant-wide consent see all
  channels.

### 3. Microsoft Teams members per team (`microsoft-graph-team-members.js`)

- Chain: teams → `GET /v1.0/teams/{{id}}/members`
- Application permission: **`TeamMember.Read.All`** for tenant-wide access
  (the table's least privileged application permission,
  `TeamMember.Read.Group`, uses resource-specific consent; higher:
  `TeamMember.ReadWrite.All`) — plus `Team.ReadBasic.All` for the parent step.
- Docs: https://learn.microsoft.com/en-us/graph/api/team-list-members?view=graph-rest-1.0
- Query params: "This method supports the `$filter`, `$select`, and `$top`
  OData query parameters … The default and maximum page sizes are 100 and 999
  objects respectively." Seed uses `$top=100` (the documented default).
- Documented response: `{ "value": [ { "@odata.type":
"#microsoft.graph.aadUserConversationMember", "id": "ZWUwZjVhZTIt…" (opaque
membership ID), "roles": ["owner"], "displayName": "Adele Vance", "userId":
"73761f06-2ac9-469c-9f10-279a8cc267f9", "email": "AdeleV@contoso.com" } ] }`
- The docs are explicit that "The membership IDs returned by the server must
  be treated as opaque strings" — the seed only uses `id` verbatim for row
  identity and `userId` (the Entra user's directory object ID) for linking.
- Derived: `arrayExpression: 'value'`, `objectIdExpression: '$string(id)'`,
  `resultMode: 'flatten'`, sink
  `id_selector: '$string(_parent.id) & ":" & $string(id)'`,
  `items_selector: '$'`.

## Relationship seeds

- `relationships/msgraph-team-channels.js` — team `id` ↔ channel
  `_parent.id`, `hasChannel`/`channelOf`.
- `relationships/msgraph-team-members.js` — team `id` ↔ membership
  `_parent.id`, `hasMember`/`memberOf`.
- `relationships/msgraph-team-member-entra-user.js` — membership `userId` ↔
  Entra ID user `id` (`Entra ID users` seed, same folder),
  `membershipHeldBy`/`heldMembership`. GUID-exact, so it is more robust than
  email matching and works even when `mail` is empty, without making the join
  record participate in person identity merges.

## Rate limits

The Microsoft Graph service-specific throttling page
(https://learn.microsoft.com/en-us/graph/throttling-limits) lists **no
Teams-read-specific limits for these three endpoints**; the global Graph
limit (130,000 requests per 10 seconds per app across all tenants) and
per-tenant service behavior apply, with 429 + `Retry-After` on throttle.
The registered integration row already encodes conservative limits well under
that: `requests_per_hour: 10000`, `requests_per_second: 2.78`,
`burst_capacity: 100`.

## Verification status

**Static-only.** Endpoints, application permissions, query-parameter support,
response shapes, the populated-property caveat on `GET /teams`, the
no-`$top` limitation on channels, the member page-size bounds, and the
`@odata.nextLink` paging contract were all verified on 2026-07-13 against the
live Microsoft Learn v1.0 reference pages linked above — not against a live
tenant, since no Azure app registration credentials were available. Running
each seed once against a real tenant (app with `Team.ReadBasic.All`,
`Channel.ReadBasic.All`, `TeamMember.Read.All` admin-consented) would upgrade
this to live-verified.
