-- Apply once before deploying paginated recipe lists. PostgreSQL must support ICU.
-- Primary strength matches Intl.Collator sensitivity: base; kn sorts digits naturally.
CREATE COLLATION IF NOT EXISTS recipe_name
  (provider = icu, locale = 'und-u-kn-true-ks-level1', deterministic = false);
