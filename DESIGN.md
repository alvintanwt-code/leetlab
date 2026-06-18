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

---

# Editorial Mandate Sheet — Analysis Pages

Adopted June 2026 for the analysis surfaces (`PortfolioDetail`, `StudioShell` xray panel, `/portfolios` show-all grid). Anchored to PhillipCapital DPM mandate fact sheets. Trust is communicated through typographic restraint.

**This is a contract.** Every design change to analysis surfaces must respect it, and structural changes should be run through the `design-taste-frontend` skill with this file passed as the brief.

## Intent

- Reads like a **printed institutional document**, not a SaaS dashboard.
- **Monochrome with one accent.** Colour is semantic (positive / negative) or the brand bullet — never decorative.
- **Tabular figures everywhere.** Numbers are how this product communicates; they must line up.
- **Hairlines, not fills.** Structure comes from 1px lines and whitespace.
- **Density over hand-holding.** The audience is advisors; they read fast and want signal.

## Composition patterns

### Eyebrow strip (page / portfolio identity)

```
[●] PROVIDER · CATEGORY · RISK X/5
```

- 2.5px filled square in `--color-primary`
- Text in `t-micro-cap` (uppercase, tracked, ink-mute)
- Separators: a middle-dot in `--color-hairline` colour, `mx-1.5`

### Hero header

```
[eyebrow strip]

PORTFOLIO NAME                                           14%
(56–64px medium ink, tracking -0.025em)              10-YEAR ANNUALISED…
                                                     (small caps eyebrow)
```

- Title left, hero KPI right
- Title: medium weight, very tight tracking (-0.025em)
- KPI number sits in ink; only the `%` sign gets the semantic colour (`--color-positive` / `--color-negative`)
- Wrap-reverse on small viewports so KPI sits on top

### Mandate facts strip

```
────────────────────────────────────────────────
EQUITY     FIXED INCOME    OCF P.A.    FUNDS
98%        2%              1.822%      4
```

- 4 columns above a 1px hairline
- Each cell: small-caps label (10px) on top, 22–26px medium-ink value below
- No vertical dividers — whitespace separates

### Universal section header

```
Title (14px medium ink)                       EYEBROW (10px tracked caps)
```

- Title-left / eyebrow-right is the **universal pattern** for every analysis card
- The eyebrow describes methodology (`SLEEVE-WEIGHTED`, `EQUITY SLEEVE`, `WEIGHT-AVERAGE`, `% PER ANNUM`)
- The eyebrow **never carries data** — that goes in KPI tiles / inline metrics

### KPI tile (editorial pattern)

```
EYEBROW LABEL
22px medium ink value
```

Replaces the old "value first, label second" convention. Label-on-top reads as a fact, value-bottom anchors the eye.

### Composition bars

- 2px tall, hairline-thin
- `--color-ink` fill on `--color-hairline-2` track
- Square ends, no rounding
- Width scaled to max in the series
- Used in sector / geo / look-through breakdowns

### Annual return bars

- Central baseline at chart midpoint
- Positive years: `--color-ink` up
- Negative years: `--color-negative` down
- Zero years: short 2px tick at baseline
- Value labels outside each bar (above for positive, below for negative)
- `'YY` x-axis ticks in tabular num ink-mute

### Inline chart metrics

When a chart card has supplementary numbers (ending value, CAGR, worst year), surface them **inline with the chart title**, not in a separate KPI card. Three columns max, each label-on-top / value-below.

### Sticky chrome (filter rows)

- Pin to `top-0` with `bg-canvas-soft`
- Each row: small-caps eyebrow (fixed `w-20`) left, chips right
- Chips: underline-style only, no fill — active = ink + 2px ink underline aligned with row hairline; inactive = ink-mute; disabled = faded
- Rows separated by `border-hairline-2`, outer bottom by `border-hairline`
- Row height locked to `h-[52px]` for hairline alignment across panels

## Anti-patterns — refuse these

These are the patterns that make analysis surfaces start looking like a generic AI dashboard. Out of bounds.

| ❌ Banned | ✅ Instead |
|---|---|
| Box shadows on cards | Hairline border only |
| Filled / coloured KPI tiles | White card or borderless tile, ink value, small-caps label |
| Rounded ends on bars / charts | Square ends always |
| Colour-coded charts (purple sector, brown geo) | Monochrome ink fill |
| Mixed-weight typographic exuberance | Title = medium, eyebrow = small caps. That's it. |
| Eyebrows that carry data ("equity sleeve · 65% of portfolio is equity") | Pure methodology label ("equity sleeve"). Data goes in KPIs. |
| Sentence-case labels in places small caps belong | `t-micro-cap` for any metadata, methodology, axis label |
| Centre-aligned numbers in tables | Right-align every column of numbers, strict |
| Gradient backgrounds | Solid only. `canvas-soft` outside cards, `canvas` inside. |
| Hero KPI in a coloured background tile | Hero KPI sits on canvas, only the `%` sign gets the semantic colour |
| Card-in-card-in-card nesting | Maximum one level of card nesting. After that, use border-top + label header |
| Multi-paragraph helper text under a section | One sentence max |
| Numbered prefixes on navigation rows | Reserved for editorial ranked lists (top-10 holdings). Don't add to navigation. |

## When you touch an analysis section

Before writing any markup:

1. **Identify the title** — what's this section called? (14px medium ink)
2. **Identify the eyebrow** — what's the methodology footnote? (small caps, 10px, ink-mute, right-aligned)
3. **Identify the data shape** — does it belong as a KPI tile, a fact strip, a chart, or a table? Pick one form, not several.
4. **Wrap in the card** — hairline border, modest radius (`rounded-lg`), white bg, 20–24px padding (`p-5`).
5. **Right-align numeric columns** — non-negotiable.
6. **Eyeball it** — reads like a printed mandate sheet? If it reads like a SaaS dashboard, something in the anti-patterns crept in.

For structural changes (new sections, layout reorganisation), invoke `design-taste-frontend` and pass this file as the brief.

## Living patterns reference

Components that exemplify each pattern. When in doubt, copy from one:

- **Hero header + facts strip:** [components/PortfolioDetail.tsx](components/PortfolioDetail.tsx) (top of the component)
- **Universal section header:** [components/PortfolioDetail.tsx](components/PortfolioDetail.tsx) (`Sector allocation` / `EQUITY SLEEVE`)
- **Editorial KPI tile:** [components/StudioShell.tsx](components/StudioShell.tsx) (`KpiTile` function)
- **Editorial composition bar:** [components/PortfolioDetail.tsx](components/PortfolioDetail.tsx) (`BarsRow` function)
- **Annual return bars:** [components/PortfolioDetail.tsx](components/PortfolioDetail.tsx) (`AnnualReturnsBars` + `computeAnnualReturns`)
- **Sticky chrome with underline chips:** [app/(app)/portfolios/page.tsx](app/(app)/portfolios/page.tsx) (`TabLink` + the sticky div)
- **Editorial grid cell:** [app/(app)/portfolios/page.tsx](app/(app)/portfolios/page.tsx) (`GridCell` function)
- **Editorial table wrapping:** `.table-pro` class in [app/globals.css](app/globals.css) with `overflow-hidden` on the container

When introducing a new pattern, document it here.
