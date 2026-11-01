import { Bot, DT, Match, type Command, type MatchPlayerConfig, type MatchResult, type MatchSettings, type SimEvent } from '@wildlings/shared';
import type { Session, SlotInfo, WorldView } from './view.ts';

export interface LocalMatchConfig {
  mapId: string;
  seed: number;
  players: MatchPlayerConfig[];
  settings: Partial<MatchSettings>;
}

/** Offline match: the shared simulation runs in the browser, with bots for AI slots. */
export class LocalSession implements Session {
  readonly online = false;
  readonly match: Match;
  readonly slots: SlotInfo[];
  private bots = new Map<number, Bot>();
  private acc = 0;

  constructor(cfg: LocalMatchConfig) {
    this.match = new Match(cfg);
    this.slots = cfg.players.map((p, i) => ({
      slot: i,
      name: p.name,
      team: p.team,
      kind: p.bot ? 'bot' : 'human',
      detail: p.bot ?? undefined,
      connected: true,
    }));
    cfg.players.forEach((p, i) => {
      if (p.bot) this.bots.set(i, new Bot(p.bot, cfg.seed + i * 7919));
    });
    this.match.start();
  }

  get world(): WorldView {
    return this.match;
  }

  controlledSlot(): number {
    const s = this.match.activeSlot;
    return this.slots[s]?.kind === 'human' ? s : -1;
  }

  update(dtMs: number): SimEvent[] {
    this.acc += Math.min(dtMs, 100) / 1000;
    let n = 0;
    while (this.acc >= DT && n < 6) {
      const s = this.match.activeSlot;
      const bot = this.bots.get(s);
      if (bot) for (const c of bot.update(DT, this.match, s)) this.match.command(s, c);
      this.match.step();
      this.acc -= DT;
      n++;
    }
    if (n >= 6) this.acc = 0;
    return this.match.takeEvents();
  }

  send(cmd: Command): string | null {
    const s = this.controlledSlot();
    if (s < 0) return 'not-your-turn';
    const r = this.match.command(s, cmd);
    return r.ok ? null : r.error;
  }

  result(): MatchResult | null {
    return this.match.result;
  }

  status(): string | null {
    return null;
  }

  dispose(): void {}
}
