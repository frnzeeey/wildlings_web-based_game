-- Players are guest identities: a random id plus a secret token (only its SHA-256 is stored).
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  species TEXT NOT NULL DEFAULT 'fox',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  quick INTEGER NOT NULL,
  map TEXT NOT NULL,
  seed INTEGER NOT NULL,
  settings TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  turns INTEGER,
  winner_team INTEGER,
  reason TEXT
);

CREATE TABLE match_players (
  match_id TEXT NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  slot INTEGER NOT NULL,
  team INTEGER NOT NULL,
  client TEXT NOT NULL,
  name TEXT NOT NULL,
  won INTEGER,
  damage INTEGER,
  kills INTEGER,
  shots INTEGER,
  hits INTEGER,
  PRIMARY KEY (match_id, slot)
);

CREATE INDEX idx_match_players_player ON match_players(player_id);
