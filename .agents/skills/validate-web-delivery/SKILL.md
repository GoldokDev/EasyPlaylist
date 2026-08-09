---
name: validate-web-delivery
description: Validate this repository's EasyPlaylist delivery with targeted tests, TypeScript checks, PostgreSQL migrations, Docker healthchecks, real API and realtime smoke paths, browser inspection, secret checks, and recorded evidence. Use after changing code, dependencies, contracts, migrations, Docker configuration, OAuth/provider integrations, realtime behavior, or UI, and before marking a backlog item done. Do not use as a substitute for missing acceptance criteria.
---

# Validate a web delivery

Produce evidence proportional to the change. A successful process start or mock response is not sufficient evidence of correct behavior.

## Establish scope

1. Read `AGENTS.md`, the affected backlog item, and `Docs/project/development-process.md`.
2. Inspect the diff and list changed contracts, rules, routes, events, migrations, services, provider capabilities and visual states.
3. Map each affected acceptance criterion to a concrete check.
4. Read actual scripts from `package.json`, Compose services from `compose.yaml` and repository test documentation. Do not invent a passing command or result when a harness is absent.

## Run static and automated checks

1. Run formatting verification, lint and TypeScript checks for affected workspaces.
2. Run targeted unit and integration tests, then the repository's full fast suite.
3. Build affected packages and production images.
4. Run contract tests for every affected provider adapter.
5. Treat type errors, unhandled rejections, flaky ordering, leaked secrets, open handles, migration drift and unexpected warnings as failures.

Prefer the repository's root commands:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:failure-probe:verify
npm run test:postgres
npm run build
docker compose config
docker compose build
npm run e2e
```

`npm run test:failure-probe` is deliberately red and must return a non-zero code; its `:verify` wrapper proves that behavior while returning zero. `test:postgres` and `e2e` create isolated Compose projects and remove their volumes. Use only commands that really exist.

## Validate PostgreSQL and Docker

1. Validate Compose interpolation with no production secret.
2. Start from an isolated test volume or database whose exact target has been verified.
3. Apply migrations to a blank database and run the relevant upgrade path.
4. Start services, wait for declared healthchecks and inspect API, web and database logs.
5. Exercise liveness separately from readiness and prove database failure affects readiness.
6. Stop the validation stack after checks. Preserve logs needed as evidence without preserving credentials.

Never delete or reset a developer database unless the user explicitly authorizes the exact target. Prefer isolated disposable test data.

## Exercise API and realtime behavior

1. Use the running stack, not imported handlers alone.
2. Execute the primary success path and at least one relevant authorization, validation, timeout or conflict path.
3. For queue changes, test duplicate commands, concurrent versions and reconnection snapshots.
4. For player changes, test lease exclusivity, expiry and replayed commands.
5. For provider changes, run the fake contract suite and a separate real test when the criterion requires it.
6. Inspect logs after important transitions and verify sensitive headers, cookies, codes and tokens are redacted.

## Inspect the interface

1. Launch the narrowest Playwright or browser path that covers the changed screen.
2. Check at least the relevant mobile viewport and a desktop/player viewport when affected.
3. Inspect browser console and network failures.
4. Exercise keyboard focus, loading, empty, error, reconnecting and permission states relevant to the change.
5. Capture stable screenshots in `artifacts/validation/` for changed visual states.
6. Open and inspect every screenshot for clipping, hierarchy, contrast, focus, stale state and whether it proves the claimed criterion.

If the browser or capture harness is missing, report the visual proof as missing and leave visual criteria in `VERIFY`.

## Decide and record

1. Link every result to an acceptance criterion.
2. Fix clear in-scope regressions, then rerun failed layers.
3. Append a `PASS`, `FAIL` or `PARTIAL` entry to `Docs/project/validation-log.md` with exact environment, commands, codes, paths and inspected captures.
4. Mark the backlog item `DONE` only when all criteria pass; otherwise use `VERIFY` or keep `IN_PROGRESS`.
5. Report reproduction steps for failures and the smallest next action.
