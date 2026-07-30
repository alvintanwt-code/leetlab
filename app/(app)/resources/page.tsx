import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { listConfirmedPortfolios } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  aggressive: "Aggressive",
  balanced: "Balanced",
  conservative: "Conservative",
  growth: "Growth",
  dividend_income: "Income",
};

type StaticResource = {
  kind: "static";
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  file: string;
  edition: string;
};

type FactsheetResource = {
  kind: "factsheet";
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  provider: string;
  edition: string;
  openHref: string;
  downloadHref: string;
};

type Resource = StaticResource | FactsheetResource;

const STATIC_RESOURCES: StaticResource[] = [
  {
    kind: "static",
    slug: "q3-market-outlook-2026",
    title: "Q3 2026 Market Outlook",
    subtitle: "Base case, risks, and the trades we would tighten into the quarter.",
    category: "Market outlook",
    file: "/resources/q3-2026-market-outlook.pdf",
    edition: "July 2026",
  },
  {
    kind: "static",
    slug: "best-and-worst-years",
    title: "Best and Worst Years",
    subtitle: "Rolling-period best and worst returns for S&P 500, Global Aggregate Bond, and MSCI EM — for use in client conversations about volatility.",
    category: "Conversation aid",
    file: "/resources/best-and-worst-years.jpg",
    edition: "June 2026",
  },
  {
    kind: "static",
    slug: "fund-flows",
    title: "Highest Selling Occurs During Market Crashes",
    subtitle: "Fund-flow evidence that retail investors sell hardest at market lows — the case for staying invested.",
    category: "Conversation aid",
    file: "/resources/fund-flows.jpg",
    edition: "June 2026",
  },
  {
    kind: "static",
    slug: "stock-gains-after-decline",
    title: "Stock Gains Add Up After Decline",
    subtitle: "How cumulative equity returns compound after major drawdowns — for reframing loss aversion.",
    category: "Conversation aid",
    file: "/resources/stock-gains-after-decline.jpg",
    edition: "June 2026",
  },
  {
    kind: "static",
    slug: "intra-decline",
    title: "Annual vs Intra-Year Decline",
    subtitle: "Calendar-year returns plotted against the deepest intra-year drop — normalising the volatility clients feel.",
    category: "Conversation aid",
    file: "/resources/intra-decline.jpg",
    edition: "June 2026",
  },
];

function fileExt(publicPath: string): string {
  const m = publicPath.match(/\.([a-z0-9]+)$/i);
  return (m?.[1] ?? "").toLowerCase();
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);

const PROVIDER_SHORT: Record<string, string> = {
  hsbc: "HSBC",
  fwd: "FWD",
  tmls: "Tokio Marine",
  gwm: "GWM",
};

function fileMeta(publicPath: string): { available: boolean; sizeLabel: string | null } {
  const abs = join(process.cwd(), "public", publicPath.replace(/^\//, ""));
  if (!existsSync(abs)) return { available: false, sizeLabel: null };
  const bytes = statSync(abs).size;
  const kb = bytes / 1024;
  const sizeLabel = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
  return { available: true, sizeLabel };
}

function editionLabel(iso: string): string {
  const [y, m] = iso.split("-").map((s) => parseInt(s, 10));
  return new Date(y, (m ?? 1) - 1, 1).toLocaleString("en-SG", { month: "long", year: "numeric" });
}

export default async function ResourcesPage() {
  const portfolios = await listConfirmedPortfolios();
  const seen = new Set<string>();
  const factsheets: FactsheetResource[] = [];
  for (const p of portfolios) {
    const key = `${p.provider_slug}-${p.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cat = CATEGORY_LABEL[p.category] ?? p.category;
    const provider = PROVIDER_SHORT[p.provider_slug] ?? p.provider_name;
    factsheets.push({
      kind: "factsheet",
      slug: `factsheet-${p.provider_slug}-${p.category}`,
      title: p.name,
      subtitle: `${cat} model portfolio · composite performance, holdings, and allocations for ${provider}.`,
      category: "Fact sheet",
      provider,
      edition: editionLabel(new Date().toISOString().slice(0, 7)),
      openHref: `/api/factsheet/${p.id}`,
      downloadHref: `/api/factsheet/${p.id}?download=1&format=pdf`,
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-20 pb-16">
      <div className="sticky top-0 z-20 -mx-20 mb-4 bg-[var(--color-canvas-soft)] px-20">
        <header className="border-b border-[var(--color-hairline-2)] py-6">
          <p className="t-micro-cap mb-1">leet research</p>
          <h1 className="t-h-md text-[var(--color-ink)]">Resources</h1>
        </header>
      </div>

      <p className="t-body-sm text-[var(--color-ink-mute)] max-w-[680px] mb-8">
        Client-facing documents. Open renders inline; Download saves the PDF. Fact sheets re-render from the latest monthly archive on each click.
      </p>

      {/* Market commentary — standalone row up top */}
      <section className="mb-16">
        <div className="mb-5 flex items-baseline justify-between">
          <p className="t-micro-cap text-[var(--color-ink)]">Market commentary</p>
          <p className="t-caption text-[var(--color-ink-mute)]">Quarterly + event-driven notes</p>
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {STATIC_RESOURCES.map((r) => (
            <ResourceCard key={r.slug} resource={r} />
          ))}
        </div>
      </section>

      {/* Hairline divider */}
      <div className="mb-16 border-t border-[var(--color-hairline)]" aria-hidden />

      {/* Fact sheets — 4-column grid of smaller cards */}
      <section>
        <div className="mb-5 flex items-baseline justify-between">
          <p className="t-micro-cap text-[var(--color-ink)]">Fact sheets</p>
          <p className="t-caption text-[var(--color-ink-mute)]">
            {factsheets.length} · one per confirmed model portfolio
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {factsheets.map((r) => (
            <ResourceCard key={r.slug} resource={r} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ResourceCard({ resource }: { resource: Resource }) {
  const isStatic = resource.kind === "static";
  const meta = isStatic ? fileMeta(resource.file) : { available: true, sizeLabel: "Live" };
  const isMissing = !meta.available;
  const openHref = isStatic
    ? isMissing ? undefined : resource.file
    : resource.openHref;
  const downloadHref = isStatic ? resource.file : resource.downloadHref;
  const ext = isStatic ? fileExt(resource.file) : "";
  const isImage = isStatic && IMAGE_EXTS.has(ext);
  const isPdf = isStatic && !isImage;
  const badgeLabel = isImage ? "IMG" : isPdf ? "PDF" : "HTML · PDF";
  const downloadLabel = isImage ? `${ext.toUpperCase()} ↓` : "PDF ↓";
  const isConversationAid = resource.category === "Conversation aid";
  const accent = isConversationAid ? "#0d253d" : isStatic ? "#00B4BE" : "#E20C10";
  const heroBg = isConversationAid ? "#f5e9d4" : "#0d253d";
  const heroFg = isConversationAid ? "#0d253d" : "#ffffff";
  const heroMeta = isConversationAid ? "#64748d" : "rgba(246,249,252,0.7)";

  return (
    <article
      className={`group flex flex-col overflow-hidden border border-[var(--color-hairline-2)] bg-[var(--color-canvas)] transition-colors ${
        isMissing ? "opacity-60" : "hover:border-[var(--color-ink)]"
      }`}
    >
      <a
        href={openHref}
        target={openHref ? "_blank" : undefined}
        rel="noopener"
        className="relative block h-[200px] p-4"
        style={{ background: heroBg, color: heroFg }}
        aria-disabled={isMissing}
      >
        <div className="flex h-full flex-col justify-between">
          <div>
            <div className="mb-1 h-[2px] w-6" style={{ background: accent }} />
            <p className="text-[9px] uppercase tracking-[0.14em]" style={{ color: heroMeta }}>
              {resource.category}
              {!isStatic && (
                <>
                  <span className="mx-1">·</span>
                  {(resource as FactsheetResource).provider}
                </>
              )}
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-[0.14em] mb-1.5" style={{ color: heroMeta }}>
              {resource.edition}
            </p>
            <h3
              className="text-[16px] leading-tight tracking-tight font-medium"
              style={{ fontFamily: "'Bitter', Georgia, serif" }}
            >
              {resource.title}
            </h3>
          </div>
        </div>
        <span className="absolute right-3 top-3 text-[9px] uppercase tracking-[0.14em]" style={{ color: heroMeta }}>
          {badgeLabel}
        </span>
      </a>

      <div className="flex flex-col gap-2.5 p-3.5">
        <p className="t-caption text-[var(--color-ink)] leading-snug line-clamp-2">{resource.subtitle}</p>
        <div className="flex items-center justify-between border-t border-[var(--color-hairline-2)] pt-2.5">
          <p className="text-[10px] text-[var(--color-ink-mute)]">
            {isMissing ? "Not uploaded" : meta.sizeLabel}
          </p>
          <div className="flex items-center gap-1">
            {!isMissing && openHref && (
              <>
                <a
                  href={openHref}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex h-6 items-center border border-[var(--color-hairline)] px-1.5 text-[10px] text-[var(--color-ink)] hover:border-[var(--color-ink)]"
                >
                  Open ↗
                </a>
                <a
                  href={downloadHref}
                  {...(isStatic ? { download: true } : {})}
                  className="inline-flex h-6 items-center border border-[var(--color-ink)] bg-[var(--color-ink)] px-1.5 text-[10px] text-[var(--color-canvas)] hover:bg-[var(--color-ink)]/90"
                >
                  {downloadLabel}
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
