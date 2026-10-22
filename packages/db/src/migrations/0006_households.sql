CREATE TABLE household (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE household_member (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX household_member_household_idx ON household_member(household_id);
CREATE TABLE household_invite (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  accepted_at timestamptz
);
CREATE INDEX household_invite_household_idx ON household_invite(household_id);

ALTER TABLE meal_planner ADD COLUMN id text;
UPDATE meal_planner SET id = 'personal:' || user_id;
ALTER TABLE meal_planner DROP CONSTRAINT meal_planner_pkey;
ALTER TABLE meal_planner ADD PRIMARY KEY (id);
ALTER TABLE meal_planner ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE meal_planner ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE meal_planner ADD UNIQUE (user_id);
ALTER TABLE meal_planner ADD COLUMN household_id uuid UNIQUE REFERENCES household(id) ON DELETE CASCADE;
ALTER TABLE meal_planner ADD CONSTRAINT meal_planner_scope_check CHECK (num_nonnulls(user_id, household_id) = 1);

ALTER TABLE shopping_item ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE shopping_item ADD COLUMN household_id uuid REFERENCES household(id) ON DELETE CASCADE;
CREATE INDEX shopping_item_household_idx ON shopping_item(household_id);
ALTER TABLE shopping_item ADD CONSTRAINT shopping_item_scope_check CHECK (num_nonnulls(user_id, household_id) = 1);

ALTER TABLE shopping_plan DROP CONSTRAINT shopping_plan_pkey;
ALTER TABLE shopping_plan ADD PRIMARY KEY (id);
ALTER TABLE shopping_plan ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE shopping_plan ADD UNIQUE (user_id);
ALTER TABLE shopping_plan ADD COLUMN household_id uuid UNIQUE REFERENCES household(id) ON DELETE CASCADE;
ALTER TABLE shopping_plan ADD CONSTRAINT shopping_plan_scope_check CHECK (num_nonnulls(user_id, household_id) = 1);
