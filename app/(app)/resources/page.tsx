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

// Two kinds of card: static PDFs uploaded to /public/resources/ (Market
// Outlook etc.) and dynamic fact sheets served fresh from the archive.
type StaticResource = {
  kind: "static";
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  file: string;    // path under /public
  edition: string;
};

type FactsheetResource = {
  kind: "factsheet";
  slug: string;
  title: string;
  subtitle: string;
  category: string; // "Fact sheet"
  provider: string; // "HSBC" / "FWD" / etc.
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
];

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
  // Dedup — same portfolio may exist in multiple versions; keep the newest.
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

  const resources: Resource[] = [...STATIC_RESOURCES, ...factsheets];

  return (
    <div className="mx-auto w-full max-w-[1280px] px-20 pb-16">
      <div className="sticky top-0 z-20 -mx-20 mb-12 bg-[var(--color-canvas-soft)] px-20">
        <header className="border-b border-[var(--color-hairline-2)] py-6">
          <p className="t-micro-cap mb-1">leet research</p>
          <h1 className="t-h-md text-[var(--color-ink)]">Resources</h1>
        </header>
      </div>

      <p className="t-body-md text-[var(--color-ink-mute)] max-w-[680px] mb-10">
        Client-facing documents, one card per artifact. Open renders inline; Download saves the PDF. Fact sheets are re-served from the latest monthly archive on each click.
      </p>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {resources.map((r) => (
          <ResourceCard key={r.slug} resource={r} />
        ))}
      </div>
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
  const isPdf = isStatic;

  // Accent colour distinguishes the two card types.
  const accent = isStatic ? "#00B4BE" : "#E20C10";

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
        className="relative block h-[280px] bg-[var(--color-ink)] p-6 text-[var(--color-canvas)]"
        aria-disabled={isMissing}
      >
        <div className="flex h-full flex-col justify-between">
          <div>
            <div className="mb-1 h-[3px] w-8" style={{ background: accent }} />
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-canvas-soft)]/70">
              {resource.category}
              {!isStatic && (
                <>
                  <span className="mx-1.5">·</span>
                  {(resource as FactsheetResource).provider}
                </>
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-canvas-soft)]/70 mb-2">
              {resource.edition}
            </p>
            <h3
              className="text-[22px] leading-tight tracking-tight font-medium"
              style={{ fontFamily: "'Bitter', Georgia, serif" }}
            >
              {resource.title}
            </h3>
          </div>
        </div>
        <span className="absolute right-4 top-4 text-[10px] uppercase tracking-[0.14em] text-[var(--color-canvas-soft)]/60">
          {isPdf ? "PDF" : "HTML · PDF"}
        </span>
      </a>

      <div className="flex flex-col gap-3 p-5">
        <p className="t-body-sm text-[var(--color-ink)] leading-snug">{resource.subtitle}</p>
        <div className="flex items-center justify-between border-t border-[var(--color-hairline-2)] pt-3">
          <p className="t-caption text-[var(--color-ink-mute)]">
            {isMissing ? "File not yet uploaded" : meta.sizeLabel}
          </p>
          <div className="flex items-center gap-1.5">
            {!isMissing && openHref && (
              <>
                <a
                  href={openHref}
                  target="_blank"
                  rel="noopener"
                  className="t-caption inline-flex h-7 items-center border border-[var(--color-hairline)] px-2 text-[var(--color-ink)] hover:border-[var(--color-ink)]"
                >
                  Open ↗
                </a>
                <a
                  href={downloadHref}
                  {...(isStatic ? { download: true } : {})}
                  className="t-caption inline-flex h-7 items-center border border-[var(--color-ink)] bg-[var(--color-ink)] px-2 text-[var(--color-canvas)] hover:bg-[var(--color-ink)]/90"
                >
                  Download{isStatic ? " ↓" : " PDF ↓"}
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
