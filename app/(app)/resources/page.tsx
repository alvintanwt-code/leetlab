import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

type Resource = {
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  file: string;    // path under /public
  edition: string; // e.g. "July 2026"
};

// Static registry until an upload UI exists. Drop new PDFs into
// public/resources/ and add a row here.
const RESOURCES: Resource[] = [
  {
    slug: "q3-market-outlook-2026",
    title: "Q3 2026 Market Outlook",
    subtitle:
      "Base case, risks, and the trades we would tighten into the quarter.",
    category: "Market outlook",
    file: "/resources/q3-2026-market-outlook.pdf",
    edition: "July 2026",
  },
  {
    slug: "gwm-fund-factsheet-july-2026",
    title: "GWM Fund Fact Sheet",
    subtitle:
      "Global Alpha discretionary portfolio — one-page composite performance and holdings.",
    category: "Fact sheet",
    file: "/resources/gwm-fund-factsheet-july-2026.pdf",
    edition: "July 2026",
  },
];

function fileMeta(publicPath: string): { available: boolean; sizeLabel: string | null } {
  const abs = join(process.cwd(), "public", publicPath.replace(/^\//, ""));
  if (!existsSync(abs)) return { available: false, sizeLabel: null };
  const bytes = statSync(abs).size;
  const kb = bytes / 1024;
  const sizeLabel = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
  return { available: true, sizeLabel };
}

export default function ResourcesPage() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-20 pb-16">
      <div className="sticky top-0 z-20 -mx-20 mb-12 bg-[var(--color-canvas-soft)] px-20">
        <header className="border-b border-[var(--color-hairline-2)] py-6">
          <p className="t-micro-cap mb-1">leet research</p>
          <h1 className="t-h-md text-[var(--color-ink)]">Resources</h1>
        </header>
      </div>

      <p className="t-body-md text-[var(--color-ink-mute)] max-w-[680px] mb-10">
        Client-facing documents, filed by edition. Click a card to open the PDF in a new tab; the download button forces a save.
      </p>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {RESOURCES.map((r) => (
          <ResourceCard key={r.slug} resource={r} />
        ))}
      </div>
    </div>
  );
}

function ResourceCard({ resource }: { resource: Resource }) {
  const meta = fileMeta(resource.file);
  const isMissing = !meta.available;
  return (
    <article
      className={`group flex flex-col overflow-hidden border border-[var(--color-hairline-2)] bg-[var(--color-canvas)] transition-colors ${
        isMissing ? "opacity-60" : "hover:border-[var(--color-ink)]"
      }`}
    >
      <a
        href={isMissing ? undefined : resource.file}
        target={isMissing ? undefined : "_blank"}
        rel="noopener"
        className="relative block h-[280px] bg-[var(--color-ink)] p-6 text-[var(--color-canvas)]"
        aria-disabled={isMissing}
      >
        <div className="flex h-full flex-col justify-between">
          <div>
            <div className="mb-1 h-[3px] w-8 bg-[#00B4BE]" />
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-canvas-soft)]/70">
              {resource.category}
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
          PDF
        </span>
      </a>

      <div className="flex flex-col gap-3 p-5">
        <p className="t-body-sm text-[var(--color-ink)] leading-snug">{resource.subtitle}</p>
        <div className="flex items-center justify-between border-t border-[var(--color-hairline-2)] pt-3">
          <p className="t-caption text-[var(--color-ink-mute)]">
            {isMissing ? "File not yet uploaded" : meta.sizeLabel}
          </p>
          <div className="flex items-center gap-1.5">
            {!isMissing && (
              <>
                <a
                  href={resource.file}
                  target="_blank"
                  rel="noopener"
                  className="t-caption inline-flex h-7 items-center border border-[var(--color-hairline)] px-2 text-[var(--color-ink)] hover:border-[var(--color-ink)]"
                >
                  Open ↗
                </a>
                <a
                  href={resource.file}
                  download
                  className="t-caption inline-flex h-7 items-center border border-[var(--color-ink)] bg-[var(--color-ink)] px-2 text-[var(--color-canvas)] hover:bg-[var(--color-ink)]/90"
                >
                  Download ↓
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
