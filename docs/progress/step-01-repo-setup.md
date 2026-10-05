# Step 01: repo setup (checklist pass)

## Goal

Confirm the repo matches the step 01 brief (both starter projects imported as plain files, permanent project rules, root repo files, progress index, green lint and typecheck) and close the remaining gaps.

## What was built

Most of step 01 was already done on `feat/step-01-project-rules-and-docker-removal` (see [step-01-project-rules-and-docker-removal.md](step-01-project-rules-and-docker-removal.md)), and later steps 02 and 03 build on it. This pass checked every item in the brief against the current tree:

| Brief item | Status |
| --- | --- |
| `backend/` and `frontend/` as plain files, no nested `.git`, no submodules | Done, verified |
| Unchanged import commits with the exact messages | Done (`c751e14`, `5779b2c`) |
| Both LICENSE files kept | Done, verified |
| Root `.gitattributes` with LF everywhere, CRLF for `*.bat`, `*.cmd`, `*.ps1` | Done. All 1023 tracked text files are stored as LF |
| Root `.gitignore` | Was missing `.env.test`. Fixed in this step |
| Root `README.md` | Done |
| `CLAUDE.md` with the exact rules text | Done. Byte-compared with the brief: identical |
| `docs/progress/README.md` step index | Done, updated in this step |
| Install, lint, typecheck, build in both projects | Done, all pass (see Tests) |

## Files changed

Backend:
- None

Frontend:
- None

Other:
- Modified: `.gitignore` (added `.env.test`)
- Added: `docs/progress/step-01-repo-setup.md` (this file)
- Modified: `docs/progress/README.md` (index line for this branch)

## Tests

No tests were added. The brief for this step covers repo setup only, and neither upstream project ships unit tests.

Last run results:
- backend `npm ci`: ok
- backend `npm run lint`: exit 0
- backend `npx tsc --noEmit`: exit 0
- backend `npm run build`: exit 0
- backend `npm test`: "No tests found", exit 1 (no spec files exist yet)
- backend `npm run test:e2e`: not run, there is no test database or e2e suite yet
- frontend `bun install`: ok
- frontend `bun run lint` (oxlint): 0 warnings, 0 errors
- frontend `bun run typecheck`: exit 0

## Decisions and trade-offs

- **Branched from the current tip, not from `main`.** `main` still holds only the initial commit, and the step 01 to 03 work lives on stacked branches. Branching `feat/step-01-repo-setup` from `main` would mean redoing both imports and the Docker and Clerk removal. Branching from the tip keeps one linear history; the trade-off is that `main..HEAD` on this branch also lists the step 01 to 03 commits.
- **`.gitattributes` came after the import commits, not before.** The brief asks for it first. Fixing the order would mean rewriting already pushed history. It has no practical effect: every tracked text file is already stored as LF and lint passes on Windows.
- **Installs on D:.** Drive C: ran out of space during `npm ci`. npm, Bun and temp caches were pointed at `D:/dev-cache` through environment variables for this machine only. No repo config was changed.

## How to verify

```bash
git log --oneline main..feat/step-01-repo-setup
```

```bash
git ls-files --eol | grep -v "i/lf" | grep -v "i/-text" | grep -v "i/none"
```

This should print nothing (every text file is stored as LF).

```bash
cd backend && npm ci && npm run lint && npx tsc --noEmit && npm run build
```

```bash
cd frontend && bun install && bun run lint && bun run typecheck
```

Lint, typecheck and build should all exit with code 0.

## Known issues and next steps

- `npm test` fails with "No tests found" until the first spec files land. The first backend feature step should add tests so `npm test` passes, as CLAUDE.md requires.
- There is no Postgres test database or `backend/.env.test` yet, so `npm run test:e2e` cannot run. Set this up (on D:) before the proxy step.
- husky prints ".git can't be found" during `bun install` in `frontend/` because the git root is the repo root. Harmless, but the frontend hooks do not install. Worth fixing when git hooks matter.
- `main` still holds only the initial commit. The stacked step branches need review and merging in order.
- Open items carried over from the earlier step 01 summary still apply: bash-only generator scripts, MongoDB support still present, `WORKER_HOST=redis://...` in env examples.
