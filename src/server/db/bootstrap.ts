import { sql } from 'drizzle-orm'
import { db, pool } from './client'

const statements = [
  sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  sql`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(255) NOT NULL UNIQUE, name varchar(120) NOT NULL, google_id varchar(255), created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id), name varchar(120) NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS workflows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), name varchar(160) NOT NULL, version integer NOT NULL DEFAULT 1, definition_graph jsonb NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid NOT NULL REFERENCES workflows(id), status varchar(30) NOT NULL DEFAULT 'pending', progress_percent integer NOT NULL DEFAULT 0, config jsonb NOT NULL, error_log text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS assets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid REFERENCES runs(id), type varchar(30) NOT NULL, name varchar(255) NOT NULL, storage_path text NOT NULL, content_type varchar(120) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS product_variants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), design_asset_id uuid NOT NULL REFERENCES assets(id), product_type varchar(40) NOT NULL, status varchar(30) NOT NULL DEFAULT 'pending', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS mockup_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), name varchar(160) NOT NULL, type varchar(30) NOT NULL, product_type varchar(40) NOT NULL, config jsonb NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS mockups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_variant_id uuid NOT NULL REFERENCES product_variants(id), template_id uuid REFERENCES mockup_templates(id), storage_path text, status varchar(30) NOT NULL DEFAULT 'pending', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS marketplace_listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_variant_id uuid NOT NULL REFERENCES product_variants(id), marketplace varchar(40) NOT NULL, external_id varchar(255), status varchar(30) NOT NULL DEFAULT 'draft', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), step_name varchar(80) NOT NULL, status varchar(30) NOT NULL DEFAULT 'queued', retry_count integer NOT NULL DEFAULT 0, error_log text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
]

for (const statement of statements) await db.execute(statement)
await pool.end()
console.log('Database schema ready')
