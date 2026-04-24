# Development log

Chronological narrative of working sessions. One entry per session,
intentionally brief — the detail lives in `docs/plans/`, `TRD.md`, and
the commit history.

---

## 2026-04-23 — Session 1: foundation

Started from an empty repo with only `INSTRUCTIONS.md` (Portuguese).
Planned and executed the AI-development foundation: translated
`INSTRUCTIONS.md` to English in place, preserving the 24-section
structure so subagent prompts can reference `§X` reliably. Created
`CLAUDE.md` as a concise operational briefing that *points to*
`INSTRUCTIONS.md` for rules (no duplication, no drift). Scaffolded six
subagents in `.claude/agents/` with `architect` and `reviewer` as
read-only roles, two slash commands in `.claude/commands/`, and a
permissions allowlist in `.claude/settings.json`.

Commits: `4b1e766`, `32bcb6b`. Plan archive:
`docs/plans/001-foundation-claude-multiagent-setup.md`.

## 2026-04-23 — Session 1b: local-only scratch space

Set up `notes/` as a local-only workspace excluded via
`.git/info/exclude` — not via `.gitignore` — so neither the ignored
folder nor the exclusion itself leaves any trace on the public repo.
Intended for private references, brainstorms, and unpublished drafts.

## 2026-04-24 — Session 2: pre-bootstrap scaffolding

Before any NestJS scaffolding could land, three gaps had to close:
`.gitignore` (Node + SQLite + IDE folders), `README.md` skeleton, and
`TRD.md` skeleton (ADR-lite with a Decision log as the traceability
anchor required by §8.5). The take-home PDF was placed in `notes/`
by the user — a signal that the brief should not surface on
the public repo. A faithful Markdown transcription was saved as
`notes/CHALLENGE.md`; the public `TRD.md` §1 describes the problem in
our own words. The first Decision log entry recorded this choice.

Commits: `8058534`, `76375d9`, `241ee69`. Plan archive:
`docs/plans/002-pre-bootstrap-scaffolding.md`.

## 2026-04-24 — Session 3: resolving open questions, agentic process as deliverable

Six open questions in `TRD.md` §9 blocked any further design. Since
AI-first mastery is the brief's primary measurement axis, the chosen
strategy was cross-validation: launch the `architect` subagent in the
background with a deliberately bias-free prompt so its first-principles
analysis would be independent of the lead's prior opinion. Both voices
were synthesized in the plan. The architect's positions prevailed on
five of six questions (reservation at creation as a two-state ledger;
async approval push via durable outbox; batch preserves local holds and
halts on conflict; `leaveType` as a third balance dimension; Express
mock under `scripts/hcm-mock/`); the sixth resolved as *both* since the
two proposals addressed different scopes (client UUID for request
dedup, service UUID for HCM push dedup). The architect also surfaced
three risks absent from §9: cancellation semantics, batch direction
confirmation, and clock/timezone authority.

The plan also formalized the agentic process itself as a deliverable:
`docs/plans/` with the full architect analysis as an appendix to plan
003, `docs/process.md` documenting the subagents and workflow, this
`docs/devlog.md` narrating the sessions, historical plans 001 and 002
ported in English (001 reconstructed from conversation memory since
the original plan file had been overwritten before archiving was a
practice).

Commits (Phase A): `01942ea`, `7ad5d11`. Phase B (TRD contract + seven
decision entries) and remaining Phase C follow. Plan archive:
`docs/plans/003-open-questions-and-agentic-process.md`.

## 2026-04-24 — Session 4: NestJS scaffolding and first TDD slice

Executed plan 004 end-to-end:

Phase A filled `TRD.md` §2 (architecture overview with ASCII
diagram, four Nest modules, boundary rules) and §8 (test pyramid,
coverage targets, mock HCM lifecycle, TDD ordering, critical
scenarios). Phase B hand-crafted the NestJS project without the CLI
hello-world: package.json, strict tsconfig (ES2022 for drizzle-kit
compatibility), Jest with unit + e2e configs, Drizzle + better-sqlite3
with a DatabaseModule and migration runner, and the mock HCM
skeleton under `scripts/hcm-mock/`. Phase C took the `POST /requests`
slice through a red-green-refactor loop:

1. Failing e2e spec drove the entire slice.
2. Schema + migration landed the three tables (`balances`, `requests`,
   `holds`).
3. Domain layer (pure functions: `createPendingRequest`, balance
   projection) landed with unit specs covering the happy path,
   domain rejections, and the exact-boundary projection cases.
4. Repositories and `CreateRequestUseCase` wired the transactional
   hold creation via `db.transaction(() => ...)` — synchronous by
   construction per the Drizzle-over-better-sqlite3 decision.
5. Controller + DTO + `TimeOffModule` made the e2e pass.
6. Two more e2e tests covered idempotency (duplicate
   `clientRequestId` returns the same request, no second hold) and
   insufficient balance (→ 409 with `{code, message}` body).

The plan reserved a final `refactor(domain)` commit for extracting
balance projection to a pure function; this was already done during
initial implementation, so the refactor commit was skipped rather
than manufactured for show.

TRD §9 gained the Drizzle ORM decision entry with TypeORM / Prisma /
raw alternatives explicitly rejected.

Commits (selected): `9fd9c71` (TRD §2/§8), `3040f8b`, `17cc746`,
`140ccc0`, `d905f4f`, `bf90176`, `db32f7c` (Phase B), `fa54d05`,
`3a566c8`, `0df2f4a`, `f5c7ad9`, `96d3ce1`, `d82a7ed`, `47c869b`
(Phase C). Plan archive:
`docs/plans/004-trd-completion-scaffolding-and-first-slice.md`.

## 2026-04-24 — Session 5: pre-push review and followups

Ran the `reviewer` subagent on the 17 local commits before pushing —
the first use of a subagent during plan 004's execution (the plan
itself ran as a monolith, contradicting the discipline documented in
`docs/process.md`). The review surfaced one silently-weakening bug
and one boundary rot that would have compounded, plus a handful of
smaller fixes.

Findings applied as four commits:

- `fix(time-off)`: the read-validate-insert sequence (idempotency
  lookup, balance read, hold sum, inserts) now runs inside one
  `db.transaction(...)`. Today this works because better-sqlite3
  is synchronous and the event loop serializes `execute()`, but any
  `await` inside the use case would silently break the balance
  check. The UNIQUE-constraint race on `client_request_id` is also
  caught and recovered idempotently instead of bubbling as 500.
- `refactor(domain)`: `RequestStatus` and `requestStatusValues`
  moved from `src/database/schema.ts` into `src/domain/request.ts`.
  Schema now imports from domain — the dependency direction matches
  TRD §2.
- `chore`: `app.enableShutdownHooks()` so the SQLite client closes
  on SIGTERM; `InvalidDimensionError` → 422 per TRD §3.2;
  speculative `BalancesRepository.upsert` removed (§8.7, §10);
  coverage-only `app.module.spec.ts` removed (§15); devlog softened
  the "100% unit coverage" claim that had no anchored snapshot.
- `chore(test)`: mock HCM started / stopped by Jest `globalSetup`
  and `globalTeardown`; `jest.config.ts` now splits unit and
  integration as projects, matching the pyramid in TRD §8.

Lesson: cross-review is load-bearing for this repo's evaluation
story. The next slice (`POST /requests/:id/approve`) invokes the
architect at plan time and the reviewer before push by default.

Commits: `dec27f1`, `9d949a3`, `1c2da27`, `299d850`.

## 2026-04-24 — Session 6: subagent discipline + approve slice

Plan 005 executed end-to-end under the discipline it formalises.

**Phase A (2 commits).** Moved the subagent rule into CLAUDE.md so
it is auto-loaded every turn, and added a Plan template section to
docs/process.md making the Architect briefing a required section
of every archived plan. The two documents now agree.

**Phase B (15 commits).** The approve slice (`POST /requests/:id/
approve`). Architect subagent ran first on `opus` with a bias-free
prompt; its brief is Appendix A of plan 005. TDD ordering followed
the brief: red e2e → schema + migration (hcm_outbox,
approved_deductions, requests.hcm_sync_status) → domain transition
+ InvalidTransitionError → repositories (approve with
UPDATE-WHERE-status fence, delete hold, insert deduction, insert
outbox) → HcmClient (fetch + 2s AbortController + discriminated
outcome) → mock HCM extended with /balance/mutations and
scenario-injection → ApproveRequestUseCase (one tx for commit, a
second tx for post-push resolution) → controller wiring (happy
path green) → e2e coverage of transient failure, permanent failure,
concurrent approve, idempotent replay → integration test for
approval-time balance re-check → mock-contract test for
Idempotency-Key dedup → TRD §4 / §5 / §7 filled, §9 decision #11
recorded, §10 reorganised with three new open questions.

**Phase C (5 commits).** Reviewer subagent ran on the full slice
diff. No blocking finding; six should-fix items applied as focused
followups:
- fix(time-off): concurrency-fence branches re-read the row to
  report the honest currentStatus instead of hard-coding
  'approved'; logger calls moved past the resolution tx so they
  cannot describe state a rollback undid.
- fix(hcm-mock): replays terminal 4xx outcomes idempotently, not
  just 2xx — contract test added to pin the behaviour.
- test(e2e): covers the `forceBadShape` path (R5) that had
  defensive code but no spec.
- test(integration): covers InvalidDimensionError at approval
  time (the TRD §7 entry previously documented without a backing
  spec).
- docs(time-off): pins the holds-lifecycle invariant in a JSDoc so
  a future slice that retains a hold post-transition surfaces the
  need to tighten the sum query instead of silently over-counting.

Two subagents used by design this session — architect pre-plan
and reviewer pre-push — matching the CLAUDE.md rule this same
session landed. 21 unit/integration + 13 e2e tests green.

Commits (selected): `842d719`, `22c8004` (Phase A); `8eb4370`
through `4ec127d` (Phase B, 15 commits); `65765cf`, `f126a1f`,
`8beca28`, `7955a6d`, `31d9eac` (Phase C followups). Plan archive:
`docs/plans/005-subagent-discipline-and-approve-slice.md`.

## 2026-04-24 — Session 7: reject slice

Plan 006 executed end-to-end under the formalised discipline.

**Phase A (7 commits, architect-briefed).** The architect subagent
(sonnet this time — smaller slice, smaller model) confirmed the
architectural picture: no HCM interaction on reject, no outbox, no
schema change, single-transaction flow, hcmSyncStatus stays
`not_required`. TDD order mirrored the approve slice structurally:
red e2e → domain transition + unit specs → repository method →
use case → controller wiring (happy path green) → reject-after-
approve + unknown-id e2e → concurrent-reject integration.

**Phase B (reviewer pre-push, 1 commit).** Reviewer (sonnet)
verdict: ship as-is. Zero blocking, zero should-fix, one nit —
`RequestNotFoundError` lived inside `approve-request.use-case.ts`
and was imported from there by reject, creating a soft coupling
that would compound with the next (cancel) slice. Lifted to
`src/time-off/errors.ts` as a single-commit refactor; three import
sites updated. The nit landing now instead of the next slice is a
deliberate micro-investment — prevents rework mid-cancel.

**Phase C (wrap).** This entry + plan 006 archive.

28 unit/integration + 16 e2e (out of 44 tests total) green. No TRD
changes — reject exercises existing §9 decisions without introducing
a new architectural choice. §10 open questions unchanged.

Commits: `f2f3bfb`, `f5fe41e`, `fb5629d`, `11516bb`, `b5b1676`,
`c36d2c0`, `d583717` (Phase A); `5a97bbf` (Phase B). Plan archive:
`docs/plans/006-reject-slice.md`.

## 2026-04-24 — Session 8: cancel slice

Plan 007 executed end-to-end. Cancel is the mechanical twin of
reject — same single-transaction flow, same concurrency fence, no
HCM interaction — with `cancelled` replacing `rejected` as the
terminal state and Employee replacing Manager as the nominal actor
(TRD §9 *Cancellation is a distinct terminal state from
rejection*).

**Phase A (7 commits, architect-briefed).** The architect (sonnet)
confirmed: no schema change, no TRD decision entry, no new
machinery. The slice exercises the §9 decision that had been
sitting in the TRD since plan 005 without an executing path. TDD
order mirrored plan 006 exactly: failing e2e → domain transition
with 6 unit specs → repo method → use case → controller + module
wire → cancel-after-approve + unknown-id e2e → concurrent-cancel
integration.

**Phase B (reviewer pre-push, 0 commits).** Reviewer (sonnet)
verdict: ship as-is. One finding started, then self-retracted
during the review itself — the reviewer wrote a "should fix" about
`cancel` controller method not being async, then corrected
themselves in the same entry after re-reading and confirming
parity with reject. Three nits landed, all documentation-quality
observations that do not warrant a commit. The DRY-pressure check
explicitly reaffirmed the deferral: `RejectRequestUseCase` and
`CancelRequestUseCase` are now byte-for-byte identical except for
the literal `'rejected'` / `'cancelled'`, but two clear files beat
one generic file with a mode parameter. Extraction waits for a
third genuinely-same-shape transition or reviewer pressure that
isn't defensively deferred.

**Phase C (wrap).** This entry + plan 007 archive.

35 unit/integration + 19 e2e (54 total) green. TRD unchanged
(§10 sections, 11 decision entries). No theater-language audit
regressions.

Lifecycle is now complete at the HTTP level: create, approve,
reject, cancel. The remaining slices in the brief are HCM batch
intake (the big one), read endpoints (GET /balance, GET
/requests/:id), and the outbox worker for resilience.

Commits: `889ef27`, `1134759`, `ee8a009`, `2090769`, `ccf0fb9`,
`3c77082`, `8f73941` (Phase A). Plan archive:
`docs/plans/007-cancel-slice.md`.

## 2026-04-24 — Session 9: read endpoints

Plan 008 executed end-to-end. Two GET endpoints closing the write
lifecycle's asymmetry — the Employee persona's "see accurate
balance" need and the reconciliation-after-409 pattern both now
have an HTTP surface.

**Phase A (7 commits, architect-briefed).** The architect (sonnet)
took defensible positions on every design point: the four-field
overlay breakdown (not a single `available` number), separate
use cases over inline controller logic, a new `BALANCE_NOT_FOUND`
(404) code instead of overloading `INVALID_DIMENSION` (422),
non-transactional reads (best-current-view, not snapshot), and a
new `BalanceModule` matching TRD §2. TDD order: failing e2e →
use case + unit specs → controller wire → e2e green, repeated per
endpoint, plus a TRD-update commit.

The one genuine structural decision was the BalanceModule vs
"BalanceController inside TimeOffModule" tradeoff. The user
explicitly preferred the separate module before execution started,
so `src/balance/` now exists and `TimeOffModule` exports the three
overlay-projection repos (`BalancesRepository`, `HoldsRepository`,
`ApprovedDeductionsRepository`) without duplicate provider
instances.

One mid-execution fix: the balance e2e originally drove its
`approvedNotYetPushedDays` fixture through the real approve flow
with the mock HCM's `force500` scenario. This raced with approve
specs running in parallel test files against the same singleton
mock. Refactored to seed the overlay ledger rows directly against
the DB — cleaner isolation and independent of any write path.

**Phase B (reviewer, 1 commit).** Reviewer (sonnet) verdict: ship
as-is. One should-fix (trivial: outbox seed row using
`failed_retryable` where `pending` was simpler and better
expressed the test's intent) + four nits (one applied: method
name `read` → `get` for consistency with TimeOffController; three
deferred as documented observations). Single followup commit
applied both.

**Phase C (wrap).** This entry + plan 008 archive.

43 unit/integration + 24 e2e (67 total) green. TRD: 10 sections
unchanged, 12 decision entries (+1: GET /balance response shape),
§7 error taxonomy gains `BALANCE_NOT_FOUND`.

Request lifecycle endpoints complete: create, approve, reject,
cancel, GET-by-id, GET-balance. Remaining named in plan 005 TRD
§10 / architect briefs: HCM batch intake (large), outbox worker
(medium), `inconsistency`-surface endpoint (small, paired with
batch).

Commits: `de79c59`, `4320a6f`, `1815309`, `38fcfcc`, `893f57b`,
`ecf157e`, `39bf508` (Phase A); `1b9e783` (Phase B). Plan archive:
`docs/plans/008-read-endpoints.md`.
