# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
Discord, or pull requests.**

Email **security@roadie.io** instead. If you would like to encrypt your report,
say so in a first message and we will reply with a key.

Please include as much of the following as you can — it helps us triage faster:

- The type of issue (for example: authentication bypass, SSRF, SQL injection,
  secret disclosure, privilege escalation across workspaces or scopes).
- The affected version or commit, and how openroadie was deployed (the CLI, the
  published Docker image, a checkout, or an embedded install).
- Full paths of the source files related to the issue.
- Step-by-step instructions to reproduce, including any configuration required.
- Proof-of-concept or exploit code, if you have it.
- The impact, including how an attacker might exploit it.

## What to expect

| Stage                                      | Target          |
| ------------------------------------------ | --------------- |
| Acknowledgement of your report             | 3 working days  |
| Initial assessment and severity triage     | 10 working days |
| Fix or mitigation plan communicated to you | 30 days         |

We will keep you updated as we work on a fix, and we will let you know when the
issue is resolved. We are happy to credit you in the release notes and the
advisory — tell us how you would like to be named, or that you would prefer to
stay anonymous.

We ask that you give us a reasonable opportunity to fix the issue before you
disclose it publicly. We publish fixed vulnerabilities as
[GitHub Security Advisories](https://github.com/RoadieHQ/openroadie/security/advisories)
against this repository.

## Scope

In scope: the code in this repository, the published
`ghcr.io/roadiehq/openroadie` image, and the `@roadiehq/openroadie-cli` and
`@roadiehq/openroadie-setup` npm packages.

Out of scope: Roadie's commercial hosted product (report those to the same
address, and say which one you mean), and vulnerabilities in third-party
integrations that openroadie merely connects to — report those to the vendor.

### Deployment posture is not a vulnerability

openroadie's default configuration is deliberately permissive so it runs on a
laptop with no setup. The default scope service grants every scope, so the
shipped REST API and MCP server perform no authorization, and `app-config.yaml`
carries a well-known signing key. That is intended for single-user local use,
and a report that an _internet-exposed_ instance running the defaults is
unauthenticated tells us something we already know.

Do not expose an instance running the defaults to a network you do not trust.
Wire a real token-to-scopes retriever into `scopeServiceRef` and replace the
signing key first.

What _is_ in scope: a way to bypass authentication or authorization on an
instance that has been configured according to the hardening guidance, a way for
one workspace or scope to read or write another's data, or a way to extract
stored integration secrets.

## Supported versions

openroadie is pre-1.0 and moves quickly. Security fixes land on `main` and in
the next tagged release; we do not backport to earlier tags. Run a recent
release.

## Handling secrets

openroadie stores credentials for the systems you connect to it. If you believe
a vulnerability may have exposed live secrets, rotate them first and tell us
second — we would much rather read a rushed report than have you wait.
