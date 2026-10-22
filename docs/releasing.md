# Releasing AgentOS

AgentOS currently ships source archives for Linux. The installer keeps the checkout
and its dependencies available at runtime. npm publication and compiled binaries
are not part of this release process; `package.json` intentionally remains private.

## Before the first public release

- Retain the MIT license and copyright notice in source distributions. Review
  dependency licenses and any additional redistribution requirements.
- Publish the source to `https://github.com/Jarvissilva/agentos` with `main` as the
  default branch. The README, package metadata, and installer use this repository;
  preserve the environment and `--repo` overrides for forks.
- Enable private vulnerability reporting under the repository's Security settings.
- Enable Actions and require successful CI checks in the default branch rules.
- Review tracked files and Git history for secrets and personal data before pushing.
  Remove accidental disclosures and rotate exposed credentials before publication.

## Validate a release candidate

- Use a clean checkout with `bun install --frozen-lockfile`; run `bun run check`,
  `bun audit`, and `bash -n scripts/install.sh`. Both supported Bun versions in CI
  must pass, including socket, PTY, and tmux integration tests.
- Keep package and CLI versions consistent and use a matching tag, such as `v0.1.0`.
- Record supported Linux distributions, architecture, terminal, Bun version, and
  native provider versions in release notes. Explain known limitations and changes
  to persisted data.
- On a disposable Linux user account or VM, install the candidate source archive
  with the real dependency registry. Test CLI startup, a native provider session,
  resume, and embedded tabs. Test Agy disconnect/reconnect if advertising Agy support.
- Test existing-data migration with a copied fixture and the documented backup
  procedure. Stop the worker and application before replacing an installation.
- Confirm installer failure cleanup, refusal to overwrite existing commands, and
  removal preserving user data. Automated installer tests mock network downloads
  and dependency installation; they do not replace this clean-machine check.

## Publish and verify

After maintainer approval, tag the validated commit and publish a GitHub release
with release notes. The installer downloads GitHub's tag archive; a separate binary
asset is not required. Keep published tags immutable. The default installer resolves
the latest published release, so a tag without a release is insufficient.

Install the explicit published tag on the disposable machine using the README
command with `--version`, then test the default latest-release command. Verify
`agentos --version`, `agentos paths`, and startup from a different working directory.
Record the actual results in release notes. If verification fails, disclose the
problem and correct it in a new release rather than moving an existing tag.

The installer does not yet verify an independently published checksum or signature;
downloads rely on HTTPS and trust in the repository, GitHub, the Bun installer, and
the dependency registry.
