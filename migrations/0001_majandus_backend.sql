CREATE TABLE households (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  owner_member_id TEXT NOT NULL,
  owner_marker INTEGER NOT NULL DEFAULT 1 CHECK (owner_marker = 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (id, owner_member_id, owner_marker)
    REFERENCES users(household_id, id, owner_marker)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  owner_marker INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN role = 'OWNER' AND revoked_at IS NULL THEN 1
      ELSE 0
    END
  ) STORED NOT NULL,
  UNIQUE (household_id, id, owner_marker),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_users_one_active_owner
  ON users(household_id)
  WHERE role = 'OWNER' AND revoked_at IS NULL;

CREATE TABLE device_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  device_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE one_time_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  subject_user_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('INVITE', 'DEVICE_LINK', 'MEMBER_RECOVERY')),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > created_at),
  consumed_at TEXT,
  consumed_by_user_id TEXT,
  revoked_at TEXT,
  CHECK (
    (purpose = 'INVITE' AND subject_user_id IS NULL)
    OR (purpose IN ('DEVICE_LINK', 'MEMBER_RECOVERY') AND subject_user_id IS NOT NULL)
  ),
  CHECK ((consumed_at IS NULL) = (consumed_by_user_id IS NULL)),
  CHECK (consumed_at IS NULL OR (revoked_at IS NULL AND consumed_at <= expires_at)),
  CHECK (consumed_at IS NULL OR revoked_at IS NULL),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (subject_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (consumed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_one_time_tokens_active_household_purpose
  ON one_time_tokens(household_id, purpose, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_one_time_tokens_active_subject
  ON one_time_tokens(subject_user_id, expires_at)
  WHERE subject_user_id IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL;

CREATE TRIGGER one_time_tokens_subject_insert
BEFORE INSERT ON one_time_tokens
FOR EACH ROW
WHEN NEW.subject_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.subject_user_id
    AND household_id = NEW.household_id
    AND revoked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'one-time token subject must be an active household user');
END;

CREATE TRIGGER one_time_tokens_creator_insert
BEFORE INSERT ON one_time_tokens
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.created_by_user_id AND household_id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'one-time token creator must belong to household');
END;

CREATE TRIGGER one_time_tokens_consumer_insert
BEFORE INSERT ON one_time_tokens
FOR EACH ROW
WHEN NEW.consumed_by_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.consumed_by_user_id AND household_id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'one-time token consumer must belong to household');
END;

CREATE TRIGGER one_time_tokens_subject_update
BEFORE UPDATE OF household_id, subject_user_id ON one_time_tokens
FOR EACH ROW
WHEN NEW.subject_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.subject_user_id
    AND household_id = NEW.household_id
    AND revoked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'one-time token subject must be an active household user');
END;

CREATE TRIGGER one_time_tokens_creator_update
BEFORE UPDATE OF household_id, created_by_user_id ON one_time_tokens
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.created_by_user_id AND household_id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'one-time token creator must belong to household');
END;

CREATE TRIGGER one_time_tokens_consumer_update
BEFORE UPDATE OF household_id, consumed_by_user_id ON one_time_tokens
FOR EACH ROW
WHEN NEW.consumed_by_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.consumed_by_user_id AND household_id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'one-time token consumer must belong to household');
END;

CREATE TABLE household_recovery (
  household_id TEXT PRIMARY KEY NOT NULL,
  recovery_hash TEXT NOT NULL UNIQUE CHECK (
    length(recovery_hash) = 64 AND recovery_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT
);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT
);

CREATE INDEX idx_calendar_events_household
  ON calendar_events(household_id, updated_at);

CREATE TABLE waste_config (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_waste_config_one_active
  ON waste_config(household_id)
  WHERE deleted_at IS NULL;

CREATE TABLE shared_places (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT
);

CREATE INDEX idx_shared_places_household
  ON shared_places(household_id, updated_at);

CREATE TABLE change_log (
  seq INTEGER PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
  changed_fields_json TEXT NOT NULL CHECK (json_valid(changed_fields_json)),
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_change_log_household_seq
  ON change_log(household_id, seq);

CREATE TRIGGER change_log_validate_insert
BEFORE INSERT ON change_log
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.changed_by AND household_id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'change-log actor must belong to household');
END;

CREATE TRIGGER change_log_validate_update
BEFORE UPDATE OF household_id, changed_by ON change_log
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.changed_by AND household_id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'change-log actor must belong to household');
END;

CREATE TABLE applied_mutations (
  mutation_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT
);

CREATE INDEX idx_applied_mutations_household
  ON applied_mutations(household_id, created_at);
