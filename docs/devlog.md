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
