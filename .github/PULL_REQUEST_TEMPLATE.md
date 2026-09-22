## What does this change?

<!-- What the PR does and why. Link the issue it closes: "Closes #123". -->

## Screenshots

<!-- Required for UI changes. Before/after if you are changing something that exists. Delete this section otherwise. -->

## Changelog entry

<!--
If this is user-facing (a new feature, a behaviour change, a bugfix someone
would notice), write one line we can drop into the release notes. Delete this
section for internal-only changes.
-->

## Checklist

- [ ] Every commit is signed off (`git commit -s`) — see [Signing your work in CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] PR title starts with one of `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert` (see [CONTRIBUTING.md](../CONTRIBUTING.md))
- [ ] `yarn verify` passes (prettier, lint, typecheck)
- [ ] `yarn test:ci` passes
- [ ] Tests cover the change
- [ ] Docs updated, if this changes how openroadie is used or configured

<!--
A few things reviewers will look for, from AGENTS.md:

- New caller of a shared write core? It ends in the one choke-point method, and
  it is added to both parity suites.
- Testing derived state? Assert it *tracks its inputs across changes*, not that
  it exists after one operation.
- No `@mui/*` in packages/app, no raw Tailwind motion utilities, icons from
  lucide-react only.
-->
