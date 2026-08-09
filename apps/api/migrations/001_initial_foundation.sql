CREATE TABLE lobbies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  code varchar(8) NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-9]{6,8}$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  closed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (closed_at IS NULL OR closed_at >= created_at)
);

CREATE TABLE participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  lobby_id uuid NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 40),
  is_creator boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY (lobby_id, participant_id),
  CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE UNIQUE INDEX memberships_one_creator_per_lobby
  ON memberships (lobby_id)
  WHERE is_creator;

CREATE TABLE provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id uuid NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  owner_participant_id uuid NOT NULL,
  provider text NOT NULL CHECK (char_length(btrim(provider)) BETWEEN 1 AND 40),
  consented_for_lobby boolean NOT NULL DEFAULT false,
  scopes text[] NOT NULL DEFAULT '{}',
  capabilities text[] NOT NULL DEFAULT '{}',
  encrypted_credentials jsonb NOT NULL,
  credentials_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lobby_id, id),
  FOREIGN KEY (lobby_id, owner_participant_id)
    REFERENCES memberships(lobby_id, participant_id) ON DELETE CASCADE,
  CHECK (
    jsonb_typeof(encrypted_credentials) = 'object'
    AND encrypted_credentials ?& ARRAY['keyVersion', 'iv', 'ciphertext', 'authTag']
  ),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id uuid NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  provider_connection_id uuid,
  added_by_participant_id uuid NOT NULL,
  position numeric(30, 12) NOT NULL,
  normalized_track jsonb NOT NULL CHECK (jsonb_typeof(normalized_track) = 'object'),
  provider_variants jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(provider_variants) = 'array'),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'playing', 'played', 'failed', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lobby_id, id),
  UNIQUE (lobby_id, position),
  FOREIGN KEY (lobby_id, added_by_participant_id)
    REFERENCES memberships(lobby_id, participant_id) ON DELETE CASCADE,
  FOREIGN KEY (lobby_id, provider_connection_id)
    REFERENCES provider_connections(lobby_id, id) ON DELETE SET NULL (provider_connection_id)
);

CREATE TABLE playback_leases (
  lobby_id uuid PRIMARY KEY REFERENCES lobbies(id) ON DELETE CASCADE,
  holder_participant_id uuid NOT NULL,
  provider_connection_id uuid,
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 16 AND 200),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (lobby_id, holder_participant_id)
    REFERENCES memberships(lobby_id, participant_id) ON DELETE CASCADE,
  FOREIGN KEY (lobby_id, provider_connection_id)
    REFERENCES provider_connections(lobby_id, id) ON DELETE SET NULL (provider_connection_id),
  CHECK (expires_at > heartbeat_at)
);

CREATE TABLE playback_states (
  lobby_id uuid PRIMARY KEY REFERENCES lobbies(id) ON DELETE CASCADE,
  current_item_id uuid,
  state text NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'loading', 'playing', 'paused', 'failed')),
  position_ms integer NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (lobby_id, current_item_id)
    REFERENCES queue_items(lobby_id, id) ON DELETE SET NULL (current_item_id)
);

CREATE TABLE command_receipts (
  lobby_id uuid NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  actor_participant_id uuid NOT NULL,
  command_type text NOT NULL CHECK (char_length(btrim(command_type)) BETWEEN 1 AND 80),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (lobby_id, command_id),
  FOREIGN KEY (lobby_id, actor_participant_id)
    REFERENCES memberships(lobby_id, participant_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX lobbies_expiration_idx ON lobbies (expires_at) WHERE status = 'open';
CREATE INDEX command_receipts_expiration_idx ON command_receipts (expires_at);
