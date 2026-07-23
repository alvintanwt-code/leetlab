// Server-side HTML → PDF pipeline using headless Chromium.
//   - Vercel serverless: @sparticuz/chromium ships a Linux-compatible
//     Chromium binary inside the function bundle.
//   - Local dev: falls back to whichever Chrome the developer has
//     installed on the host, via CHROME_EXECUTABLE or the standard
//     macOS location.
//
// Keeps CSS pagination in charge (preferCSSPageSize: true) so the
// same @page rule that governs manual Cmd+P also governs the server
// output — no duplicate margins, no width fights.

// Type-only import — actual module resolved dynamically below so
// bundlers don't try to inline the ~50 MB chromium binary on paths
// that don't need it.
import type { Browser } from "puppeteer-core";

const LOCAL_CHROME_CANDIDATES = [
  process.env.CHROME_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
].filter((p): p is string => !!p);

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  const isVercel = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isVercel) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  // Local dev — try known Chrome paths in order.
  const { existsSync } = await import("node:fs");
  const executablePath = LOCAL_CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) {
    throw new Error(
      "No local Chrome / Chromium found. Install Chrome or set CHROME_EXECUTABLE to its binary path.",
    );
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    // Explicitly wait for webfonts — Bitter / Nunito Sans / Archivo Narrow
    // are the editorial voice, and puppeteer's "load" event fires before
    // they finish downloading.
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      timeout: 30_000,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
