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

## Relationship to `TRD.md`

Plans describe *what we will do and why*. The TRD's Decision log
(`TRD.md` §9) records *what was decided*, authoritatively. When the two
disagree, the TRD wins — plans are historical snapshots, the TRD is
living.
