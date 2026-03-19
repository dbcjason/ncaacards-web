-- Run this in Neon SQL editor once.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL CHECK (job_type IN ('card', 'roster')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error')),
  progress INT NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  request_json JSONB NOT NULL,
  result_json JSONB,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS card_payloads (
  season INT NOT NULL,
  team TEXT NOT NULL,
  player TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'draft',
  destination_conference TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, team, player, mode, destination_conference)
);

CREATE INDEX IF NOT EXISTS idx_card_payloads_lookup
  ON card_payloads (season, team, player, mode, destination_conference);

CREATE TABLE IF NOT EXISTS roster_payloads (
  season INT NOT NULL,
  team TEXT NOT NULL,
  add_hash TEXT NOT NULL,
  remove_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, team, add_hash, remove_hash)
);

CREATE INDEX IF NOT EXISTS idx_roster_payloads_lookup
  ON roster_payloads (season, team, add_hash, remove_hash);

