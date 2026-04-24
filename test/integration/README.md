# Integration tests

Per `TRD.md` §8, this tier runs service + repository code against a
real temp-file SQLite (migrations applied per suite, state reset per
test). No HTTP, no mock HCM — that is what e2e does.

First integration suite lands when a service grows logic worth
isolating from the e2e path (for example: an outbox retry worker
with bounded backoff). Until then, the domain invariants are covered
by `src/**/*.spec.ts` and the full request flow by
`test/e2e/**/*.e2e-spec.ts`.

Kept here as an empty-but-declared tier so the Jest `projects` split
matches the pyramid documented in the TRD.
