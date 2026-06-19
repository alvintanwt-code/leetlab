# Fund Switch — design brief

The source of truth for tokens is **[DESIGN-stripe.md](./DESIGN-stripe.md)**. The product-wide structural and component contract is **[DESIGN.md](./DESIGN.md)** (Editorial Mandate Sheet). This file is the **Fund Switch–specific brief** layered on top of those two — read both first.

For any structural change to a Fund Switch surface, invoke `design-taste-frontend` and pass this file as the brief.

---

## Intent

Fund Switch is an **ephemeral, single-screen report generator** an advisor uses live in client meetings. It reads as a printed switch memo, not a SaaS form. The product is the conversation — the UI's job is to disappear behind a clean editorial document the client can be walked through.

Two audiences:
- **Advisor (prep):** types or pastes a client's holdings, picks the target model per platform, reviews the generated rationale before the meeting.
- **Client (in-meeting):** looks at the rendered report only — does not interact.

Tone: PhillipCapital DPM mandate sheet meets a private-bank one-pager. Monochrome ink + one indigo accent, hairlines not fills, tabular numbers, no dashboard exuberance.

## Surface scope

- Route: `/switch`
- Shell: lives inside the persistent left-sidebar shell (same 1280px max container, `px-10 py-10`) — see [DESIGN.md](./DESIGN.md) layout shell.
- No top bar, no breadcrumb. The sidebar is the wayfinder.

## Persistence — hard constraint

- **Zero database writes** for client portfolios or generated analyses.
- All state is per-session, server-memory only.
- ~20 concurrent advisors → state must be keyed by `session.user.id` and never cross-pollinate.
- Closing the tab discards the work. PDF export is the only artefact.
- No client PII in URL params, ever.

## Page anatomy

```
┌──────────────────────────────────────────────────────────────────┐
│  ⌽ FUND SWITCH                                                   │
│  Client portfolio in, switch narrative out.                      │
│  (display-md ink, body-md ink-mute below)                        │
├──────────────────────────────────────────────────────────────────┤
│  [STICKY CHROME — platform tabs]                                 │
│  PLATFORM   HSBC    FWD    TM    GWM            [+ new client]   │
│  (h-[52px], underline-style chips, t-micro-cap eyebrow)          │
├────────────────────────────┬─────────────────────────────────────┤
│  CLIENT PORTFOLIO          │  TARGET MODEL                       │
│  (hairline card, p-5)      │  (hairline card, p-5)               │
│                            │                                     │
│  [editable holdings table] │  [list of confirmed portfolios      │
│  fund · units · cost · val │   for the current platform tab]     │
│                            │                                     │
│  [+ add row]               │  selection: 2px ink left bar +      │
│                            │  canvas-soft bg (sidebar-active)    │
├────────────────────────────┴─────────────────────────────────────┤
│  [GENERATE SWITCH] — single primary pill, only one on the page   │
└──────────────────────────────────────────────────────────────────┘
                          ↓ on generate ↓
┌──────────────────────────────────────────────────────────────────┐
│  [SWITCH MEMO — replaces input area, full-width]                 │
│  [eyebrow strip] CLIENT INITIALS · HSBC · PROPOSED 19 JUN 2026   │
│  CURRENT → BAL GROWTH MODEL              +2.1%                   │
│  (display-md, hero KPI = expected-return delta, %-sign coloured) │
│                                                                  │
│  [mandate facts strip — 4 cells, no dividers]                    │
│  EXP RETURN     EXP RISK     OCF DELTA    HOLDINGS               │
│  +2.1%          −0.4         −0.18%       6 → 4                  │
│                                                                  │
│  [section: Asset-class drift] — composition delta bars           │
│  [section: Weight changes] — editorial table w/ why-column       │
│  [section: Outlook] — house-voice prose, 2–3 paragraphs          │
│  [section: Proposed x-ray] — final state, mandate-sheet style    │
│                                                                  │
│  [actions row, right-aligned]   ← Edit inputs    Export PDF →    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component patterns (Fund Switch–specific)

Every pattern below inherits from [DESIGN.md](./DESIGN.md). Only the deltas are spelled out here.

### Platform tabs (sticky chrome)

Re-uses the **sticky chrome + underline chips** pattern from [app/(app)/portfolios/page.tsx](app/(app)/portfolios/page.tsx).

- One row, `h-[52px]`, `bg-canvas-soft`, sticky `top-0`.
- Eyebrow `PLATFORM` (`t-micro-cap`, fixed `w-20`) left. Chips right: `HSBC`, `FWD`, `TM`, `GWM`.
- Active chip: ink + 2px ink underline aligned with the row's bottom hairline. Inactive: ink-mute. Disabled (no models for client on that platform): faded at 55%.
- Each tab persists its own in-memory `{ clientPortfolio, selectedModelId }` for the session. Switching tabs is instant — no fetch.

The tabs are how the advisor prepares all of a client's portfolios in advance and flicks between them during the meeting.

### Client portfolio card (left panel)

A **single hairline card** (`rounded-lg border-hairline bg-canvas p-5`) containing an editable holdings table.

- Card header: title `Client portfolio` (14px medium ink, universal section header) + eyebrow `CURRENT HOLDINGS` (right-aligned, `t-micro-cap`).
- Table follows the **table-pro** pattern from [DESIGN.md](./DESIGN.md) — fixed layout, sticky header on overflow.
- Columns: `Fund` (cell-fund) · `Units` (right, tabular) · `Cost basis` (right, tabular, `SGD` prefix) · `Current value` (right, tabular, `SGD` prefix).
- Last row is a `+ add holding` row — ink-mute, dashed top-hairline, becomes editable on click.
- Empty state: no card chrome change; the table body shows one half-filled placeholder row with the input fields visible. No empty-state illustration.
- Input affordance: cells are not visibly form-styled at rest. Click reveals a thin focus ring (`focus-input` token from DESIGN-stripe). Reads as a document, edits as a form.

Vision parsing (paste a screenshot, parse to rows) is **out of v1**. Reserve real estate for an `Upload statement` ghost button in the card footer for later — leave a `TODO` comment but don't render it yet.

### Target model card (right panel)

Same hairline card chrome. Lists confirmed model portfolios filtered to the **current platform tab**.

- Card header: `Target model` title + `HSBC · CONFIRMED` eyebrow (the eyebrow updates per platform tab).
- Each model row: name (14px medium ink, single line, truncate) + meta line (`t-micro-cap`, ink-mute) showing risk dots + expected return.
- Selection: **left 2px ink bar + canvas-soft background** (matches the active-sidebar-row treatment from DESIGN.md). Only one selected at a time.
- No checkboxes, no radios. Selection is implicit in the visual treatment.
- Empty state (no confirmed models on that platform): hairline-2 placeholder block with `t-micro-cap` text `No confirmed models on this platform yet`.

### Generate button

- One filled pill, full row width (or right-anchored — design choice when implementing). `button-primary-pill` per DESIGN-stripe.
- Disabled until: at least one valid holding row + a model selected.
- Disabled state: `canvas-soft` bg, `ink-mute` text, no border. No tooltip — the button label changes from `Generate switch` to `Add holdings and pick a model` when disabled.

### Switch memo (the generated report)

Replaces the input grid; the input grid is recoverable via an `← Edit inputs` link at the top of the memo. The memo is the **hero artefact** — it must read like a printed document, not a results panel.

Stacks the following sections, all using existing editorial primitives:

1. **Eyebrow strip** — `CLIENT INITIALS · PLATFORM · PROPOSED [date]` (see DESIGN.md eyebrow-strip spec). Client initials only, never full name — that's the PII guardrail surfacing as a typographic choice.
2. **Hero header** — `CURRENT → MODEL NAME` left, hero KPI right. The KPI is the **expected-return delta** (e.g. `+2.1%`) with the `%` sign carrying the semantic colour. Negative deltas use the proper minus glyph.
3. **Mandate facts strip** — 4 cells, no dividers: `EXP RETURN` · `EXP RISK` · `OCF DELTA` · `HOLDINGS` (`n → m`).
4. **Asset-class drift** — composition bars in delta form. Two stacked rows per asset class: current (ink) and proposed (ink at lower opacity or ink-mute). Right side: the delta as a tabular number with `+` or `−` glyph. No colours.
5. **Weight changes (the why-table)** — editorial table:
   - Columns: `Fund` · `Current %` · `Proposed %` · `Δ` · `Rationale`.
   - `Rationale` cell is plain prose in `body-md`, one short sentence. Generated text — exact rules drafted later.
   - Rows grouped by action: **Reduce**, **Add**, **Switch**. Group label is a small-caps sub-header row (`t-micro-cap`, ink-mute, hairline-top).
6. **Outlook** — 2–3 paragraphs in `body-md`, house voice. Universal section header `Outlook` left, eyebrow `HOUSE VIEW` right. No bullet lists — paragraphs only.
7. **Proposed x-ray** — the destination portfolio rendered in the same mandate-sheet form `PortfolioDetail` uses. Reuses sector/geo/holdings sub-patterns from [components/PortfolioDetail.tsx](components/PortfolioDetail.tsx).

### Actions row (under the memo)

Right-aligned, hairline-top, `py-5`.

- Left: `← Edit inputs` text link (`link-on-light`, no underline at rest).
- Right: `Export PDF` filled pill. v1 has no other actions. HTML export, email-to-advisor, email-to-client are documented in [project-leetlab-state](memory) as deferred.

### PDF export

The PDF is **a snapshot of the memo as the advisor sees it on screen**, not a re-templated document.

- Print-styled stylesheet: hide sidebar, hide sticky chrome, hide actions row.
- Page break: each top-level memo section is `break-inside: avoid` where reasonable.
- Letter-sized, 18mm margins, single column.
- Footer (print-only): page number + `Prepared by [advisor name] · [date]` in `t-micro-cap`. No client name in footer.

---

## Numbers — Fund Switch specifics

Inherits the DESIGN.md numbers rules (`tabular-nums + ss01 + tnum`, real minus glyph, `+` prefix on positives).

Additions:

- **Currency:** always `SGD` prefix with non-breaking space — `SGD 12,400`. Cost basis and current value are SGD.
- **Deltas:** `+2.1%`, `−0.4` (risk units). Always signed. Zero deltas render as `—`, not `0.0%`.
- **OCF delta:** 3-decimal precision (`+0.182%`).
- **Risk:** the 5-dot pip row from DESIGN.md. Delta risk = two rows stacked with a small `→` between, not a numeric delta.

---

## Tokens used (quick reference)

All from [DESIGN-stripe.md](./DESIGN-stripe.md):

- Surface: `canvas` (cards), `canvas-soft` (sticky chrome, disabled), `hairline` (borders), `hairline-2` (intra-card dividers).
- Ink: `ink` (titles, values), `ink-mute` (eyebrows, helper, rationale prose), `ink-secondary` (rarely — reserved).
- Accent: `primary` only on the single Generate pill, Export PDF pill, and the hero KPI's `%` sign when positive. `negative` for negative `%` signs. Nothing else gets colour.
- Type: `t-display-md` page title · `t-h-lg` memo hero · `t-micro-cap` every eyebrow · `body-md` prose · `body-tabular` every number.

---

## Anti-patterns — refuse these

Inherits all of DESIGN.md's anti-patterns. Adds:

| ❌ Banned in Fund Switch | ✅ Instead |
|---|---|
| Wizard / multi-step modal | Single screen, both panels visible, tab-switched for multi-portfolio |
| "Drag and drop" UI for holdings | Editable table rows. Period. |
| Coloured delta cells (green/red fills on `+` / `−`) | Ink number, semantic colour only on the sign glyph |
| Stacked bar charts for asset-class drift | Two-row composition bars (current + proposed) with a delta number on the right |
| Side-by-side current/proposed in **two separate full x-ray panels** | One proposed x-ray + a delta strip — keeps the document feel, kills the dashboard feel |
| Pre-filled mock client data on first load | Empty inputs, ink-mute placeholder row, no example data |
| Toast / banner confirming "Generated!" | The memo appearing IS the confirmation |
| "Save to dashboard" / "Recent switches" | Persistence is an explicit non-goal — no UI hints suggesting it exists |
| Client full name on screen | Initials only in the eyebrow strip; cards show `Client portfolio` not the name |
| Multiple primary pills on one page | One filled pill at a time: Generate before, Export after |
| Loading spinner on Generate | Replace inputs with a skeleton of the memo (mandate strip + bar rows in `hairline-2`) and stream content in |

---

## When you touch a Fund Switch surface

1. Re-read DESIGN.md mandate sheet rules — they all apply.
2. Identify which existing component / pattern you can lift (sticky chrome from `/portfolios`, KPI tile from StudioShell, composition bars + mandate facts strip from PortfolioDetail).
3. Do not invent a new card style. Hairline + `rounded-lg` + white bg + `p-5`. That's it.
4. Right-align every number. Tabular figures, non-negotiable.
5. Run the design-taste-frontend skill with this file + DESIGN.md passed as the brief for any structural change.
6. Eyeball test: if a screenshot of the memo could pass for a PhillipCapital DPM switch one-pager, you're there.

---

## Out of scope — v1

Documented so we don't drift:

- Vision parsing of statement screenshots (paste/type only for v1).
- HTML export, email-to-advisor, email-to-client.
- Persisted history of past switches.
- Multi-client comparison.
- Exact prose-generation rules for `why reduce` / `why add` / `why switch` — to be drafted in a separate brief.
- Authenticated client view (clients don't log in; this is an advisor tool only).
