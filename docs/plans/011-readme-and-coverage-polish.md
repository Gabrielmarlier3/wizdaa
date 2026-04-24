# Plan 011 — README refresh + proof of coverage

## Context

The functional scope of the challenge is complete: 8 endpoints,
outbox worker with retries, batch intake with conflict detection,
mock HCM, 122 green tests, TRD with 14 decisions across 10
sections. What a first-time reviewer would see at `git clone`
still understates that work:

- `README.md` opens with `> TBD: one-paragraph overview once the
  first slice lands.` (resíduo do plan 002).
- `README.md` Project structure lists only `main.ts`,
  `app.module.ts`, and `database/` — ignores `time-off/`,
  `balance/`, `hcm/`, `hcm/repositories/`, and `domain/`.
- No API reference — the reviewer has to read source to know
  what to call.
- No env var coverage for `HCM_BASE_URL`, `HCM_TIMEOUT_MS`,
  `HCM_MOCK_URL`, `NODE_ENV`.
- No pointer to the agentic-process artifacts under `docs/plans/`
  or `docs/devlog.md` — the reviewer misses that eleven slices
  went through architect + reviewer subagent discipline.

The brief also explicitly names `proof of coverage` as a
deliverable ("Your TRD, your code in a repository on github, your
test cases and **proof of coverage**"). `npm run test:cov` is
configured but no artefact lives in the repo, and the TRD §8
targets (≥95% domain, ≥90% services) have never been checked
against reality.

This slice closes both gaps in one go. No new endpoints, no new
tables, no TRD drift. It is a documentation + coverage-artefact
slice.

## Decisions locked before planning

1. **Coverage artefact: a single markdown file** committed to
   `docs/coverage.md` with the Jest `text-summary` output pasted
   verbatim plus git SHA and timestamp. HTML / lcov output stays
   out of git (keep `coverage/` in `.gitignore` for the raw
   output; only the curated markdown is tracked).
2. **Both unit+integration and e2e** contribute to coverage. Add
   a `test:cov:e2e` script and a combined `docs/coverage.md` with
   both summaries so the reviewer sees everything.
3. **README gets six focused edits** rather than one mega-rewrite
   so the diff is reviewable by topic.
4. **No TRD changes** unless the coverage run surfaces a real
   drift (e.g. §8 targets unreachable and need renegotiation).
   If that happens, add a §9 decision entry documenting the
   adjustment.
5. **Broad theater-language audit** already run before planning
   — `grep -rniE '\b(examiner|grader|evaluator|avaliador)\b'`
   across every tracked `.md` / `.ts` / `.json` returned zero
   matches. Plan 011 preserves that.

## Phase A — Implementation (6-7 commits)

### A1. `chore: generate coverage baseline and commit docs/coverage.md`

- Add `test:cov:e2e` script to `package.json`:
  `jest --config ./test/jest-e2e.config.ts --coverage`.
- Run `npm run test:cov` and `npm run test:cov:e2e`, capture the
  `text-summary` tables.
- Create `docs/coverage.md` with:
  - Header: git SHA, date, Node/Jest versions.
  - Unit+integration summary table.
  - E2E summary table.
  - A short "how to regenerate" paragraph pointing at the two
    scripts.
- If domain falls below 95% or services below 90%, **stop and
  reassess** before proceeding — either add a targeted test (A1
  gains a spec) or adjust the TRD §8 target with a §9 decision.
  Do not silently lower the bar.

### A2. `docs(readme): replace TBD with a real overview; refresh stack`

- Remove the `> TBD: one-paragraph overview once the first slice
  lands.` block.
- Replace with a 1-paragraph overview naming the core concern
  (balance integrity under HCM drift) and the three user-visible
  surfaces (create/approve requests, view balance, HCM batch
  ingress).
- Stack list updated with the real libs: Drizzle ORM (not just
  "SQLite"), class-validator, supertest.

### A3. `docs(readme): expand env-var table with every HCM_* and NODE_ENV`

- Environment variables table gains rows for `HCM_BASE_URL`,
  `HCM_MOCK_URL`, `HCM_TIMEOUT_MS`, and `NODE_ENV` (the latter
  with a note about the outbox worker's auto-start guard).
- Each row: name, default, purpose.

### A4. `docs(readme): replace project structure with the real module layout`

- Drop the current three-item tree.
- Replace with the actual layout: `time-off/`, `balance/`,
  `hcm/`, `hcm/repositories/`, `domain/`, `database/`, `main.ts`,
  `app.module.ts`.
- Module responsibilities section: one line per module explaining
  the concern (time-off = lifecycle, balance = overlay
  projection, hcm = client + outbox worker + batch ingress,
  domain = pure state machine + balance math).
- Cross-link into `TRD.md` §2 for the full architecture diagram.

### A5. `docs(readme): add API reference section with every endpoint`

- New section "API reference" listing every endpoint:
  - `POST /requests` — create pending.
  - `GET /requests/:id` — read one request.
  - `POST /requests/:id/approve` — approve pending → approved.
  - `POST /requests/:id/reject` — pending → rejected.
  - `POST /requests/:id/cancel` — pending → cancelled.
  - `GET /balance` — overlay breakdown.
  - `POST /hcm/balances/batch` — full-corpus balance replacement.
- Per endpoint: method + path + example request + example 200
  response + the set of possible error codes with pointer to
  TRD §7 row.
- Note on `hcmSyncStatus` (not_required / pending / synced /
  failed) as an in-body signal distinct from HTTP status.

### A6. `docs(readme): surface the agentic process artifacts`

- New section "Agentic development process".
- Short explanation of how the slices are built: architect brief
  before planning, TDD red/green cycle, reviewer pass before push.
- Links: `docs/plans/` (plan archives, each with Appendix A
  holding the architect brief verbatim), `docs/devlog.md`
  (chronological session log), `docs/process.md` (the slice
  template).
- Pointer to `.claude/agents/` (subagent definitions) and the
  operational guardrails in `CLAUDE.md` / policy in
  `INSTRUCTIONS.md`.

### A7. `docs(readme): add coverage + test walkthrough; inventory §15 scenarios`

- New "Testing" subsection: TRD §8 targets restated, link to
  `docs/coverage.md`, the three-layer pyramid with one sentence
  each.
- "Critical scenarios covered" sub-subsection mapping each
  §15 case to its spec file (`sufficient balance →
  test/integration/approve-request.spec.ts`, `concurrency →
  test/e2e/time-off-approve.e2e-spec.ts`, etc). Lets a reviewer
  trace a checklist into the code.

If A2–A7 naturally combine (e.g., no edit is under three lines),
bundle them. Keeping them separate is the default because the
README touches a lot of lines and per-topic commits are easier
to review.

## Phase B — Reviewer pre-push + followups (0-N commits)

Invoke `reviewer` subagent on the full diff. Expected areas of
focus:

- Coverage artefact format (is the markdown self-contained and
  regen-safe?).
- API reference accuracy (payload shapes match the DTOs?).
- README doesn't drift from TRD (§2, §7, §8, §9) — if the
  reviewer flags drift, either update README or add §9 note.

Apply or defer findings with a devlog note.

## Phase C — Wrap (1 commit)

`docs: narrate session 12 in devlog and archive plan 011`.

## Files to touch

```
NEW
  docs/coverage.md                                       (coverage artefact)
  docs/plans/011-readme-and-coverage-polish.md           (Phase C)

MODIFIED
  README.md                                              (A2-A7, rewritten section-by-section)
  package.json                                           (test:cov:e2e script)
  docs/plans/README.md                                   (list 011)
  docs/devlog.md                                         (session 12)
```

No source file changes expected. If the coverage baseline
surfaces an actual gap against a TRD §8 target, that gets its
own commit within A1 and the new spec joins `MODIFIED` above.

## Verification

### After Phase A (per commit)

- Every commit leaves `npm run typecheck`, `npm run lint`,
  `npm test`, and `npm run test:e2e` green.
- A1: `docs/coverage.md` committed; regeneration from the two
  scripts reproduces a diff of only timestamp + SHA.
- A2–A7: README renders cleanly (markdown preview); every link
  resolves; endpoint examples are copy-pasteable and return the
  shapes shown.

### After Phase A (totals)

- 122 unit+integration+e2e tests still green (no new specs
  unless A1's gap analysis adds one).
- TRD unchanged unless a §9 decision was needed for a coverage
  target renegotiation (flagged up-front).
- README no longer contains `TBD`.
- Theater-language audit still passes:
  `grep -rniE '\b(examiner|grader|evaluator|avaliador)\b'`
  across every tracked `.md`, `.ts`, `.json` returns zero.

### After Phase B

- Reviewer verdict captured in the devlog.

### After Phase C

- `docs/plans/011-readme-and-coverage-polish.md` exists with a
  short Appendix pointing at the coverage artefact (this slice
  has no architect brief because the scope is documentation;
  §7 subagent discipline notes the reviewer-only variant for
  docs-only slices).
- `docs/plans/README.md` lists 011.
- `docs/devlog.md` has a session-12 entry.

## Out of scope

- GET /requests (list with filters) — the next slice if the
  reviewer asks for it.
- GET /hcm/inconsistencies (operator surface) — tiny follow-up.
- Auth, Docker, CI pipeline, observability tooling.
- Any test whose only purpose is hitting a coverage target —
  §15 says tests must protect rules, not inflate numbers.

## Pre-push checklist

- [ ] A1: `docs/coverage.md` exists and reports ≥95% domain /
  ≥90% services (or a documented renegotiation).
- [ ] All Phase A commits green on typecheck / lint / test /
  test:e2e.
- [ ] Reviewer pass run on the diff; findings triaged.
- [ ] Devlog session 12 written.
- [ ] Plan 011 archived.
- [ ] Theater-language audit across all tracked `.md`, `.ts`,
  `.json` is clean.

---

# Appendix — Subagent note (docs-only slice)

This slice is documentation-only; no new business rules, no new
endpoints, no architectural risk. The `architect` subagent brief
that plan 005 formalised as a gating step protects against
scoping/flow mistakes on functional slices — it is not
load-bearing here. `reviewer` subagent still runs in Phase B
because the surface the reviewer cares about (clarity, drift,
consistency) is exactly what a README refresh can break.

This mirrors the disciplined-exception pattern docs/process.md
already calls out: "Other subagents (`domain-data`,
`api-contract`, `sync-integration`, `test-qa`) are invoked when
the slice touches their scope — as specialised review, not
ceremony." Docs-only slices land in the same bucket.
