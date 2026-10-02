# Step 02: remove Clerk auth from the frontend

## Goal

Remove Clerk completely so the frontend runs locally with no keys and no sign-in, and opening the app lands directly on the dashboard.

## What was built

- Clerk removed using the starter's own tool: `node scripts/cleanup.js clerk`.
- Removed pages: sign-in and sign-up (`/auth/*`), workspaces, team, billing, profile and the "exclusive" demo page, plus their feature folders.
- The org switcher and user avatar components were replaced with the starter's no-auth templates (sidebar, user nav, providers, nav hook, proxy).
- `src/app/dashboard/layout.tsx`: removed the `auth.protect()` gate, which the cleanup script missed.
- `/` and `/dashboard` now redirect to `/dashboard/overview`.
- `@clerk/nextjs` was removed from dependencies, and the Clerk image hosts were removed from `next.config.ts`.
- Clerk sections were removed from `README.md`, `AGENTS.md`, `CLAUDE.md`, `env.example.txt` and `docs/deployment.md`, and `docs/clerk_setup.md` and `docs/nav-rbac.md` were deleted.

## Files changed

Backend:
- None.

Frontend:
- Code: `src/app/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/layout.tsx`, `src/proxy.ts`, `src/components/layout/{app-sidebar,providers,user-nav}.tsx`, `src/hooks/use-nav.ts`, `src/config/{nav-config,infoconfig}.ts`, `src/features/notifications/components/*`, `package.json`, `bun.lock`, `next.config.ts`
- Deleted: `src/app/auth/`, `src/app/dashboard/{workspaces,billing,profile,exclusive}/`, `src/features/{auth,profile}/`, `src/components/{org-switcher,user-avatar-profile}.tsx`
- Docs: `README.md`, `AGENTS.md`, `CLAUDE.md`, `env.example.txt`, `docs/deployment.md`, and the two deleted docs above

Other:
- `docs/progress/README.md`, this file

## Decisions and trade-offs

- **Used the starter's cleanup script instead of hand edits.** It is the template's supported way to drop Clerk and ships matching replacement components, so the result follows the template's own patterns.
- **No auth for now.** The dashboard is open to anyone who can reach it. Auth will come back later against our NestJS backend, which already has JWT auth.
- **Why keyless Clerk failed:** Clerk turns off its keyless dev mode when it detects an automated environment (here, the Claude Code session variables). In your own terminal it would have worked, but you asked for Clerk to go entirely.

## How to verify

```bash
cd frontend && bun install && bun run lint && bun run typecheck
```

Both should exit with code 0.

```bash
cd frontend && bun run dev
```

Open http://localhost:3000. You should land on `/dashboard/overview` with no sign-in. `/dashboard/product`, `/dashboard/users` and `/dashboard/kanban` should return 200, and `/auth/sign-in` should return 404.

## Known issues and next steps

- The bundled agent skill `kiranism-shadcn-dashboard` (`.claude/skills` and `.agents/skills`) still mentions Clerk, auth, orgs and RBAC. It should be trimmed so future agent work does not reintroduce Clerk.
- `scripts/cleanup.js` and `scripts/cleanup-templates/` are still present. They can be deleted once no more starter features need removing.
- The dashboard still shows the starter's demo pages and mock data. Replacing them with ContextGC pages comes in later steps.
- This branch is based on `feat/step-01-project-rules-and-docker-removal`, which is not merged yet. Merge step 01 first.
