ALTER TABLE lobbies ADD COLUMN last_activity_at timestamptz;

UPDATE lobbies SET last_activity_at = created_at WHERE last_activity_at IS NULL;

ALTER TABLE lobbies ALTER COLUMN last_activity_at SET DEFAULT now();
ALTER TABLE lobbies ALTER COLUMN last_activity_at SET NOT NULL;

CREATE INDEX lobbies_activity_idx ON lobbies (last_activity_at);
