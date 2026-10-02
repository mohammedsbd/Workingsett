# Generator e2e tests

End-to-end tests for the hygen-based code generators (`npm run generate:resource:*`, `npm run add:property:to-*`).

## What's covered

- Every property `--kind` (primitive, reference, denormalized).
- Every primitive type (string, number, boolean, Date).
- Every reference `--referenceType` (oneToOne, oneToMany, manyToOne, manyToMany).
- `--isAddToDto true | false`, `--isOptional true | false`, `--isNullable true | false` permutations.

## Phases

1. **Phase 1 (static)** — runs generators, then `npm run lint`, `npm run build`, then [generators-file-assertions.e2e-spec.ts](generators-file-assertions.e2e-spec.ts). No database, no app boot. Catches compile/lint regressions and DTO-shape errors.
2. **Phase 2 (relational CRUD)** and **Phase 3 (document CRUD)**: the specs [generators-relational.e2e-spec.ts](generators-relational.e2e-spec.ts) and [generators-document.e2e-spec.ts](generators-document.e2e-spec.ts) exercise the generated REST endpoints against a running app. Their container-based runners were removed, so there is currently no npm script for these phases.

## Running locally

Phase 1 only requires Node, no DB:

```bash
npm run test:generators:relational
npm run test:generators:document
```

**Precondition:** your tracked working tree must be clean. The dirty-tree guard checks `git diff` (tracked changes only); brand-new untracked files outside the cleanup paths are fine.

## Cleanup model

The orchestrator installs an `EXIT` trap that:

- `rm -rf src/articles src/tags src/comments` — removes only the generated resource directories.
- `git checkout -- src` — reverts every tracked change inside `src/`, including the auto-patched `src/app.module.ts` and any lint-fix incidentals.

Cleanup is **bounded by path** — it never touches the repo root, `node_modules`, or `test/`. New untracked files in `test/` survive the run.

## Layout

```
test/generators/
  fixtures/
    matrix.ts                          # canonical entities + properties (consumed by file-assertion spec)
  helpers/
    auth.ts                            # admin login helper
    exec.ts                            # child_process wrapper
    payloads-relational.ts             # CRUD payload builder for TypeORM variant
    payloads-document.ts               # CRUD payload builder for Mongoose variant
  _matrix.sh                           # generator command list (sourced by the orchestrator)
  run-static.sh                        # Phase 1 orchestrator
  generators-file-assertions.e2e-spec.ts
  generators-relational.e2e-spec.ts
  generators-document.e2e-spec.ts
  README.md
```
