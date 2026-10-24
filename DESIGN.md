# Kitchenbinder design system: Pantry

Warm, paper-and-pantry look that behaves like a native app. Tokens live in
`apps/web/src/styles/brand.css` (also imported by the extension popup). The live
visual reference is `docs/design/pantry.html` (mock only, not production code).
Where the mock and this doc differ, this doc wins.

## Principles

1. **One tomato button.** Each screen has one primary action, in tomato, in the thumb zone. Everything else is quieter.
2. **Sheets, not pages.** Pick a day, save to a household, sort a list: open a bottom sheet over the current screen so you never lose your place.
3. **Undo, not "are you sure?".** Delete, tick, have-it and remove act instantly with an Undo toast. No confirmation dialogs. Only exception: losing unsaved draft data that can't be restored (e.g. draft storage failed).
4. **Households are tabs.** Switching between your recipes and a shared household is one tap on a binder divider, never a menu.
5. **Press, don't hover.** Everything scales slightly on press. 44px minimum targets. Nothing important hides behind hover.
6. **Calm by default.** Show the next useful thing, fold the rest away: bought items collapse, past days fade, extra fields wait in "Review details".

## Colour

Meaning first: **tomato = do this**, **olive = done / have it**, **butter = ratings and gentle nudges**.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f7f0e3` | Background (with faint warm grain) |
| `--oat` | `#eee3cf` | Fields, tab strip, muted surfaces |
| `--card` | `#fffbf4` | Raised surfaces |
| `--line` | `#e3d5be` | Borders, dividers |
| `--ink` | `#2b1d14` | Text, toasts |
| `--ink-2` | `#6e5a49` | Secondary text |
| `--ink-3` | `#a08b77` | Tertiary text, placeholders |
| `--tomato` / `-press` / `-soft` | `#c2412d` / `#a2321f` / `#f6dcd3` | Primary action, pressed, tint |
| `--on-tomato` | `#fff7ee` | Text on tomato |
| `--olive` / `-soft` | `#5e6b2f` / `#e4e5c8` | Done, have it |
| `--butter` / `-soft` / `-ink` | `#edb94a` / `#f8eacb` / `#8a5d0a` | Ratings, nudges |
| `--plum` / `-soft` | `#6d3b4e` / `#ebdae0` | Household marker |
| `--sage` / `-soft` | `#3f6b5c` / `#dce8e1` | Household marker |
| `--danger` | `#b3261e` | Destructive |
| `--night`, `-2`, `-line`, `-ink`, `-ink-2` | `#1e1510`, `#2c2019`, `#45362b`, `#f7ebdd`, `#bfa994` | Cook mode only |

**Tones.** `tomato | olive | butter | plum | sage` (`components/pantry/tones.ts`). Each household picks one marker tone, used on its binder tab, pills and avatars. Personal recipes ("My recipes") are tomato. Tinted UI uses `-soft` as fill and the solid (or `-press` / `-ink`) as text.

## Type

**One family: Nunito** (self-hosted, `@fontsource-variable/nunito`, roman + italic). No serif, no mono. Hierarchy comes from size and weight. Tabular numerals for quantities.

| Role | Spec |
|---|---|
| Large title (h1) | 36 / 1.04 · 800 · −0.025em |
| Recipe title | 30 / 1.08 · 800 |
| Section (h2) | 24 / 1.2 · 800 · −0.02em |
| Headline (h3) | 20 / 1.2 · 800 |
| Cook step | 26–42 fluid / 1.24 · 700 |
| Body | 16 / 1.5 · 400 (never below 16px on inputs) |
| Label | 13 · 600 |
| Eyebrow / overline | 11 · 700 · caps · 0.12–0.14em |

Accent: one italic tomato phrase in a headline, 700 italic ("What are we *cooking?*"). The wordmark is lowercase "kitchenbinder", one weight (850) in ink; both i dots are tomato punch rings (`.brand-punch`). The mark (Punchline) is a k whose spine is a binder page with two punched holes (`BrandMark`, `public/branding/mark.svg`).

## Shape, elevation, motion, space

- **Radius:** `--r-s` 10 · `--r-m` 16 · `--r-l` 24 · `--r-xl` 32 · `--r-pill` 999. Controls are pills.
- **Elevation** (warm-tinted): `--e1` resting cards, `--e2` floating cards/toasts, `--e3` bottom sheets. `--scrim` rgba(30,20,15,.38) behind sheets.
- **Motion:** `--ease` cubic-bezier(.2,.8,.2,1), `--spring` cubic-bezier(.32,.72,0,1). Durations: `--t-press` 120ms, `--t-base` 240ms, `--t-sheet` 420ms (spring).
- **Space:** 4-pt scale `--space-1…8` (4, 8, 12, 16, 20, 24, 32). `--tap` 44px minimum target.
- **Focus:** 3px tomato outline, 3px offset.

## Components

- **Buttons:** pill, min 48px (small 40, block 56 / 17px). Primary tomato; outline on card; ghost tints tomato-soft; danger is text-only red.
- **Covers:** no photo → tinted tile with one italic word from the title (initial at small sizes), tone-soft fill, tone ink. A photo simply replaces it. Grids look intentional either way.
- **Binder tabs:** household switcher; active tab underlined in household tone.
- **Sheets:** bottom sheets for pickers and quick forms.
- **Undo toast:** ink toast with Undo, after every instant destructive action.
- **Tab bar (mobile):** Add, Recipes, Shop, Plan, You. Hidden when signed out and on desktop.
- **Cook mode:** dark night palette, huge type, timers, screen kept awake, swipe or tap between steps.
- **Empty states:** one clear next step.

Building blocks: `apps/web/src/components/pantry/`.
