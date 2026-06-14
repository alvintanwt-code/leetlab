CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "fund_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"fund_id" integer NOT NULL,
	"as_of" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"weight_pct" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"fund_id" integer NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"source_url" text,
	"local_path" text,
	"fetched_at" timestamp with time zone,
	CONSTRAINT "fund_documents_fund_type_idx" UNIQUE("fund_id","type")
);
--> statement-breakpoint
CREATE TABLE "fund_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"fund_id" integer NOT NULL,
	"as_of" text NOT NULL,
	"nav" real,
	"currency" text,
	"change_pct" real,
	"ann_1y" real,
	"ann_3y" real,
	"ann_5y" real,
	"ann_10y" real,
	"ann_since" real,
	"alpha_3y" real,
	"beta_3y" real,
	"sharpe_3y" real,
	"stddev_3y" real,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_snapshots_fund_asof_idx" UNIQUE("fund_id","as_of")
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"isin" text,
	"fund_house" text,
	"currency" text,
	"asset_class" text,
	"distribution_type" text,
	"risk_rating" integer,
	"risk_label" text,
	"share_class_inception" text,
	"fund_size" real,
	"fund_size_currency" text,
	"fund_size_as_of" text,
	"dealing_frequency" text,
	"benchmark" text,
	"sfdr_classification" text,
	"expense_ratio" real,
	"management_fee" real,
	"morningstar_rating" integer,
	"investment_objective" text,
	"status" text DEFAULT 'active' NOT NULL,
	"source_url" text NOT NULL,
	"last_scraped_at" timestamp with time zone,
	CONSTRAINT "funds_provider_external_idx" UNIQUE("provider_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "model_portfolio_holdings" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"fund_id" integer NOT NULL,
	"weight_bps" integer NOT NULL,
	CONSTRAINT "mph_portfolio_fund_idx" UNIQUE("portfolio_id","fund_id")
);
--> statement-breakpoint
CREATE TABLE "model_portfolios" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"xray_json" text,
	"created_by" text,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "model_portfolios_p_c_n_v_idx" UNIQUE("provider_id","category","name","version")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_allocations" ADD CONSTRAINT "fund_allocations_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_documents" ADD CONSTRAINT "fund_documents_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_snapshots" ADD CONSTRAINT "fund_snapshots_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_portfolio_holdings" ADD CONSTRAINT "model_portfolio_holdings_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_portfolio_holdings" ADD CONSTRAINT "model_portfolio_holdings_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_portfolios" ADD CONSTRAINT "model_portfolios_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_portfolios" ADD CONSTRAINT "model_portfolios_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_portfolios" ADD CONSTRAINT "model_portfolios_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;