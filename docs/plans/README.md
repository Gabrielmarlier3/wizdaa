# Plans archive

This directory preserves the approved implementation plans that guided
each step of the project. Alongside the TRD (decisions) and the code
(execution), these plans show *how we chose* and *what we considered*.

## Naming

`NNN-<kebab-title>.md` where `NNN` is a zero-padded sequence number.

## Lifecycle

1. Planning happens inside Claude Code plan mode, producing a working
   plan file in `~/.claude/plans/`.
2. Once approved, a clean English copy is archived here with the next
   numeric prefix.
3. Supplementary materials (subagent analyses, cross-review output) are
   included inline as appendices so the evidence stays with the decision.

## Files

- `001-foundation-claude-multiagent-setup.md` — reconstruction of the
  plan that set up `INSTRUCTIONS.md` (English), `CLAUDE.md`, and the
  `.claude/` subagents and commands.
- `002-pre-bootstrap-scaffolding.md` — `.gitignore`, `README.md` and
  `TRD.md` skeletons, challenge brief handling.
- `003-open-questions-and-agentic-process.md` — resolution of the six
  TRD open questions via independent architect analysis, plus the
  agentic-process deliverables (this archive, `docs/process.md`,
  `docs/devlog.md`).
- `004-trd-completion-scaffolding-and-first-slice.md` — completion of
  TRD §2 and §8, NestJS + Drizzle scaffolding, and the first TDD
  slice (`POST /requests` with happy path, idempotency, and
  insufficient balance).
- `005-subagent-discipline-and-approve-slice.md` — subagent
  discipline formalised in CLAUDE.md and docs/process.md, and the
  approve slice (`POST /requests/:id/approve`) architect-briefed up
  front and reviewer-checked before push. Appendix A preserves the
  architect analysis in full.
- `006-reject-slice.md` — the reject slice
  (`POST /requests/:id/reject`). Small, pattern-adherent: no HCM
  interaction, no schema change, no TRD decision entry. Reviewer
  shipped it as-is with one cosmetic nit applied in the same plan.
  Appendix A preserves the architect brief.
- `007-cancel-slice.md` — the cancel slice
  (`POST /requests/:id/cancel`). Mechanical twin of reject with the
  terminal state swapped. Reviewer shipped as-is with three
  documentation-quality nits and no commits required. DRY
  extraction between reject and cancel explicitly deferred. Appendix
  A preserves the architect brief.
- `008-read-endpoints.md` — the read-endpoints slice: `GET
  /requests/:id` via TimeOffController and `GET /balance` via a new
  `BalanceModule`. Adds `BALANCE_NOT_FOUND` (404) to the error
  taxonomy and records decision 12 (GET /balance returns the full
  overlay breakdown, not a single available number). One reviewer
  should-fix applied inline. Appendix A preserves the architect
  brief.
- `009-outbox-worker.md` — the HCM outbox worker slice: an
  in-process `HcmOutboxWorker` polling `hcm_outbox` every 5s with
  exponential backoff (30s × 2^attempts, max 5 attempts) that
  drains rows left `failed_retryable` by transient HCM failures.
  Closes TRD §10 Q8. Records decision 13. Three reviewer
  should-fix applied in Phase B (symmetric terminal-state guards
  covering `failed_permanent`, `HcmOutboxRepository` moved from
  TimeOffModule to HcmModule, `JSON.parse` poison-payload
  isolation); one should-fix deferred (`NODE_ENV=test` auto-start
  guard — keeping the simpler form, see devlog). Deviations from
  the plan body (dropped 30-min cap, integration spec relocated
  to e2e, `maxWorkers: 1` on e2e config) captured in the
  session-10 devlog entry. Appendix A preserves the architect
  brief.
- `010-batch-intake-and-inconsistency-halt.md` — the HCM batch
  intake slice: `POST /hcm/balances/batch` accepts a full-corpus
  balance snapshot (upsert-and-delete in one tx); per-dimension
  conflict detection via the literal §3.5 predicate
  (`newHcmBalance − approvedNotYetPushed < 0`, pending holds
  excluded); a new `inconsistencies` table as current-state halt
  flag with auto-clear on the next clean batch; and an
  `ApproveRequestUseCase` precondition that raises
  `DIMENSION_INCONSISTENT` (409) when a flagged dimension is
  targeted. New `HcmIngressModule` sits as a third edge in the
  module graph to avoid a HcmModule ↔ TimeOffModule cycle.
  Closes TRD §10 Q9 and opens new Q11 (stranded pendings on
  deleted dimensions). Four reviewer should-fix applied in Phase
  B (JSON-encoded composite keys in `deleteNotInSet` to close a
  delimiter-collision risk, ghost-inconsistency sweep for dropped
  dimensions, e2e halt spec decoupled from the mock's
  transient-failure path, and TRD §3.3 notes the empty-batch
  rejection policy); three nits deferred. Records decision 14.
  Appendix A preserves the architect brief.
- `011-readme-and-coverage-polish.md` — documentation + proof-
  of-coverage slice. Ships `docs/coverage.md` as the brief's
  named "proof of coverage" deliverable, refreshes README
  topic-by-topic (overview, env vars, project structure, API
  reference for all eight endpoints, agentic-process artefact
  index, testing + §15 scenario map), and closes a real §15 gap
  by adding the missing `forceTimeout` e2e spec. Phase B
  applied three reviewer should-fix: a real bug fix
  (`create-request.use-case.ts` was using a hard-coded
  `approvedNotYetPushedDays = 0` placeholder that had outlived
  its slice), an honest rewrite of the false "≥ 83 % combined
  lines" claim in coverage.md, and a correction to the README's
  Appendix-A wording for plans 001–004 / 011. Documentation-only
  slice — no architect brief (subagent discipline's
  disciplined-exception clause; reviewer still ran).

## Relationship to `TRD.md`

Plans describe *what we will do and why*. The TRD's Decision log
(`TRD.md` §9) records *what was decided*, authoritatively. When the two
disagree, the TRD wins — plans are historical snapshots, the TRD is
living.
