# Plan 002 — Pre-bootstrap scaffolding: `.gitignore`, `README.md` and `TRD.md` skeletons, challenge brief handling

> Translated and lightly edited from the Portuguese original approved in
> session 2. The structure and decisions are preserved.
>
> Corresponding commits: `8058534`, `76375d9`, `241ee69`.

---

## Context

After plan 001, the AI-development foundation (`INSTRUCTIONS.md` in
English, `CLAUDE.md`, six subagents, two commands, `settings.json`,
`notes/` local-only) was ready and pushed to GitHub.

Before designing any part of the solution, three gaps needed to close:

1. **No `.gitignore`.** Any `npm install` or `nest new` would pollute
   the tree with `node_modules/`, build output, databases, environment
   files, and IDE folders. This had to land before scaffolding.
2. **No `README.md` or `TRD.md`.** `INSTRUCTIONS.md` §18 requires both.
   Creating empty skeletons with `TBD` placeholders up front allows
   incremental population as decisions are made, avoiding the
   anti-pattern of a one-shot documentation sprint at the end.
3. **The official challenge brief was not in the repo.** Without the
   external statement with its specific wording (employee / manager
   personas, HCM endpoints, measurement criteria), any design would
   risk diverging from what the brief actually asks for.

After closing these three gaps, the next plan would be the design
round itself.

## Decisions

1. **`.gitignore` specific to NestJS + SQLite, no template bloat.**
   Cover what the project will actually generate:
   - Node/TS: `node_modules/`, `dist/`, `*.tsbuildinfo`
   - SQLite: `*.db`, `*.db-journal`, `*.sqlite`, `*.sqlite3`,
     `*.sqlite-journal`, `*.sqlite3-journal`
   - Environment: `.env`, `.env.local`, `.env.*.local`
     (keep `.env.example` trackable)
   - Coverage: `coverage/`, `.nyc_output/`
   - Logs: `*.log`, `logs/`, `npm-debug.log*`, `yarn-debug.log*`,
     `yarn-error.log*`
   - OS: `.DS_Store`, `Thumbs.db`
   - Temp: `tmp/`, `temp/`
   - IDE — VSCode: `.vscode/`, `*.code-workspace`
   - IDE — JetBrains: `.idea/`, `*.iml`, `*.ipr`, `*.iws`, `out/`

   `notes/` is **not** listed here — it is ignored via
   `.git/info/exclude` (local-only, leaves no trace in committed files).

2. **`README.md` as a living document with only the skeleton.**
   Minimal headings (Overview, Stack, Quick start, Project structure,
   Testing, Architecture, Engineering principles) with explicit
   `> TBD: ...` placeholders. Prevents two anti-patterns: an empty
   README *and* a README full of aspirational lies that diverges from
   reality.

3. **`TRD.md` as an ADR-lite living document in a single file.**
   Not a `docs/adr/` folder — this is a take-home, not a corporate
   monorepo. Structure: Context, Architecture overview, Data model,
   HCM integration strategy, Concurrency & consistency, Error
   taxonomy, Testing strategy, Decision log, Open questions. Decision
   log is the traceability anchor required by §8.5.

4. **Challenge brief destination (revised during execution).**
   The plan originally proposed a committed `CHALLENGE.md` at the repo
   root. During execution, the PDF was placed in `notes/` (local-only)
   by the user — signal that the verbatim brief should not be
   published. Revised destination: `notes/CHALLENGE.md` (verbatim
   transcription, local-only). The public repo describes the problem
   in its own words via `TRD.md` §1. Recorded as the first entry in
   `TRD.md` Decision log (*"Challenge brief kept local-only"*).

5. **Execution order and commits.**
   - Step 1: `chore: add .gitignore for NestJS + SQLite`
   - Step 2: `docs: add README and TRD skeletons`
   - Pause: user shared the brief
   - Step 3: `docs: absorb challenge context into README and TRD`
     (README §Problem space replaces the dead CHALLENGE link;
     TRD §1 filled, §8 gets the first Decision log entry, §9 lists six
     open questions surfaced by the brief against `INSTRUCTIONS.md`).

## Files created / modified

```
.gitignore                                   (new)
README.md                                    (new, skeleton → Problem space)
TRD.md                                       (new, skeleton → §1/§8/§9 filled)
notes/CHALLENGE.md                           (new, local-only verbatim)
notes/ExampleHR_-_take_home_exercise.pdf     (new, local-only, user-placed)
```

## Verification performed

- `.gitignore` effectiveness: touched `node_modules/foo`, `.env`,
  `test.db`, `coverage/lcov.info`, `logs/app.log` — none appeared in
  `git status`.
- `grep -c '^## '` → README 7 headings, TRD 9 headings.
- `git check-ignore -v notes/CHALLENGE.md` confirmed
  `.git/info/exclude:6:notes/` is the matching rule.

## Commits

- `8058534 chore: add .gitignore for NestJS + SQLite`
- `76375d9 docs: add README and TRD skeletons`
- `241ee69 docs: absorb challenge context into README and TRD`

## Post-execution note

The original plan proposed `.nvmrc` and `.editorconfig` as nice-to-haves,
which the user declined. The original plan also placed `CHALLENGE.md`
at the repo root; the user's placement of the PDF under `notes/` during
execution signaled that the brief should stay private. The plan was
adjusted mid-execution and the decision logged in the TRD.
