# Plan 001 — Foundation: INSTRUCTIONS.md (English), CLAUDE.md, and `.claude/` multi-agent scaffolding

> **Reconstructed from conversation memory and git history after the fact.**
> The original plan file was overwritten before the archive practice was
> established. The context, decisions, and outcomes below are faithful;
> exact wording may differ from the original.
>
> Corresponding commits: `4b1e766 docs: add engineering briefing for time-off microservice` and `32bcb6b chore(claude): scaffold CLAUDE.md and .claude/ multi-agent workflow`.

---

## Context

The repository started with a single file: `INSTRUCTIONS.md`, in Portuguese.
`INSTRUCTIONS.md` itself describes a multi-agent development discipline —
six internal roles (Architect, Domain & Data, API & Contract, Sync &
Integration, Test & QA, Reviewer) defined in §7 — but the repository did
not yet *materialize* that discipline in invocable tooling. Claude Code
supports subagents via `.claude/agents/`; turning the six roles into actual
subagents transforms a mental model into repeatable, auditable workflow.

Additionally, the all-documentation-in-English rule that `CLAUDE.md` would
introduce would be undermined by a Portuguese `INSTRUCTIONS.md`, and any
subagent prompt referring to `§7` or `§13` would need the source file to
match. A faithful English translation of `INSTRUCTIONS.md` preceding every
other change was the correct ordering.

## Decisions

1. **Translate `INSTRUCTIONS.md` in place to English.** Same file path,
   same 24-section numbering, same `---` separators, same imperative tone.
   Git history preserves the Portuguese original if ever needed. No
   second `INSTRUCTIONS.pt.md` file — avoids drift risk.

2. **`CLAUDE.md` is short and points to `INSTRUCTIONS.md` for rules.**
   Around 70 lines covering stack, project layout, common commands,
   subagent list, hard guardrails, and the language rule. No rule
   duplication — `CLAUDE.md` auto-loads every turn and having rules in
   two places invites drift.

3. **Six subagents under `.claude/agents/`, one per role from §7.**
   Each has frontmatter (`name`, `description`, `tools`, `model`) and a
   role-focused system prompt citing the relevant `INSTRUCTIONS.md`
   sections. Permissions vary by role: `architect` and `reviewer` are
   **read-only** (no `Write`/`Edit` tools in frontmatter) so they cannot
   subvert their review function.

4. **Two slash commands under `.claude/commands/`.**
   - `/plan-feature` — forces the §17/§19 flow (Understanding → Impact
     → Minimum viable scope → Risks → Incremental plan → Validation)
     before any implementation.
   - `/review-diff` — dispatches the `reviewer` subagent on the current
     branch's diff versus `main`.

5. **`.claude/settings.json` with a realistic allowlist.**
   Bash allowlist for routine Node/NestJS/Jest/git read-only commands;
   denylist for destructive operations (`rm -rf /*`, `git push --force*`,
   `git reset --hard*`, `git clean -f*`). No global wildcards.

6. **Deliberately out of scope.**
   No hooks (no build exists yet), no custom skills (no repeated workflow
   identified), no MCP servers beyond what is already configured, no
   cosmetic `.claude/` files, no `README.md` or `TRD.md` (deferred to
   plan 002).

## Files created

```
INSTRUCTIONS.md                              (rewritten: PT → EN)
CLAUDE.md                                    (new)
.claude/settings.json                        (new)
.claude/agents/architect.md                  (new, read-only role)
.claude/agents/domain-data.md                (new)
.claude/agents/api-contract.md               (new)
.claude/agents/sync-integration.md           (new)
.claude/agents/test-qa.md                    (new)
.claude/agents/reviewer.md                   (new, read-only role)
.claude/commands/plan-feature.md             (new)
.claude/commands/review-diff.md              (new)
```

Total: 10 new files + 1 rewritten.

## Verification performed

- `grep -c '^## ' INSTRUCTIONS.md` returned 24 (matches the original's
  24 top-level sections).
- `grep -inE '\b(não|você|saldo|folga|integração|sincronização)\b'
  INSTRUCTIONS.md` returned no matches — no Portuguese leftovers.
- `python3 -c 'import json; json.load(open(".claude/settings.json"))'`
  passed — valid JSON.
- Each agent `.md` file's first six lines contain valid frontmatter with
  `name`, `description`, `tools`, `model`.

## Commits

- `4b1e766 docs: add engineering briefing for time-off microservice` —
  the translated `INSTRUCTIONS.md`.
- `32bcb6b chore(claude): scaffold CLAUDE.md and .claude/ multi-agent workflow` —
  `CLAUDE.md`, six subagents, two commands, `settings.json`.
