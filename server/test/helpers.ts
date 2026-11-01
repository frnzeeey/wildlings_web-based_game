import { WebSocket } from 'ws';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, SPEC_VERSION, type ClientMsg, type ServerMsg } from '@wildlings/shared';
import { startServer } from '../src/server.ts';

const here = dirname(fileURLToPath(import.meta.url));

export async function testServer(graceMs = 60000) {
  process.env.LOG_LEVEL = 'silent';
  const s = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', migrationsDir: join(here, '../migrations'), reconnectGraceMs: graceMs });
  const port = (s.server.address() as { port: number }).port;
  return { ...s, url: `ws://127.0.0.1:${port}/ws`, http: `http://127.0.0.1:${port}` };
}

/** A scripted protocol client that records every message. */
export class TestClient {
  ws!: WebSocket;
  msgs: ServerMsg[] = [];
  playerId = '';
  token = '';
  you = -1;
  private seq = 0;

  static async connect(url: string, name: string, opts: { token?: string; client?: 'test' | 'godot' | 'web'; spec?: string } = {}): Promise<TestClient> {
    const c = new TestClient();
    await c.open(url, name, opts);
    return c;
  }

  async open(url: string, name: string, opts: { token?: string; client?: 'test' | 'godot' | 'web'; spec?: string } = {}): Promise<void> {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      this.msgs.push(m);
      if (m.t === 'welcome') {
        this.playerId = m.playerId;
        this.token = m.token;
      }
      if (m.t === 'matchStart') this.you = m.you;
    });
    await new Promise((ok, fail) => {
      this.ws.once('open', ok);
      this.ws.once('error', fail);
    });
    this.send({ t: 'hello', v: PROTOCOL_VERSION, spec: opts.spec ?? SPEC_VERSION, client: opts.client ?? 'test', name, species: 'fox', token: opts.token });
    if (opts.spec && opts.spec !== SPEC_VERSION) return;
    await this.waitFor((m) => m.t === 'welcome');
  }

  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }

  cmd(c: Extract<ClientMsg, { t: 'cmd' }>['c']): number {
    const seq = ++this.seq;
    this.send({ t: 'cmd', seq, c });
    return seq;
  }

  /** Resolve with the first message (new or already received after `from`) matching pred. */
  async waitFor<T extends ServerMsg>(pred: (m: ServerMsg) => boolean, timeout = 10000, from = 0): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const hit = this.msgs.slice(from).find(pred);
      if (hit) return hit as T;
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for message (have: ${this.msgs.slice(-5).map((m) => m.t).join(',')})`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }

  close(): Promise<void> {
    return new Promise((ok) => {
      if (this.ws.readyState === WebSocket.CLOSED) return ok();
      this.ws.once('close', () => ok());
      this.ws.close();
    });
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
