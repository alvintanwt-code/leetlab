# SKILL: Global Alpha — Fund & Portfolio Fact Sheets

Reusable skill for building institutional-grade, single/double-page fact sheets for Global Alpha (Singapore discretionary portfolio service). Paste this file into your Claude Code project root as `SKILL.md` (or `.claude/skills/fact-sheets/SKILL.md`).

## Purpose
Produce print-ready (US Letter / A4-safe) HTML fact sheets that export cleanly to PDF. Voice and layout follow a "Matrix Book" institutional aesthetic: evidence-first, calm, zero hype.

## Brand system

**Voice**
- Institutional, evidence-first. Claims are observations of data, never promises.
- Sentence-case declarative headlines, italic emphasis mid-sentence ("Returns come from *staying invested*.").
- No exclamation points, no emoji, no "we promise". Numbers do the talking (12.3%, 79 of 120 months).
- Mandatory disclosure line on every page: "Past performance is no guarantee of future results."
- Singapore context: MAS CMS licence line, SGD figures, SRS/accredited-investor wording as applicable.

**Color (flat only — no gradients, no shadows, corner radius 0)**
- Ink `#141614` · White `#FFFFFF` · Hairlines `#D9DAD9` / soft `#EBEBEC`
- Deep teal `#00818B` (headings, key figures on light) · Bright teal `#00B4BE` (hero data, chart fills, bars)
- Red `#E20C10` strictly for negatives + the 32×3px eyebrow accent rule
- Muted text `#545553` / `#838483`

**Type (Google Font substitutes)**
- Headlines/big figures: Bitter (slab serif, weight 500)
- Body: Nunito Sans
- Data labels/tables: Archivo Narrow, letter-spacing 0.08–0.14em, ALL-CAPS section labels at 10.5–11px

**Layout DNA**
- 816×1056px page (Letter @96dpi); side padding 48–56px; strict left alignment
- Sections separated by 1px hairlines; section labels: condensed caps + hairline underline
- One red eyebrow rule + caps eyebrow above the page headline
- Hero figure: 72–92px Bitter in teal, with a condensed caps caption
- Charts: flat filled area (`#00B4BE`), hairline gridlines, condensed year labels; no legends unless needed
- Bars: 8–10px tracks `#EBEBEC`, fills teal; grid rows `label | track | value`
- Negatives always red; benchmarks always muted gray
- Footnote strip: hairline top border, 8.5–9px, muted

## Page recipes

**Front page (narrative-led)**
1. Header: brand caps left, "PORTFOLIO FACT SHEET · [DATE]" right, hairline below
2. Eyebrow rule + "DISCRETIONARY PORTFOLIO SERVICE · SINGAPORE"
3. Declarative serif headline
4. Hero annualized return + 4-stat strip (YTD / 1Y / 3Y p.a. / 5Y p.a.) divided by hairline
5. Daily NAV chart ("S$100,000 invested at inception", net of fees, end value shown right)
6. Two columns: THE MANDATE (serif lines, hairline-separated) | FUND ALLOCATION (name, ISIN, weight, bar)
7. Disclosure footer, "Page 1 of 2"

**Back page (data-led)**
1. Same header; title row: portfolio name (teal serif) + cumulative return (bright teal, right)
2. Left column (~280px): PORTFOLIO DETAILS kv rows · RISK (max drawdown, recovery, volatility, Sharpe, positive months) · HOW THE PORTFOLIO IS RUN paragraph
3. Right column: TOP 10 HOLDINGS (look-through) kv rows · SECTOR BREAKDOWN + GEOGRAPHIC BREAKDOWN bar grids (Morningstar categories: 11 sectors + cash; regions: North America, Europe Developed, UK, Japan, Australasia, Asia Developed…)
4. Disclosure footer, "Page 2 of 2"

## Data conventions
- All returns net of all fees, SGD, dividends reinvested; composite of discretionary accounts
- Holdings/sector/geo are look-through: underlying funds' reported portfolios × target allocation
- Current model portfolio:
  - 55% Amundi Index MSCI World (LU2420245917, SGD)
  - 25% FTGF Royce US Small Cap Opportunity (IE00B66KJ199, SGD Acc)
  - 20% Dimensional Global Targeted Value (IE00BF20L986, SGD Acc)
- Mandate (verbatim, four lines):
  1. We own proven businesses, anywhere in the world.
  2. We favour smaller, profitable companies bought at sensible prices.
  3. We respect market and credit cycles.
  4. We do not trade to look busy. Returns come from staying invested.

## Print/PDF rules
- Two fixed pages, no scrolling, no viewport units; content must fit Letter AND A4 (keep inner content ≤ ~700px wide)
- `* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`
- Text ≥ 9px only for footnotes; body ≥ 12px; tables ≥ 10.5px condensed
- Never rasterize to PDF (no html2canvas/jsPDF) — use the browser print engine

## Prompt for Claude Code (paste as-is)

```
Read SKILL.md in this repo — it defines the Global Alpha fact-sheet brand system,
page recipes, data conventions, and print rules. Follow it exactly.

Build a two-page portfolio fact sheet as a single self-contained HTML file
(fact-sheet.html) for "Global Alpha", dated [AS-OF DATE]:

- Front page: narrative-led per the "Front page" recipe, with a 10-year daily
  NAV chart from the attached CSV [or: simulate on S&P 500 shape if no data yet],
  hero annualized return, YTD/1Y/3Y/5Y strip, the four-line mandate verbatim,
  and the three-fund allocation with ISINs and weight bars.
- Back page: data-led per the "Back page" recipe, with portfolio details, risk
  block, look-through top 10 holdings, and Morningstar sector + geographic
  breakdown bars.

Replace all placeholder figures with the real numbers I provide. Keep every
disclosure line. Match the color, type, and hairline rules in SKILL.md exactly —
no gradients, no shadows, no rounded corners, no emoji. Verify both pages print
to Letter and A4 with no clipping (fixed page size, overflow hidden), then give
me a print-to-PDF path using the browser print engine.
```

## Files in the design project (reference)
- `Fund Fact Sheets.dc.html` — canvas with all explorations (1a–4a)
- `Fund Fact Sheets-print.html` — the shipped two-page Global Alpha print file (best code reference: copy its markup/CSS patterns)
