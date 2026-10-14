-- Stop old workers, apply after reliable-imports.sql, then deploy web and workers.
-- Safe to apply again, including after a fresh schema installation.
BEGIN;
ALTER TABLE recipe_import ADD COLUMN IF NOT EXISTS save_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE recipe_import ADD COLUMN IF NOT EXISTS next_save_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE recipe_import ADD COLUMN IF NOT EXISTS save_claimed_at timestamptz;
CREATE INDEX IF NOT EXISTS recipe_import_save_retry_idx ON recipe_import (state, next_save_attempt_at);
COMMIT;
