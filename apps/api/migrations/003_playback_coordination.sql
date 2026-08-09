ALTER TABLE playback_states
  ADD COLUMN provider_command_id text,
  ADD COLUMN last_transition jsonb;

ALTER TABLE playback_states
  ADD CONSTRAINT playback_states_last_transition_shape CHECK (
    last_transition IS NULL
    OR (
      jsonb_typeof(last_transition) = 'object'
      AND last_transition ?& ARRAY['at', 'outcome', 'title']
      AND last_transition->>'outcome' IN ('ended', 'failed', 'skipped')
    )
  );
