# Time-Off Microservice

NestJS + SQLite microservice for time-off requests, with defensive sync against
an external HCM system. Core engineering concern: **balance consistency,
concurrency, idempotency, and resilience to external changes** — not simple CRUD.

## Canonical briefing

`INSTRUCTIONS.md` at the repo root is the source of truth for scope, rules,
priorities, and definition-of-done. Read it before any non-trivial change.
Do not restate its rules here — consult it.

## Stack

- Runtime: Node.js (LTS)
- Framework: NestJS
- Persistence: SQLite
- Tests: Jest (unit + integration + e2e)
- Language: TypeScript

## Project layout (once bootstrapped)

- `src/` — application code (modules, services, controllers, DTOs, entities)
- `src/modules/<domain>/` — one folder per bounded concept (e.g. `time-off`,
  `balance`, `hcm-sync`)
- `test/` — integration and e2e tests
- `*.spec.ts` next to source — unit tests
- `scripts/` — local dev helpers, HCM mock entrypoint

## Common commands (filled as the project is bootstrapped)

- `npm install` — install dependencies
- `npm run start:dev` — dev server with watch
- `npm test` — unit tests
- `npm run test:e2e` — end-to-end tests
- `npm run lint` — eslint
- `npm run typecheck` — `tsc --noEmit`

## Working mode

Follow the cycle in `INSTRUCTIONS.md` §6 and §19: confirm objective → minimum
scope → risks → incremental plan → implement → validate → update docs.

## Subagents (multi-agent mode from §7)

Invoke via `Agent(subagent_type=<name>)` when the task fits:

- `architect` — scoping, flow modelling, consistency risk analysis (read-only)
- `domain-data` — entities, state transitions, balance invariants
- `api-contract` — endpoints, DTOs, HTTP contract, error taxonomy
- `sync-integration` — HCM client, realtime/batch sync, idempotency, mock
- `test-qa` — test strategy, concurrency and regression coverage
- `reviewer` — clarity review, hidden-risk surfacing (read-only)

## Hard guardrails (distilled from INSTRUCTIONS.md)

- Never trust HCM blindly — validate defensively (§8.3).
- Any balance- or state-changing operation must be designed for concurrency,
  duplication, reprocessing, late sync, and partial failure (§8.4).
- Do not introduce dependencies, abstractions, or infra without concrete need
  (§5, §10).
- Tests protect rules, flows, or real risks — never write tests for coverage
  inflation (§15).
- Controllers stay thin; business logic lives in services/use-cases (§12).

## Subagent discipline

Every feature slice must exercise at least two subagents:

- `architect` **before planning**. Its output (scope, flow, risks, ordered
  TDD steps) is inlined or appended to the archived plan. Plans without an
  architect briefing are incomplete (see `docs/process.md` plan template).
- `reviewer` **before push**. Findings are triaged as *blocking* /
  *should fix* / *nit* and either resolved or explicitly deferred in
  `docs/devlog.md`.

Other subagents (`domain-data`, `api-contract`, `sync-integration`,
`test-qa`) are invoked when the slice touches their scope — as specialised
review, not ceremony.

## Language

All code, docs, comments, commit messages, and PR descriptions are written in
**English**. User-facing chat may be Portuguese.
