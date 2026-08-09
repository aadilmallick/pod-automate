import { sql } from 'drizzle-orm'
import { db, pool } from './client'

const statements = [
  sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  sql`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(255) NOT NULL UNIQUE, name varchar(120) NOT NULL, google_id varchar(255), created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id), name varchar(120) NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS workflows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), name varchar(160) NOT NULL, version integer NOT NULL DEFAULT 1, definition_graph jsonb NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid NOT NULL REFERENCES workflows(id), status varchar(30) NOT NULL DEFAULT 'pending', progress_percent integer NOT NULL DEFAULT 0, config jsonb NOT NULL, error_log text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS assets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid REFERENCES runs(id), workspace_id uuid REFERENCES workspaces(id), type varchar(30) NOT NULL, name varchar(255) NOT NULL, storage_path text NOT NULL, content_type varchar(120) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id)`,
  sql`UPDATE assets SET workspace_id = workflows.workspace_id FROM runs JOIN workflows ON runs.workflow_id = workflows.id WHERE assets.run_id = runs.id AND assets.workspace_id IS NULL`,
  sql`CREATE TABLE IF NOT EXISTS product_variants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), design_asset_id uuid NOT NULL REFERENCES assets(id), product_type varchar(40) NOT NULL, status varchar(30) NOT NULL DEFAULT 'pending', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS mockup_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), name varchar(160) NOT NULL, type varchar(30) NOT NULL, product_type varchar(40) NOT NULL, config jsonb NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS prompt_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), name varchar(160) NOT NULL, prompt text NOT NULL, provider varchar(40) NOT NULL DEFAULT 'fal', model varchar(160), description varchar(255), created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS workspace_connections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), provider varchar(40) NOT NULL, default_model varchar(160) NOT NULL, enabled varchar(10) NOT NULL DEFAULT 'true', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS enabled varchar(10) NOT NULL DEFAULT 'true'`,
  sql`CREATE TABLE IF NOT EXISTS mockups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_variant_id uuid NOT NULL REFERENCES product_variants(id), template_id uuid REFERENCES mockup_templates(id), storage_path text, status varchar(30) NOT NULL DEFAULT 'pending', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS marketplace_listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_variant_id uuid NOT NULL REFERENCES product_variants(id), marketplace varchar(40) NOT NULL, external_id varchar(255), status varchar(30) NOT NULL DEFAULT 'draft', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS external_url text`,
  sql`ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS last_error text`,
  sql`ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS failed_stage varchar(30)`,
  sql`ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS synced_at timestamp`,
  sql`ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS published_at timestamp`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_variant_marketplace ON marketplace_listings(product_variant_id, marketplace)`,
  sql`CREATE TABLE IF NOT EXISTS marketplace_connections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), provider varchar(40) NOT NULL, access_token_encrypted text, refresh_token_encrypted text, token_expires_at timestamp, scopes text[] NOT NULL DEFAULT '{}', external_account_id varchar(255), external_account_name varchar(255), state varchar(30) NOT NULL DEFAULT 'disconnected', settings jsonb NOT NULL DEFAULT '{}', last_error text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS marketplace_connections_workspace_provider ON marketplace_connections(workspace_id, provider)`,
  sql`CREATE TABLE IF NOT EXISTS marketplace_oauth_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), provider varchar(40) NOT NULL, state_hash varchar(64) NOT NULL UNIQUE, verifier_encrypted text NOT NULL, expires_at timestamp NOT NULL, consumed_at timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), step_name varchar(80) NOT NULL, status varchar(30) NOT NULL DEFAULT 'queued', retry_count integer NOT NULL DEFAULT 0, error_log text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
]

await db.execute(sql`SELECT pg_advisory_lock(hashtext('pod-automator-bootstrap'))`)
try {
  for (const statement of statements) await db.execute(statement)
} finally {
  await db.execute(sql`SELECT pg_advisory_unlock(hashtext('pod-automator-bootstrap'))`)
  await pool.end()
}
console.log('Database schema ready')
