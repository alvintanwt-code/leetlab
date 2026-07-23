CREATE TABLE IF NOT EXISTS "portfolio_factsheets" (
  "id" serial PRIMARY KEY,
  "portfolio_id" integer NOT NULL REFERENCES "model_portfolios"("id") ON DELETE CASCADE,
  "as_of_month" text NOT NULL,
  "html_content" text NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE ("portfolio_id", "as_of_month")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_factsheets_portfolio_month_idx" ON "portfolio_factsheets" ("portfolio_id", "as_of_month" DESC);
