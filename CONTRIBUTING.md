**Contributing**

Thanks for your interest in contributing to openroadie! We're building the future of AI-powered software development, and we'd love for you to be part of this journey.

**Our Vision**

The openroadie community is built around the belief that AI agents have already fundamentally changed the way software is built and that this is just the beginning. Given this, we believe we should do everything we can to make sure that the benefits provided by such powerful technology are accessible to everyone. AI-powered development tools should be available to every developer, regardless of their background or resources.

We’re a collection of people who have been building in the open-source projects for many years and we believe in the power of open-source to democratize access to cutting-edge technology.

**Getting Started**

**Quick Ways to Contribute**

- **Use openroadie** and report issues you encounter
- **Star our repository** on GitHub
- **Share openroadie** with other developers

Full details in our Development Guide.

**Find Your First Issue**

- Browse good first issues
- Join our Discord community to ask what needs help

**Understanding the Codebase**

- **Frontend** - React application
- **App Server (V1)** - Current Node application server and REST API modules

**What Can You Build?**

**Frontend & UI/UX**

- React & TypeScript development
- UI/UX improvements
- Mobile responsiveness
- Component libraries

For bigger changes, join Discord first.

**Agent Development**

- Prompt engineering
- New agent types
- Agent evaluation
- Multi-agent systems

We use SWE-bench to evaluate agents.

**Backend & Infrastructure**

- Node development
- Runtime systems (Docker containers, sandboxes)
- Cloud integrations
- Performance optimization

**Testing & Quality Assurance**

- Unit testing
- Integration testing
- Bug hunting
- Performance testing

**Documentation & Education**

- Technical documentation
- Translation
- Community support

**Pull Request Process**

**Small Improvements**

- Quick review and approval
- Ensure CI tests pass
- Include clear description of changes

**Core Agent Changes**

These are evaluated based on:

- **Accuracy** - Does it make the agent better at solving problems?
- **Efficiency** - Does it improve speed or reduce resource usage?
- **Code Quality** - Is the code maintainable and well-tested?

Discuss major changes in GitHub issues or Discord first.

**Sending Pull Requests to openroadie**

You'll need to fork our repository to send us a Pull Request. You can learn more about how to fork a GitHub repo and open a PR with your changes in this article.

You may also check out previous PRs in the PR list.

**Signing your work (DCO)**

openroadie uses the [Developer Certificate of Origin](https://developercertificate.org/) — a short statement that you wrote the contribution, or otherwise have the right to submit it under the project's licence. There is no CLA to sign and no paperwork; you certify it per commit, by signing off.

Add a sign-off as you commit:

```
git commit -s -m "feat: add the thing"
```

That appends a trailer to the commit message using your Git name and email:

```
Signed-off-by: Jane Developer <jane@example.com>
```

The name and email must match the commit author. A CI check verifies every commit in your pull request, and it will tell you how to fix things if one is missing.

If you forgot on the last commit:

```
git commit --amend --signoff
git push --force-with-lease
```

If you forgot across a whole branch:

```
git rebase --signoff main
git push --force-with-lease
```

By signing off you agree to the terms below, which are the DCO version 1.1 verbatim.

<details>
<summary>Developer Certificate of Origin 1.1</summary>

```
By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

</details>

**Pull Request Title Format**

As described here, a valid PR title should begin with one of the following prefixes:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white space, formatting, missing semicolons, etc.)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `build`: Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm)
- `ci`: Changes to our CI configuration files and scripts (example scopes: Travis, Circle, BrowserStack, SauceLabs)
- `chore`: Other changes that don't modify src or test files
- `revert`: Reverts a previous commit

For example, a PR title could be:

- `refactor: modify package path`
- `feat(frontend): xxxx`, where `(frontend)` means that this PR mainly focuses on the frontend component.

**Pull Request Description**

- Explain what the PR does and why
- Link to related issues
- Include screenshots for UI changes
- If your changes are user-facing (e.g. a new feature in the UI, a change in behavior, or a bugfix), please include a short message that we can add to our changelog

**Becoming a Maintainer**

For contributors who have made significant and sustained contributions to the project, there is a possibility of joining the maintainer team. The process for this is as follows:

1. Any contributor who has made sustained and high-quality contributions to the codebase can be nominated by any maintainer. If you feel that you may qualify you can reach out to any of the maintainers that have reviewed your PRs and ask if you can be nominated.
2. Once a maintainer nominates a new maintainer, there will be a discussion period among the maintainers for at least 3 days.
3. If no concerns are raised the nomination will be accepted by acclamation, and if concerns are raised there will be a discussion and possible vote.

Note that just making many PRs does not immediately imply that you will become a maintainer. We will be looking at sustained high-quality contributions over a period of time, as well as good teamwork and adherence to our [Code of Conduct](CODE_OF_CONDUCT.md).

**Need Help?**

- **GitHub Issues**: [https://github.com/RoadieHQ/openroadie/issues](https://github.com/RoadieHQ/openroadie/issues)
