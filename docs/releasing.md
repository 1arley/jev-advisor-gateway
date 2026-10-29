# Releasing

Merging the release pull request publishes it. [release-please](https://github.com/googleapis/release-please)
keeps that pull request open and up to date from the commits on `main`, and there is no npm token
and no one-time password involved: npm trusts this repository's `release.yml` workflow directly
(trusted publishing, OIDC).

Nobody bumps the version or edits the changelog by hand in an ordinary pull request. Both are
derived from commit messages, which is why those follow
[Conventional Commits](../CONTRIBUTING.md#commit-messages-and-pull-request-titles).

## Cutting a release

1. Merge work into `main` as usual. After each merge, release-please opens a pull request named
   `chore(main): release X.Y.Z`, or updates the one that is already open. It holds the version
   bump in `package.json` and the new section of `CHANGELOG.md`. Every Conventional Commit type,
   including `docs:` and `chore:`, opens a release PR; CI rejects titles without a recognized type.
2. When you want to release, read that pull request. Check the version and the changelog, and
   edit the changelog if it needs it (see [The changelog](#the-changelog)). For the recovery PR
   only, remove `last-release-sha` from `release-please-config.json` as the final edit; new commits
   on `main` cause release-please to rebuild the branch.
3. The release pull request must pass both CI matrix checks and the release metadata validation.
   Merge only after they pass.

That merge is the release. Within a minute or two the version is tagged, on GitHub's release page,
and on npm. To watch it, and then check the result (see [Checking a release](#checking-a-release)):

```bash
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

There is no schedule. The release pull request can stay open for as long as you like while it
collects changes.

To run everything short of publishing against an existing tag, or to finish a release that
stopped half way:

```bash
gh workflow run release.yml -f tag=v0.3.1 -f mode=dry-run
gh workflow run release.yml -f tag=v0.3.1 -f mode=publish
```

Manual runs default to `dry-run`. That mode does the checks, the build and `npm publish --dry-run`,
which prints the list of files that would ship. It creates no GitHub release and does not call the
Homebrew workflow. Choose `publish` explicitly to publish an existing tag.

## What the workflow does

`release.yml` runs on every push to `main`, and by hand with a `tag` input. Most pushes only
reach the first stage.

| Stage          | What happens                                                                                                                                                                                                                               | Stops here when                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| release-please | Reads the commits since the last release and opens or updates the release pull request. If the push _was_ the merge of that pull request, creates the tag `vX.Y.Z` and the GitHub release instead, with the changelog section as its notes | The push was anything other than the release pull request being merged: there is nothing to publish |
| Check the tag  | Compares the tag with `package.json` and with `main`                                                                                                                                                                                       | The tag is not `vX.Y.Z`, differs from the version in `package.json`, or its commit is not on `main` |
| Check the code | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, on Node 24                                                                                                                                                  | Any of them fails                                                                                   |
| Publish to npm | `npm publish --access public --ignore-scripts`, with provenance                                                                                                                                                                            | npm refuses the publish. A version that is already on npm is skipped, not an error                  |
| GitHub release | Only for a tag made by hand: creates the release from the changelog section                                                                                                                                                                | The release already exists, which is the normal case                                                |
| Homebrew       | Calls `release-homebrew.yml`, which rewrites the formula in the tap                                                                                                                                                                        | Does nothing, and stays green, until a tap is set up. See [homebrew-tap.md](homebrew-tap.md)        |

Homebrew goes last because the formula needs the SHA256 of the tarball npm serves.

The GitHub release exists a minute before the npm version does, because release-please creates
it. If the later stages fail, the release page names a version npm does not have yet: fix the
cause and run the workflow by hand for that tag. Every stage can be re-run, and the ones that
already succeeded are skipped.

## How the version is chosen

release-please reads the commits on `main` since the last tag. The package follows
[semantic versioning](https://semver.org), and it is still `0.x`, where the minor number does the
work of a major one:

| Commits since the last release                                                         | Bump                               | Example                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `fix:`, `perf:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:`, or `style:` | patch                              | 0.2.0 to 0.2.1: any non-feature change                    |
| At least one `feat:`                                                                   | minor                              | 0.2.2 to 0.3.0: OpenCode and Gemini support               |
| A breaking change (`feat!:`, `fix!:`, or a `BREAKING CHANGE:` footer)                  | minor while `0.x`, major after 1.0 | 0.1.0 to 0.2.0: listening on loopback only, renamed flags |

Every pull request title must use a Conventional Commit type. All supported types appear in the
changelog, and non-feature types receive a patch bump, so each merge to `main` creates a release
pull request.

A pull request's title counts however it is merged. A squash makes the title the commit. A merge
commit gets the title in its body, where GitHub puts it, and release-please reads conventional
lines there too: that is how #6, whose only commit had no prefix, reached 0.4.0. The difference is
in what else counts. A merge commit also brings the pull request's own commits onto `main`, so
each conventional one among them gets a changelog line next to the title's. A squash leaves the
title alone, one line per pull request.

To force a particular version, for example to go to 1.0.0, put a `Release-As: 1.0.0` footer in
the body of a commit on `main`:

```bash
git commit --allow-empty -m "chore: release 1.0.0" -m "Release-As: 1.0.0"
```

**A version number is spent the moment it is tagged.** npm never lets a version be published
twice, and a tag others may have fetched should not move. If a released version turns out to be
wrong, fix it with a `fix:` commit and release the next patch. That is how 0.3.0 went: it was
tagged, never reached npm, and 0.3.1 carried its changes.

Pre-release versions (`1.0.0-beta.1`) are not supported yet: npm refuses to publish a pre-release
without a `--tag`, and the workflow does not pass one.

## The changelog

release-please writes each section of `CHANGELOG.md` from commit subjects: `feat:` commits go
under **Added**, `fix:` under **Fixed**, `perf:` and reverts under **Changed**, and breaking
changes get a section of their own at the top. The other types are left out. The section names are
set in `release-please-config.json`. Sections up to 0.3.1 were written by hand and stay as they
are.

A commit subject is rarely the best sentence for someone who uses the gateway. Two ways to do
better, both optional:

- **Before merging, edit `CHANGELOG.md` on the release pull request's branch.** Rewrite entries
  for users, group them, and credit outside contributors (`Thanks to @someone (#12).`). Do this
  last: release-please rebuilds the branch, and discards such edits, whenever something new lands
  on `main`.
- **Fix the source instead.** Edit the description of the _merged_ pull request the entry came
  from and add an override block. release-please uses it in place of the original commit message
  the next time it runs. This works for squash-merged pull requests only, which is one reason to
  prefer squashing:

  ```
  BEGIN_COMMIT_OVERRIDE
  feat: open the dashboard from any launcher with --dashboard
  END_COMMIT_OVERRIDE
  ```

The GitHub release notes are taken when the release pull request is merged, from what release-please
generated. To change them afterwards: `gh release edit vX.Y.Z --notes-file notes.md`.

## Checking a release

```bash
npm view jev-advisor-gateway version                 # the new version
npm view jev-advisor-gateway dist.attestations      # provenance is attached
gh release view v0.3.1                       # the notes
npm install -g jev-advisor-gateway && jev-codex --status
```

The package page on npmjs.com shows a provenance badge that links to the commit and to the
workflow run that built it.

## When something goes wrong

| Symptom                                                                                                      | Cause                                                                                                                                                                                           | Fix                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No release pull request appears after a merge                                                                | The pull request was not merged with a supported Conventional Commit title                                                                                                                      | Rename the merged PR with a supported prefix and re-run the workflow                                                                                                                                  |
| The release-please job fails with `GitHub Actions is not permitted to create or approve pull requests`       | The repository setting is off                                                                                                                                                                   | Turn it on: see [One-time setup on GitHub](#one-time-setup-on-github)                                                                                                                                 |
| CI does not run on the release pull request                                                                  | The `release-pr-ci` dispatch failed or the release PR was stale when it ran                                                                                                                     | Send another `repository_dispatch` for the current head SHA using the command below                                                                                                                   |
| Release metadata validation fails                                                                            | The package version, release manifest, changelog section, GitHub tag or npm version disagree                                                                                                    | Correct the release PR before merging. Never move a published tag or reuse an npm version                                                                                                             |
| Released changes sit under a `## Unreleased` heading in `CHANGELOG.md`                                       | Someone wrote changelog entries by hand in a pull request. release-please does not read them: it adds its own section below and leaves that heading where it was (this happened with 0.4.0)     | Move the text into the version's section, in a `docs:` commit, and delete the heading. Changelog entries come from commit messages; to word one better, see [The changelog](#the-changelog)           |
| The release pull request has merge conflicts                                                                 | `package.json` or `CHANGELOG.md` changed on `main` by hand                                                                                                                                      | Push anything to `main`, or re-run the workflow: release-please rebuilds the branch from `main`                                                                                                       |
| The version in the release pull request is not what you expected                                             | A commit has the wrong type, or a `!` that should not be there                                                                                                                                  | Correct it with an override block, or force the version with `Release-As:`                                                                                                                            |
| `Tag vX.Y.Z does not match package.json version`                                                             | Only with a tag made by hand, pushed without the version bump                                                                                                                                   | Nothing was published. Delete the tag (`git push origin :vX.Y.Z`, `git tag -d vX.Y.Z`) and release through the pull request                                                                           |
| Type check, tests or build fail in the publish job                                                           | `main` was not green when the release pull request was merged                                                                                                                                   | npm has nothing, but the tag and the GitHub release exist. Fix on `main` with a `fix:` commit and merge the next release pull request. Delete the orphaned GitHub release, or mark it as superseded   |
| The registry shows a `0.0.0-stage` version and `npm view jev-advisor-gateway version` returns it             | The publish was staged instead of published. Staged publishing parks the version for a 2FA approval and, for a name that does not exist yet, publishes that placeholder so the name is reserved | `npm stage list jev-advisor-gateway`, inspect it with `npm stage view <id>`, then `npm stage approve <id>` — or `npm stage reject <id>` and let the workflow publish the same version with provenance |
| `npm error 403 ... Granular access tokens that bypass two-factor authentication may not perform this action` | The credential in `~/.npmrc` is a 2FA-bypass token, and npm now demands an interactive 2FA challenge for account, package and trusted-publisher changes                                         | `npm logout`, `npm login` again, and repeat the command                                                                                                                                               |
| `npm error 404 Not Found - PUT https://registry.npmjs.org/<name>`                                            | The name does not exist on npm, so there is no trusted publisher to authorise the publish. npm answers 404, not 403, when a credential carries no permission for the name                       | Publish that version by hand once, then set up the publisher for the releases after it: see [One-time setup on npmjs.com](#one-time-setup-on-npmjscom)                                                |
| `npm error 403 ... OIDC permission denied for this action`                                                   | npm's trusted publisher setting does not match this repository and workflow file                                                                                                                | Compare the setting with [the table below](#one-time-setup-on-npmjscom), save it, and run the workflow by hand for the same tag                                                                       |
| Publish fails asking for a login or a token (`ENEEDAUTH`)                                                    | The job's npm is too old for trusted publishing, which needs 11.5.1 or later                                                                                                                    | Keep `node-version` in `release.yml` on a Node that ships such an npm (Node 24 does)                                                                                                                  |
| The GitHub release exists but npm does not have the version                                                  | The run stopped after release-please                                                                                                                                                            | Run the workflow by hand for the same tag                                                                                                                                                             |
| The Homebrew stage fails                                                                                     | See the troubleshooting table in [homebrew-tap.md](homebrew-tap.md)                                                                                                                             | npm and the GitHub release are already done. Re-run only that part with `gh workflow run release-homebrew.yml -f tag=vX.Y.Z`                                                                          |
| A broken version reached npm                                                                                 |                                                                                                                                                                                                 | Release a fixed patch version. To warn people off the broken one: `npm deprecate jev-advisor-gateway@X.Y.Z "reason"` (this one needs an owner's npm login, not the workflow)                          |

release-please tracks its own state in two places: `.release-please-manifest.json` holds the last
released version, and the merged release pull request carries an `autorelease: pending` label
until it is tagged, then `autorelease: tagged`. If a release was somehow made outside this flow,
set the manifest to that version in a `chore:` commit so the next release pull request starts from
the right place.

## One-time setup on GitHub

release-please uses the repository's `GITHUB_TOKEN`. GitHub does not start a `pull_request`
workflow from a PR created by that token, so `release.yml` sends a `repository_dispatch` event to
the trusted `release-pr-ci.yml` workflow on `main`. That workflow validates the release PR files
and metadata, runs checks against the unchanged `main` code, then reports the `ci` matrix checks
on the exact PR head SHA. Test jobs have read-only permissions; only the separate reporter job can
write check runs. No GitHub App or long-lived token is needed.

To retry the dispatched checks for an open release PR:

```bash
PR=11
gh api --method POST repos/1arley/jev-advisor-gateway/dispatches \
  -f event_type=release-pr-ci \
  -F "client_payload[release_pr_number]=$PR" \
  -f "client_payload[head_sha]=$(gh pr view "$PR" --json headRefOid --jq .headRefOid)" \
  -f "client_payload[base_sha]=$(gh pr view "$PR" --json baseRefOid --jq .baseRefOid)"
```

Allow Actions to create pull requests in **Settings → Actions → General → Workflow permissions**.
The default token permission stays read-only; jobs request their own permissions.

Require pull requests and the `ci` matrix checks `check (22.15)` and `check (24)` on `main`.
Release metadata validation runs before those checks. For example, branch protection can be set
with:

```bash
gh api --method PUT repos/1arley/jev-advisor-gateway/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["check (22.15)", "check (24)"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "restrictions": null
}
JSON
```

Keep both required contexts in sync if the CI matrix changes.

For the one-time recovery from the duplicate `0.10.1` release, the top-level
`last-release-sha` in `release-please-config.json` is temporarily set to
`964570800ae1dacca9a1530a72fa711f0e1a1381`. Remove that field from the recovery release PR before
merging it. The release then uses the correct commit range and future runs resume from the new tag.

## One-time setup on npmjs.com

Trusted publishing is switched on per package, by an owner, and only for a package that already
exists. npm cannot attach a publisher to a name nobody has published, and it answers an OIDC
publish for such a name with `404 Not Found - PUT https://registry.npmjs.org/<name>`. A brand new
name therefore takes one publish by hand first:

```bash
npm login                       # an owner's account, with 2FA enabled
npm publish --access public     # from a clean checkout of the version being released
```

That first version carries no provenance. Every release after it does, once the publisher is set
up. In the browser:

1. Open https://www.npmjs.com/package/jev-advisor-gateway/access and find **Trusted Publisher**.
2. Choose **GitHub Actions** and fill in:

   | Field                | Value                 |
   | -------------------- | --------------------- |
   | Organization or user | `1arley`              |
   | Repository           | `jev-advisor-gateway` |
   | Workflow filename    | `release.yml`         |
   | Environment name     | leave empty           |

3. Save. Then, on the same page under **Publishing access**, pick **Require two-factor
   authentication and disallow tokens**. After that the workflow is the only thing that can
   publish, and a leaked token is worth nothing.

The same setting from the terminal, with npm 11.15 or later and 2FA enabled on the account:

```bash
npm trust github --file release.yml --repo 1arley/jev-advisor-gateway --allow-publish
npm trust list jev-advisor-gateway    # what is configured right now
```

A publisher configuration that never completes a publish expires after two days, so set it up when
the next release is close rather than months ahead.

npm requires an interactive 2FA challenge to change a trusted publisher, so a granular access token
that bypasses 2FA cannot do it, by CLI or on the website. If the shell holds one, `npm logout` and
`npm login` first: the error is `Granular access tokens that bypass two-factor authentication may
not perform this action`.

npm matches the repository and the workflow file name exactly. Renaming `release.yml`, or moving
the `npm publish` step into a reusable workflow, breaks publishing until the setting is updated.

## Why it is built this way

- **No secrets to leak.** GitHub hands the job a short-lived identity token (`id-token: write`)
  and npm exchanges it for a one-off publish credential. Nothing long-lived exists to steal.
  release-please runs on the built-in `GITHUB_TOKEN` for the same reason, not on a personal
  access token.
- **One workflow file.** A tag or release created with `GITHUB_TOKEN` does not start other
  workflows, and npm only trusts a publish that comes from `release.yml`. So release-please is a
  job inside `release.yml` and hands its tag to the publish job directly, instead of living in a
  file of its own and triggering or calling this one.
- **Provenance for free.** Packages published this way carry a signed statement of which commit
  and which workflow run built them, shown on the npm page.
- **Scripts stay out of the publish step.** The checks and the build run first, and the publish
  itself uses `--ignore-scripts`, so no package script runs while the job holds the identity.
- **Actions are pinned to commit hashes**, so a moved tag in someone else's action cannot change
  what runs here. When updating one, replace the hash and keep the version in the trailing comment.
- **Only tags on `main` publish.** A tag on any other branch is refused.
- **Homebrew is called, not triggered**, for the same reason release-please lives in this file:
  `release-homebrew.yml` cannot listen for a release that a workflow created.
- **A person still decides when.** Merging the release pull request is a deliberate act, and the
  pull request shows exactly what will ship before it does.
