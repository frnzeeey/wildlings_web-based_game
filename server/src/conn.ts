import type { WebSocket } from 'ws';
import { RULES, type ClientKind, type ServerMsg } from '@wildlings/shared';

/** One client socket: identity, rate limiting and JSON sending. */
export class Conn {
  readonly ws: WebSocket;
  playerId = '';
  name = 'Critter';
  species = 'fox';
  client: ClientKind = 'web';
  roomCode: string | null = null;
  alive = true;
  private tokens: number = RULES.net.maxMessagesPerSecond * 2;
  private lastRefill = Date.now();
  private strikes = 0;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  get identified(): boolean {
    return this.playerId !== '';
  }

  /** Token bucket. Returns false if the message must be dropped; closes persistent floods. */
  allow(): boolean {
    const now = Date.now();
    const rate = RULES.net.maxMessagesPerSecond;
    this.tokens = Math.min(rate * 2, this.tokens + ((now - this.lastRefill) / 1000) * rate);
    this.lastRefill = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    if (++this.strikes > rate * 3) this.ws.close(1008, 'rate limit');
    return false;
  }

  send(msg: ServerMsg): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendRaw(json: string): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(json);
  }
}
