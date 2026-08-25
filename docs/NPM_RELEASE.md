# npm Release

## Package

- Name: `mytoken-gateway`
- Preview version: `0.1.0-preview.1`
- Public install command: `sudo npx --yes mytoken-gateway@preview install`
- Published contents: CLI, README, and Apache-2.0 license only
- Default source ref: immutable Git tag `v0.1.0-preview.1`

The CLI clones the configured GitHub repository/ref, installs required common Linux tools and the pinned official `@openai/codex@0.147.0`, then runs the repository's tested deployment script.

## Current blocker

The current development machine is not authenticated to npm. `npm whoami` returns `ENEEDAUTH`. Do not paste an npm token into this repository, Codex, logs, or chat.

## Initial public preview publication

The unscoped package name `mytoken-gateway` was not present in the public registry when checked on 2026-08-25. Availability is not reserved until the first successful publication.

Authenticate interactively with publishing 2FA:

```bash
npm login
npm whoami
```

Re-run all gates and inspect the exact tarball:

```bash
npm ci
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run db:check
npm run codex:check-contract
npm audit --audit-level=high
npm pack --dry-run --workspace packages/cli
```

Publish the preview:

```bash
npm publish --workspace packages/cli --access public --tag preview
```

The matching Git tag must already exist on GitHub before publication. The installer deliberately clones the immutable tag instead of a mutable development branch.

The npm CLI may request a one-time 2FA code. Do not add `--otp` to committed scripts or shell history.

Verify from a clean temporary directory:

```bash
npm view mytoken-gateway@preview name version dist-tags --json
npx --yes mytoken-gateway@preview --help
```

## Trusted publishing for subsequent releases

After the initial package exists, configure its npm Trusted Publisher:

- Provider: GitHub Actions
- Organization/user: `ForceMind`
- Repository: `MyToken`
- Workflow filename: `publish-npm.yml`
- Allowed action: `npm publish`

Then run the **Publish npm preview** workflow. It uses a GitHub-hosted runner, Node 24, a current npm CLI, `id-token: write`, full project gates, package inspection, and OIDC publication. No long-lived npm write token is required.

Before selecting the `latest` dist-tag, complete real Linux/systemd, Codex login, and OpenClaw E2E validation. Until then, publish only under `preview`.

## Versioning

Published versions are immutable. Increment `packages/cli/package.json` for every publication:

```text
0.1.0-preview.1
0.1.0-preview.2
...
0.1.0
```

Never reuse a published version, even if a release is broken. Publish a corrected new version and deprecate the affected version if necessary.
