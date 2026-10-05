# Parsim

Parsim is a garbage collector for the context of long-running, non-coding AI agents (research, support, data, browser and operations agents). It is a drop-in proxy that speaks the OpenAI and Anthropic APIs: you point your agent's base URL at Parsim. On every request it decides, for each piece of context, whether to keep it, compress it into a structured state block, archive it (store it, leave a short stub and let the model recall it on demand) or drop it (duplicate or superseded). It then forwards the smaller request to the real model, returns the response unchanged, and records the tokens and dollars saved. A replay system later proves that quality did not drop.

## Folder layout

```
.
├── backend/    NestJS + TypeORM + PostgreSQL API and proxy (from brocoders/nestjs-boilerplate)
├── frontend/   Next.js + shadcn/ui dashboard (from Kiranism/next-shadcn-dashboard-starter)
├── docs/       Project docs, including per-step progress notes in docs/progress/
└── CLAUDE.md   Permanent project rules
```

## Setup

- Backend: see [backend/README.md](backend/README.md)
- Frontend: see [frontend/README.md](frontend/README.md)
