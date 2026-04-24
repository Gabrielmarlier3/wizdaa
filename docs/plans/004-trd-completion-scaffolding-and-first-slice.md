# Plan 004 — TRD §2/§8 completion, NestJS scaffolding, and first TDD slice (POST /requests)

## Context

After the foundation and discipline work (plans 001–003) and the voice
cleanup, the repo is ready for the first implementation round. All
TRD open questions are closed (§9 has 9 decision entries; §10 has 7
pointers and nothing unresolved). The user has approved:

- **TDD as methodology** — feature-level red-green-refactor, not
  per-line ceremony. Scaffolding is not TDD'd.
- **Persistence narrowed to low-level options** — `better-sqlite3`
  raw or Drizzle ORM (TypeORM / Prisma ruled out for hiding
  transaction boundaries under the concurrency-heavy domain).
- **First slice: `POST /requests`** — exercises DTO validation, state
  machine, balance projection, transactional hold, and idempotency in
  one feature; highest return on the first red-green-refactor.

Two TRD sections are still TBD and block productive TDD:

- **§2 Architecture overview** — soft-blocker. Without a sketch, the
  scaffolding folder layout becomes a guess.
- **§8 Testing strategy** — hard-blocker. TDD without a declared test
  strategy is improvisation; the brief weights tests heavily.

Sections §4–§7 stay TBD and evolve organically during implementation.

---

## Decisions locked before planning

### 1. ORM: Drizzle over `better-sqlite3` raw

Drizzle wins over raw `better-sqlite3` while preserving the
concurrency visibility the user explicitly asked for. Both run on top
of the synchronous `better-sqlite3` driver; the distinction is query
authoring and migrations, not transaction semantics.

- **Pros of Drizzle over raw:**
  TypeScript types on query results without handwriting them;
  `drizzle-kit` handles migrations vs rolling our own; the query DSL
  maps 1:1 to SQL so *what-runs* stays inspectable; transactions
  remain synchronous (`db.transaction(() => ...)`); the schema file
  is authoritative and diffable.
- **Cons:**
  extra dependency; DSL learning curve (minor — the mapping to SQL is
  close to literal).
- **Alternatives (already rejected earlier):**
  TypeORM — hides transaction scopes; Prisma — its own paradigm
  stitched onto Nest; raw `better-sqlite3` — loses type safety and
  migrations for no architectural win.

This is registered as a decision entry in TRD §9 during Phase B so
whoever reads the repo understands *why* this choice was made against
the more conventional NestJS options.

### 2. First TDD slice: `POST /requests`

Exercises the full vertical — DTO + state machine + balance
projection + transactional hold + idempotency — in one feature. Does
*not* touch HCM: per §9 *Approval commits locally; HCM push via
outbox*, HCM interaction enters in the approve slice. For `POST
/requests`, the local `balances` table holds the seeded HCM value
(written by tests directly; the HCM-driven batch intake lands in a
later slice).

### 3. Package manager: `npm`

Already in the allowlist in `.claude/settings.json`. No reason to
introduce pnpm or yarn.

---

## Phase A — TRD spec completion

### §2 Architecture overview

Lands as a compact section with an ASCII diagram and two paragraphs.

```
┌────────────────────────────────────────────────────────┐
│                   HTTP API (Nest)                      │
│   Controllers — validation, HTTP contract; no logic    │
└────────────────────────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────┐
│                    Use cases / services                │
│   Orchestrate domain + persistence + HCM client        │
└────────────────────────────────────────────────────────┘
             │               │               │
             ▼               ▼               ▼
┌──────────────────┐  ┌─────────────┐  ┌─────────────────┐
│ Domain           │  │ Persistence │  │ HCM integration │
│ Entities,        │  │ Drizzle     │  │ Client + outbox │
│ state machine,   │  │ schema,     │  │ + push worker   │
│ invariants       │  │ repos,      │  │ + batch intake  │
│                  │  │ migrations  │  │                 │
└──────────────────┘  └─────────────┘  └─────────────────┘
                             │
                             ▼
                       ┌───────────────┐
                       │ SQLite (WAL)  │
                       └───────────────┘
```

Nest modules:
- `TimeOffModule` — request lifecycle (create, approve, reject, cancel).
- `BalanceModule` — projection (`hcm − pendingReservations − approvedNotYetPushed`).
- `HcmModule` — client, outbox, push worker, batch intake.
- `DatabaseModule` — Drizzle setup, migration runner, connection.

Boundary rules:
- Controllers delegate to services immediately; no branching logic.
- Domain is framework-free (pure TS), imported by services.
- Persistence is behind repo interfaces; services never import Drizzle
  directly.
- HCM calls go through one client class; retry and idempotency live
  in the outbox worker.

### §8 Testing strategy

**Test pyramid.**

- **Unit (`*.spec.ts` next to source).** Pure domain: state machine
  transitions, balance-projection math, idempotency key comparison,
  custom validators. No Nest, no DB.
- **Integration (`test/integration/`).** Service + repos + real
  SQLite (temp-file DB, migrations run once per suite, tables
  truncated or rolled back per test). No HTTP, no HCM mock. Proves
  transactional correctness.
- **E2E (`test/e2e/`).** Full Nest app via `supertest` + real SQLite
  + standalone mock HCM (Express app under `scripts/hcm-mock/`
  started by a global Jest setup). Proves HTTP contract, retry loops,
  HCM failure handling, batch intake.

**Coverage targets.**

- Domain layer: **95 %+** (lines and branches).
- Services / use cases: **90 %+**.
- Controllers / DTOs: sampled, not targeted (types carry most of
  their correctness).
- Overall: reported via `npm run test:cov`; targets enforced in the
  README and visible in CI once it exists.

**Mock HCM lifecycle.**

- One process per e2e suite via Jest `globalSetup` / `globalTeardown`.
- `POST /test/reset` called at the start of each test to reset state.
- `POST /test/scenario` injects failure modes (force 500, force
  timeout, set balance, set inconsistency).

**TDD ordering per feature.**

1. Red: e2e test describing the user-observable outcome.
2. Red: unit tests for the domain invariants the feature protects.
3. Green: migration, entity, repo, service, controller — minimum to
   pass.
4. Red-green: edge cases (insufficient balance, duplicate, invalid
   input).
5. Refactor.

**Conventions.**

- Test names read as specifications: `it('rejects POST /requests
  when balance is insufficient')`. Not `it('works')`.
- Determinism: time frozen with `jest.useFakeTimers` or a clock port;
  UUIDs seeded.
- Fixtures: factory functions under `test/fixtures/`, not magic JSON.
- Concurrency tests actually interleave (parallel promises against
  the same row), not call a function twice in sequence.

---

## Phase B — NestJS scaffolding + tooling

Files created (no feature code yet; `npm test` passes with one sanity
test):

```
package.json                           scripts: start, start:dev, build, test,
                                        test:watch, test:cov, test:e2e, lint,
                                        typecheck, format, db:migrate
tsconfig.json, tsconfig.build.json     strict mode
nest-cli.json
.eslintrc.js, .prettierrc
jest.config.ts                         unit + integration projects
test/jest-e2e.config.ts                e2e project with globalSetup
drizzle.config.ts
src/main.ts                            bootstrap; global ValidationPipe
src/app.module.ts                      imports (empty initially)
src/database/
  schema.ts                            Drizzle schema (empty stub)
  connection.ts                        better-sqlite3 + drizzle wiring
  migrations/                          drizzle-kit output
src/database.module.ts
scripts/hcm-mock/
  package.json                         or shared root
  server.ts                            Express placeholder with /test/reset
test/helpers/                          fixtures, db-per-test utilities
README.md                              fill Quick start + Testing sections
```

**Drizzle specifics.**

- Driver: `better-sqlite3` (synchronous).
- Schema lives in `src/database/schema.ts`.
- Migrations generated by `drizzle-kit generate` and applied by a
  small runner at startup (and in test `globalSetup`).
- SQLite opened in WAL mode for concurrent readers; single writer is
  acceptable for the challenge scale.

**Commits for Phase B:**

1. `chore: bootstrap NestJS project`
2. `chore: configure Jest with unit, integration and e2e projects`
3. `chore: add Drizzle with better-sqlite3 and scaffold database module`
4. `chore: scaffold mock HCM server skeleton under scripts/hcm-mock`
5. `docs(trd): record Drizzle ORM decision`
6. `docs: fill README Quick start and Testing sections`

---

## Phase C — First TDD slice: `POST /requests`

**Scope.** Create a time-off request in `pending` state and reserve a
balance hold atomically. Cover:

- DTO validation for
  `{ employeeId, locationId, leaveType, startDate, endDate, days, clientRequestId }`.
- Idempotency: a duplicate POST with the same `clientRequestId`
  returns the same entity, does not create a second hold.
- Rejection with `409 Conflict` when
  `hcmBalance − pendingReservations − approvedNotYetPushed < days`.
- Atomic hold creation: request row and hold row inside one Drizzle
  `db.transaction(() => ...)`.

**HCM is not called** in this slice. Tests seed the `balances` table
directly. Batch intake and HCM calls land in later slices.

**TDD ordering.**

1. `test:e2e` — happy path: `POST /requests` with sufficient balance
   → `201` with a request id; subsequent `GET` (or a test helper
   query) shows the balance with the hold reducing available. Red.
2. `*.spec.ts` — unit tests for the state-machine constructor, the
   available-balance projection, and the idempotency-check function.
   Red.
3. Drizzle schema: `requests`, `holds`, `balances` tables +
   migration.
4. Repos (`RequestsRepository`, `HoldsRepository`, `BalancesRepository`).
5. `CreateRequestUseCase` wiring domain + repos + transaction.
6. `POST /requests` controller + `CreateRequestDto` + global
   `ValidationPipe`. Green.
7. `test:e2e` — duplicate POST with same `clientRequestId` returns
   same entity and does not create a second hold. Red → green.
8. `test:e2e` — insufficient balance returns `409` with a stable
   error body shape. Red → green.
9. Refactor: extract balance-projection to a pure domain function if
   the service is carrying it.

**Commits for Phase C** (one per logical red-green-refactor step;
roughly):

1. `test(e2e): add failing POST /requests happy-path spec`
2. `feat(database): add requests, holds, balances schema and migration`
3. `feat(domain): add request state machine and balance projection`
4. `feat(time-off): implement create-request use case`
5. `feat(time-off): wire POST /requests controller with DTO validation`
6. `test(e2e): cover duplicate clientRequestId returns same entity`
7. `test(e2e): cover insufficient balance returns 409`
8. `refactor(domain): extract balance projection to pure function`

If a commit ends up too small to stand alone, I'll fold it into the
next; the granularity serves the reader, not the ceremony.

---

## Files to touch (summary)

```
package.json, tsconfig.json, tsconfig.build.json,        (new)
nest-cli.json, .eslintrc.js, .prettierrc
jest.config.ts, test/jest-e2e.config.ts                  (new)
drizzle.config.ts                                        (new)
src/main.ts, src/app.module.ts, src/database.module.ts   (new)
src/database/schema.ts, src/database/connection.ts       (new)
src/database/migrations/**                               (new)
src/domain/**                                            (new — state machine, projection)
src/time-off/**                                          (new — module, controller, use case, dto)
scripts/hcm-mock/**                                      (new — Express placeholder)
test/helpers/**                                          (new — fixtures, db utilities)
test/integration/**                                      (new)
test/e2e/**                                              (new)
TRD.md                                                   (modified — §2, §8 filled; §9 gains Drizzle entry)
README.md                                                (modified — Quick start, Testing)
docs/plans/004-trd-completion-scaffolding-and-first-slice.md (new — archive after approval)
```

Note on plan archiving: per the convention established in `docs/plans/
README.md`, this plan gets ported to `docs/plans/004-...md` after
approval.

---

## Verification

**After Phase A.**

- `grep -c '^## ' TRD.md` returns 10 (structure unchanged).
- `grep -c '> TBD' TRD.md` drops by two — §2 and §8 are no longer
  TBD. §4, §5, §6, §7 still are (organic evolution).
- `grep -c '^> \*\*202' TRD.md` returns 10 — adds the Drizzle
  decision entry.

**After Phase B.**

- `npm install` completes without error.
- `npm run build` passes.
- `npm test` passes with at least one sanity test.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run db:migrate` applies the (empty) schema to a fresh DB.
- `node scripts/hcm-mock/server.ts` starts and responds to
  `GET /health`.

**After Phase C.**

- `npm run test:e2e` passes at least three e2e tests (happy path,
  idempotency, insufficient-balance).
- `npm run test:cov` shows domain layer ≥95 %, services ≥90 %.
- A direct inspection of the created request shows a matching hold
  row inside the same transaction (no orphan request, no orphan
  hold).

---

## Out of scope

- **Approval flow** (`POST /requests/:id/approve`). Next slice —
  introduces HCM client, outbox, push worker.
- **Rejection and cancellation flows.** Later slices.
- **HCM batch intake** (`POST /hcm/balances/batch`). Later slice.
- **Reconciliation / inconsistency detection.** Later slice.
- **Filling TRD §4–§7.** Evolves organically with each slice; not
  forced up front.
- **CI config.** No GitHub Actions yet — add when the test suite is
  richer and worth running on every push.
- **Slash-command additions to `.claude/`.** Still no concrete reuse
  case; per §10 (no speculative tooling).
