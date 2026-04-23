---
description: Run the reviewer agent on the current branch's diff vs main
---

Invoke the `reviewer` subagent to review the current branch's diff against
`main`.

Context to pass to the agent:

- Output of `git diff main...HEAD`
- Output of `git log main..HEAD --oneline`
- Any extra focus the user supplied: $ARGUMENTS

The reviewer must return findings grouped as **Blocking** / **Should fix** /
**Nits**, each with `file:line`, what, why, and suggested direction. Do not
edit files.
