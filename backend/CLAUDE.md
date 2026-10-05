# Project instructions

NestJS backend for Parsim, using relational persistence only (TypeORM/PostgreSQL).

## When adding entities, schemas, or properties

Use the `generate` skill (auto-loaded from [.claude/skills/generate/SKILL.md](.claude/skills/generate/SKILL.md)). It documents the project's CLI generators (`npm run generate:resource:*`, `npm run add:property:to-*`) which keep entities, DTOs, modules, and migrations in sync. Do not hand-write entity files.
