# Agentic development process

This project is built with AI-first engineering discipline. Claude Code
(`Opus 4.7`) is the primary author of code, tests, and documentation;
the engineer drives intent, scope, and verification. This document
describes how that relationship is organized in practice so the process
itself is inspectable, not just the output.

## The six subagents

Each file in `.claude/agents/` materializes one of the six roles named
in `INSTRUCTIONS.md` §7. A subagent is invoked explicitly via
`Agent(subagent_type=<name>)`. Two of them are **read-only by design** —
their `Write`/`Edit` tools are removed in the frontmatter so they
cannot subvert their role by editing the code they are supposed to
analyze.

| Subagent           | Mode       | Scope                                                             |
|--------------------|------------|-------------------------------------------------------------------|
| `architect`        | read-only  | Scope delimitation, flow modelling, risk surfacing                |
| `domain-data`      | read+write | Entities, state machines, persistence schema                      |
| `api-contract`     | read+write | HTTP endpoints, DTOs, validation, error taxonomy                  |
| `sync-integration` | read+write | HCM client, realtime and batch sync, retries, mock HCM            |
| `test-qa`          | read+write | Unit, integration, e2e tests; coverage strategy                   |
| `reviewer`         | read-only  | Clarity review, hidden-risk surfacing, simplification pressure    |

Each subagent prompt cites the specific `INSTRUCTIONS.md` sections that
scope its role (e.g. `domain-data` cites §7, §11, §14).

## The plan → execute → commit cycle

1. **Plan.** Before any non-trivial change, plan mode is entered. The
   `architect` subagent is launched early in planning (bias-free
   prompt, often in parallel, often on `opus`) to produce scope, flow,
   risks, and ordered TDD steps. Its output is synthesised against
   the lead's own thinking; the archived plan either inlines or
   appendices the architect brief (plans without it are incomplete —
   see *Plan template* below). Ambiguities are resolved with
   `AskUserQuestion` before plan approval, not guessed during
   execution.
2. **Execute.** Files are edited within the scope of the approved plan.
3. **Cross-review before push.** The `reviewer` subagent is launched
   on the full local diff against `origin/main` before pushing. Its
   findings are triaged as *blocking* / *should fix* / *nit* and
   either resolved (as follow-up commits) or explicitly deferred in
   `docs/devlog.md`. This step is what separates *using* a subagent
   from *orchestrating* one; skipping it drops a load-bearing
   checkpoint.
4. **Commit.** Conventional Commits format
   (`type(scope): subject`). Every commit carries a
   `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
   footer so authorship attribution is explicit.
5. **Archive.** The approved plan is ported to
   `docs/plans/NNN-<title>.md` with the architect brief as Appendix
   A. Any additional subagent analyses (reviewer findings summary,
   domain-data or api-contract consultations) go in as further
   appendices so the evidence stays with the decision.

## Plan template

Every plan archived in `docs/plans/NNN-*.md` must include:

- **Context** — why the change is happening.
- **Architect briefing** — the output of the architect subagent run
  during planning, inlined or appended. Absent = plan incomplete.
- **Decisions locked** — what is decided before execution starts, with
  user ratifications where applicable.
- **Phases** — each phase a commit-sized unit of work with its
  commit message declared.
- **Files touched** — inventory with NEW / MODIFIED markers.
- **Verification** — how we will prove the plan succeeded, per phase.
- **Out of scope** — explicit boundaries for the next plan.
- **Pre-push checklist** — reviewer pass listed here; its completion
  and findings logged in `docs/devlog.md`.

## Two slash commands

- **`/plan-feature <description>`** — forces the §17/§19 flow on any
  new feature (Understanding → Impact → Minimum viable scope → Risks →
  Incremental plan → Validation) before implementation begins.
- **`/review-diff [focus]`** — dispatches the `reviewer` subagent on
  the current branch's diff versus `main`, returning findings grouped
  as *Blocking* / *Should fix* / *Nits*.

## Traceability anchors

Three artifacts make the engineering journey inspectable after the fact:

- **`TRD.md` Decision log** — every architectural decision as a
  structured entry: Decision, Reason (citing `INSTRUCTIONS.md` §X.Y),
  Alternatives considered, Impact.
- **`docs/plans/`** — the plans that led to those decisions, in
  approval order. Subagent analyses are embedded as appendices.
- **`docs/devlog.md`** — chronological session narrative, one concise
  entry per working session.

Together they answer three questions: *"what did you decide?"*
(TRD), *"how did you decide?"* (plans), *"when did you decide it?"*
(devlog).

## Folder conventions

- **`docs/`** — public deliverables: process, plans, devlog. Every
  file committed.
- **`notes/`** — local-only scratch space: private references (e.g.
  the verbatim challenge PDF), brainstorm, unpublished drafts. Excluded
  via `.git/info/exclude` (not `.gitignore`) so the exclusion itself
  leaves no trace on the public repo.
- **`.claude/`** — subagents, commands, settings. Committed.
- **`src/`** (future) — production code.
- **`test/`** (future) — integration and e2e tests.
- **`scripts/hcm-mock/`** (future, per `TRD.md` §3) — standalone
  Express mock HCM, used by integration and e2e tests.

## Commit discipline

- Atomic commits: one logical change per commit.
- `chore:` for tooling, `docs:` for documentation, `feat:` for
  features, `fix:` for bug fixes, `test:` for test-only changes,
  `refactor:` for behavior-preserving restructuring.
- Scopes in parentheses when the change is confined to a subsystem:
  `chore(claude):`, `docs(trd):`, `docs(plans):`.
- Subject in imperative mood, under 70 characters; body explains
  *why*, not *what*.
- Every commit carries the `Co-Authored-By` footer for Claude.
