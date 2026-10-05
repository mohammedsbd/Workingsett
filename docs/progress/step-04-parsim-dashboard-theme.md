# Step 04: Parsim dashboard theme

## Goal

Give the dashboard the look of the Parsim landing page (https://co-ui2.vercel.app/) with a new "Parsim" theme, make it the default, and keep every existing theme in the switcher.

## What was built

- **Parsim theme** (`frontend/src/styles/themes/parsim.css`), defined in oklch like the other themes, with every token set for both modes.
  - Dark mode is the main look: a `#000000` page, `#171717` cards, `#262626` borders and a `#0A0A0A` sidebar. `#FF3B00` is used for `--primary`, `--ring` and `--sidebar-primary`, always with black text on it.
  - Light mode keeps the same `#FF3B00` accent on near-white surfaces.
  - `--destructive` is rose (`#F76E93` dark, `#BE185D` light), so delete and error states don't look like the orange primary.
  - Small radius (`0.25rem`) and very light shadows.
- **Chart colors** `--chart-1` to `--chart-5`:
  - Dark: `#FF3B00`, `#FF7700`, `#FFC24D`, `#D4D4D4`, and the muted blue `#7C93C3`.
  - Light: the same order, with darker amber, gray and blue so they stay visible on white.
  - The colors differ in lightness as well as hue, which helps colorblind users.
- **GC decision colors** `--gc-keep`, `--gc-compress`, `--gc-archive` and `--gc-drop` are mapped for Tailwind (`bg-gc-drop`, `text-gc-archive`, and so on).

  | Token | Dark | Light |
  | --- | --- | --- |
  | keep | `#E5E5E5` near-white | `#525252` gray |
  | compress | `#FF7700` orange | `#A16207` amber |
  | archive | `#7C93C3` muted blue | `#4A6396` muted blue |
  | drop | `#FF3B00` brand orange-red | `#FF3B00` brand orange-red |

- **Defaults:**
  - Parsim is first in the theme switcher and is `DEFAULT_THEME`.
  - Dark is the default color mode (`defaultTheme='dark'`), and light can still be chosen with the toggle. The browser's `theme-color` meta tag follows the mode.
- **Fonts:**
  - Poppins (newly added through `next/font/google`) is the sans font.
  - JetBrains Mono, which was already loaded, is the mono font.
- **Glow:** a subtle orange radial glow in the top-right corner of the main content area, scoped to the Parsim theme.
- **Active nav item:** an orange icon and a thin orange bar on the left edge. The background is unchanged, so the text stays readable in both modes.
- **Naming:**
  - The sidebar header shows a "P" mark and "Parsim", linked to the overview.
  - Browser titles read `<page> | Parsim`.
  - The metadata and Open Graph text describe Parsim.

## Files changed

Backend:
- None

Frontend:
- Added: `src/styles/themes/parsim.css`
- Modified:
  - `src/styles/theme.css`: Parsim import, plus the font variable fix described under Decisions.
  - `src/components/themes/theme.config.ts`: Parsim registered first, `DEFAULT_THEME = 'parsim'`.
  - `src/components/themes/font.config.ts`: Poppins added.
  - `src/app/layout.tsx`: default dark mode, theme color, Parsim metadata.
  - `src/app/dashboard/layout.tsx`: dashboard metadata.
  - `src/components/layout/app-sidebar.tsx`: brand mark in the sidebar header.
  - `docs/themes.md`: fixed the `DEFAULT_THEME` location, added a Parsim theme section.

Other:
- Added: `docs/progress/screenshots/step-04-overview-dark.jpg`, `docs/progress/screenshots/step-04-overview-light.jpg`, and this file
- Modified: `docs/progress/README.md`

## Tests

No unit tests were added. This step is theme CSS and layout config only, with no frontend logic to test (CLAUDE.md asks for frontend tests once there is logic such as data formatting). No backend code changed.

Last run results:
- frontend `bun run lint` (oxlint): 0 warnings, 0 errors
- frontend `bun run typecheck`: exit 0
- frontend `bun run build`: success, 21 routes
- `oxfmt --check` on the changed files: clean
- backend `npm test` and `npm run test:e2e`: not run, because the backend did not change. `npm test` still reports "No tests found" as in step 01.

Visual and contrast checks against a production build (`next start`):
- The overview, product, users and kanban pages were each checked in dark and light mode.
- An in-page script measured the WCAG contrast of every visible text element against its real background, alpha blending included.
- Final run: 0 failures on all 8 page and mode pairs.
- The lowest ratio was 4.78:1 in dark mode (kanban priority badge) and 4.93:1 in light mode (orange link text).
- Black text on the `#FF3B00` buttons is 5.88:1.
- The theme switcher lists Parsim first, and switching between Parsim and other themes works.
- With no cookie and no saved mode, the app opens in Parsim dark.

Screenshots: `docs/progress/screenshots/step-04-overview-dark.jpg` and `docs/progress/screenshots/step-04-overview-light.jpg`.

## Decisions and trade-offs

- **Darker orange for small text in light mode.** `#FF3B00` on white is 3.6:1, below AA for normal text. Buttons and fills keep the brand color, but `.text-primary` in Parsim light mode uses `#C93000` (same hue, 4.9:1 or better). Dark mode uses `#FF3B00` everywhere.
- **Rose destructive instead of red.** A plain red sits too close to the orange-red primary. The first rose shades failed on the kanban "high" badge (4.21:1 dark, 4.00:1 light), so I picked a lighter one for dark and a deeper one for light.
- **Light-mode GC colors differ from dark.** A near-white "keep" would disappear on white, and `#FF7700` on white is 2.7:1. Light mode uses gray keep and amber compress instead.
- **Font variable fix in the shared `theme.css`.** The body rule set `--font-mono` to `initial`, which leaves it unset rather than taking the html value. So `font-mono` fell back to the sans font in every theme, not just Parsim. Changing it to `inherit` is a one-word fix outside the Parsim file. It was needed for JetBrains Mono to show, and it also fixes mono and serif fonts in the other themes.
- **Font names in CSS.** Fonts are referenced by family name (`Poppins`, `'JetBrains Mono'`), as `docs/themes.md` says. Some existing themes use `var(--font-inter)` and similar, but those variables only exist on `<body>`, so they don't resolve where the theme variables are defined (on `<html>`).
- **Active nav styling via CSS, not component changes.** The orange bar and icon live in `parsim.css` as attribute selectors. `ui/sidebar.tsx` is untouched.
- **Open Graph screenshot removed.** It showed the starter template, not Parsim. A real Parsim image can be added later.
- **Screenshots are 800x500 JPEGs.** That is what the browser pane produces. They show the full 1440x900 layout scaled down.
- **Checked on a production build.** Another session's `next dev` server was already running in `frontend/`, and Next.js allows only one dev server per folder. I ran `next build` and `next start` on port 3100 instead.

## How to verify

```bash
git log --oneline main..feat/step-04-parsim-dashboard-theme
```

```bash
cd frontend && bun install && bun run lint && bun run typecheck && bun run build
```

```bash
cd frontend && bun run dev
```

Open http://localhost:3000/dashboard/overview in a private window, so no theme cookie or saved mode exists. You should see:
- The Parsim theme in dark mode: black page, `#171717` cards, an orange "P Parsim" mark in the sidebar, and an orange bar on the active nav item.
- The theme switcher in the header lists Parsim first, and the other themes still work.
- The sun/moon toggle switches to light mode, which keeps the orange accent.

## Known issues and next steps

- The `--gc-*` variables are only defined in the Parsim theme. If GC badges or charts render while another theme is active, those themes need values too, or the components need a fallback.
- Tailwind only generates the `bg-gc-*` / `text-gc-*` classes once they appear in source, so the mapping is untested until the first GC chart or badge uses it (step 13).
- Poppins, JetBrains Mono and other fonts are fetched from Google Fonts at build time. One build failed with a transient Merriweather fetch error and passed on retry. Offline builds will fail.
- The header's GitHub button still links to the upstream starter repo. Remove or repoint it when the real dashboard pages land.
- The overview, product, users and kanban pages still show the starter's demo content. Real Parsim pages come in step 13.
