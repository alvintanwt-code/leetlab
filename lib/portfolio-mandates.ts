// Canonical mandate copy keyed by `model_portfolios.category`.
// Same paragraph reused across every platform — edit in place to refine.
// Pulled into the /portfolios card and any future detail header.

export type PortfolioMandate = {
  tagline: string;   // Single editorial line under the title
  objective: string; // 1–2 sentences on investment objective
  suitability: string; // 1 sentence on the target investor
};

export const PORTFOLIO_MANDATES: Record<string, PortfolioMandate> = {
  conservative: {
    tagline: "Capital preservation with measured income.",
    objective:
      "Prioritises stability and downside protection. Built around investment-grade fixed income with a small return-seeking sleeve.",
    suitability:
      "Suited to investors with a near-term horizon or low tolerance for drawdown.",
  },
  balanced: {
    tagline: "Steady growth across a diversified core.",
    objective:
      "A globally diversified mix of equities and fixed income engineered for moderate growth across full market cycles.",
    suitability:
      "Suited to investors with a medium horizon comfortable with cyclical drawdowns.",
  },
  growth: {
    tagline: "Long-term capital appreciation.",
    objective:
      "Equity-tilted growth engine with a modest fixed-income ballast. Designed to compound through full market cycles.",
    suitability:
      "Suited to investors with a long horizon willing to ride volatility.",
  },
  aggressive: {
    tagline: "Maximum long-term growth.",
    objective:
      "Predominantly equity, with thematic and emerging-market exposure for additional return potential. Volatility is expected.",
    suitability:
      "Suited to investors with a long horizon and high tolerance for drawdown.",
  },
  dividend_income: {
    tagline: "Durable income with capital stability.",
    objective:
      "Built for regular cashflow from income-generating equities, credit and alternatives. Yield is the primary objective; capital appreciation secondary.",
    suitability:
      "Suited to investors prioritising cashflow over growth.",
  },
};

export const CATEGORY_LABELS: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  growth: "Growth",
  aggressive: "Aggressive",
  dividend_income: "Income",
};

// Display order for the strategy chip rail.
export const CATEGORY_ORDER: string[] = [
  "conservative",
  "balanced",
  "growth",
  "aggressive",
  "dividend_income",
];
