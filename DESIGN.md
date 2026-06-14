# leetlab — design

The source of truth for tokens (color, type, radii, spacing, components) is **[DESIGN-stripe.md](./DESIGN-stripe.md)**. Read it for any visual decision.

This file documents the **leetlab-specific extensions** of that system — the structural and component decisions that aren't in the Stripi MD because they're product-specific.

## Layout shell

Persistent left sidebar (256px), no top bar. Main content lives in a 1280px max container with `px-10 py-10`.

```
┌──────────────┬───────────────────────────────────────┐
│  leetlab     │  ⌽ LIBRARY                            │
│  ●  desk     │                                       │
│              │  HSBC Life Singapore                  │
│  LIBRARY     │  232 funds · …                        │
│  ┃ HSBC      │                                       │
│    Provider 02                                       │
│  ANALYSIS                                            │
│    Build                                             │
│  ┃ Portfolios                                        │
│    Switch narratives                                 │
└──────────────┴───────────────────────────────────────┘
```

**Sidebar sections**: `LIBRARY` and `ANALYSIS`. Each section gets a `t-micro-cap` eyebrow. Items are `t-body-md` with a `num` count chip on the right when relevant. Active item: subtle `canvas-soft` background + 2px indigo vertical bar before the label. Disabled (TBD providers/features): muted at 55% opacity with a dash "—" placeholder.

## Tables — the "table-pro" pattern

The fund library and most data views use one consistent table treatment.

- Wrapper: `rounded-lg border border-hairline bg-canvas` with no shadow
- `table-layout: fixed` with explicit `<colgroup>` widths so columns don't auto-resize as data changes
- Header: `t-micro-cap` style at 10px / 500 / uppercase / 12% tracking; sticky on scroll; `canvas` background; bottom 1px hairline
- Rows: 14px body-tabular with `tabular-nums + ss01 + tnum`; padding `14px 14px`; bottom 1px `hairline-2`
- Hover: row background lifts to `canvas-soft`
- Right-aligned cells (NAV, returns) use `class="nowrap right"` to prevent wrap and align cleanly
- Fund-name cell uses `class="cell-fund"` — two-line composition: bold name (truncated with ellipsis on overflow) + muted `house · ISIN` meta line

## Numbers

- Always tabular: `font-variant-numeric: tabular-nums` + OpenType `tnum` + `ss01`
- Positive returns: `text-positive` with `+` prefix
- Negative returns: `text-negative` with a real minus glyph (`−`, U+2212), never a hyphen
- Currency before NAV with a non-breaking space: `USD 22.88`

## Risk indicator

5-dot pip row. Each filled dot is 5×5 `bg-ink`; unfilled is `bg-hairline`. 3px gap. Provides immediate-read risk without taking column width.

## Tags

`.tag` for neutral filter chips on the library, `.tag-primary` for the active count chip ("9 of 232 shown"), `.tag-positive` / `.tag-negative` reserved for in-row status callouts (not used yet).

## What we don't do

- No top bar / no breadcrumbs (sidebar is the wayfinder)
- No card shadows
- No dark mode (light is the chosen lane)
- No accent colors outside the Stripi palette
- No bold weights — display tier stays at 300
- No sentence-case eyebrows — they're always all-caps tracked
