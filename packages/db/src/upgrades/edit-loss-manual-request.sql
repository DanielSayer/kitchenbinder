-- Apply before deploying manual-save recovery. Do not infer identities for old rows
-- from mutable recipe content. Legacy requests must receive an explicit conflict.
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS manual_request_hash text;
