import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MatchResult, MatchSettings } from '@wildlings/shared';

export interface PlayerRow {
  id: string;
  name: string;
  species: string;
  wins: number;
  losses: number;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** SQLite persistence: guest identities, match history. Schema changes go in migrations/NNN_*.sql. */
export class Db {
  private db: DatabaseSync;

  constructor(path: string, migrationsDir: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate(migrationsDir);
  }

  /** Apply every migration file newer than the stored schema version, in order, each in a transaction. */
  private migrate(dir: string): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
    const current = row.v ?? 0;
    const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    for (const f of files) {
      const version = parseInt(f, 10);
      if (version <= current) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(readFileSync(join(dir, f), 'utf8'));
        this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
  }

  get schemaVersion(): number {
    return (this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }).v;
  }

  /** Resolve a token to a player, or create a new guest. Returns the (possibly new) token. */
  identify(token: string | undefined, name: string, species: string): { player: PlayerRow; token: string } {
    const now = Date.now();
    if (token && token.length >= 20 && token.length <= 128) {
      const p = this.db.prepare('SELECT id, name, species, wins, losses FROM players WHERE token_hash = ?').get(sha(token)) as PlayerRow | undefined;
      if (p) {
        this.db.prepare('UPDATE players SET name = ?, species = ?, last_seen = ? WHERE id = ?').run(name, species, now, p.id);
        return { player: { ...p, name, species }, token };
      }
    }
    const id = randomBytes(8).toString('hex');
    const fresh = randomBytes(24).toString('base64url');
    this.db.prepare('INSERT INTO players (id, token_hash, name, species, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(id, sha(fresh), name, species, now, now);
    return { player: { id, name, species, wins: 0, losses: 0 }, token: fresh };
  }

  playerByToken(token: string): PlayerRow | undefined {
    return this.db.prepare('SELECT id, name, species, wins, losses FROM players WHERE token_hash = ?').get(sha(token)) as PlayerRow | undefined;
  }

  updateProfile(id: string, name: string, species: string): void {
    this.db.prepare('UPDATE players SET name = ?, species = ? WHERE id = ?').run(name, species, id);
  }

  matchStarted(m: { id: string; code: string; quick: boolean; map: string; seed: number; settings: MatchSettings; players: { playerId: string; slot: number; team: number; client: string; name: string }[] }): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO matches (id, room_code, quick, map, seed, settings, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        m.id, m.code, m.quick ? 1 : 0, m.map, m.seed, JSON.stringify(m.settings), Date.now());
      const ins = this.db.prepare('INSERT INTO match_players (match_id, player_id, slot, team, client, name) VALUES (?, ?, ?, ?, ?, ?)');
      for (const p of m.players) ins.run(m.id, p.playerId, p.slot, p.team, p.client, p.name);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  matchEnded(id: string, result: MatchResult, reason: string, playerIds: Map<number, string>): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE matches SET ended_at = ?, turns = ?, winner_team = ?, reason = ? WHERE id = ?').run(Date.now(), result.turns, result.winnerTeam, reason, id);
      const up = this.db.prepare('UPDATE match_players SET won = ?, damage = ?, kills = ?, shots = ?, hits = ? WHERE match_id = ? AND slot = ?');
      for (const p of result.players) {
        const won = result.winners.includes(p.slot);
        up.run(won ? 1 : 0, p.stats.damageDealt, p.stats.kills, p.stats.shots, p.stats.hits, id, p.slot);
        const pid = playerIds.get(p.slot);
        if (pid && result.winnerTeam !== null) this.db.prepare(`UPDATE players SET ${won ? 'wins = wins + 1' : 'losses = losses + 1'} WHERE id = ?`).run(pid);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  history(playerId: string, limit = 10): { map: string; won: boolean; at: string; opponents: string }[] {
    const rows = this.db.prepare(`
      SELECT m.id, m.map, m.ended_at, mp.won,
        (SELECT group_concat(o.name, ', ') FROM match_players o WHERE o.match_id = m.id AND o.player_id != mp.player_id) AS opponents
      FROM match_players mp JOIN matches m ON m.id = mp.match_id
      WHERE mp.player_id = ? AND m.ended_at IS NOT NULL
      ORDER BY m.ended_at DESC LIMIT ?`).all(playerId, limit) as { map: string; ended_at: number; won: number; opponents: string }[];
    return rows.map((r) => ({ map: r.map, won: !!r.won, at: new Date(r.ended_at).toISOString(), opponents: r.opponents ?? '?' }));
  }

  close(): void {
    this.db.close();
  }
}
