---
name: deliver-backlog-item
description: Deliver one ready item from this repository's EasyPlaylist backlog from intake through tested web delivery. Use when asked to take the next backlog item, implement a named backlog ID, continue autonomous development, complete a discovery item, or deliver a vertical slice. Do not use for read-only explanations, brainstorming without backlog changes, or reprioritization without delivery.
---

# Deliver a backlog item

Deliver one item completely. Keep the Docker environment runnable and synchronize product, architecture, decisions, backlog, and validation evidence.

## Select the item

1. Read `AGENTS.md`, `Docs/README.md`, `Docs/project/backlog.md`, and `Docs/project/decision-log.md`.
2. Accept an explicit item ID, or choose the first `READY` item by priority and document order.
3. If the item is `TODO` or `BLOCKED`, verify dependencies. Do not bypass an unfinished dependency; report the prerequisite.
4. Confirm that no other item is `IN_PROGRESS`. Resume it unless the user explicitly changes priority.
5. Change the selected item to `IN_PROGRESS` before implementation or research.

## Frame the delivery

1. Read every product and architecture document linked by the item.
2. Map every acceptance criterion to a task and a verification artifact.
3. Inspect the working tree and preserve unrelated changes.
4. Make only small, reversible assumptions within `Docs/project/development-process.md`.
5. Add a decision entry for any durable change to product, data, security, architecture, provider scope, dependency, deployment, or retention.
6. Ask the user only when a decision crosses the documented autonomy boundary.

For a discovery item, produce current, decision-ready evidence. Use official primary sources for provider and framework claims, add URLs and verification dates, and distinguish facts from recommendations.

## Implement

1. Build the smallest vertical path through contracts, domain, persistence, API, real-time events and UI required by the item.
2. Follow `Docs/architecture/technical-design.md` and `Docs/architecture/provider-model.md`.
3. Keep provider SDK objects and ORM models outside the shared domain and public DTOs.
4. Validate every external boundary and authorize every lobby-scoped action.
5. Keep credentials server-side, encrypted at rest and filtered from logs.
6. Make reconnectable mutations idempotent and server-authoritative.
7. Add tests alongside each rule and regression, including relevant failure paths.
8. Create a separate backlog item for independent discoveries; do not absorb scope silently.

## Verify

1. Invoke `$validate-web-delivery` for the affected scope.
2. Fix in-scope failures and repeat validation until evidence is clean.
3. Compare actual behavior to each acceptance criterion, not only to successful builds.
4. Inspect generated captures, browser console output, service logs and migration results.
5. Never use a fake-provider pass as proof of a real-provider criterion.

## Close the item

1. Update product, architecture and contracts when behavior or schemas changed.
2. Append decisions without deleting superseded history.
3. Record commands, environment, paths, logs, captures and criterion mapping in `Docs/project/validation-log.md`.
4. Set `DONE` only when every criterion has evidence. Use `VERIFY` when implementation exists but a proof is missing.
5. Re-evaluate dependencies and promote newly eligible items to `READY`.
6. Report the user-visible outcome, important files, validation evidence, remaining risks and exact next `READY` item.

Never commit, push, deploy, publish, add a paid service, register an OAuth application or contact a provider unless the user explicitly asks.
