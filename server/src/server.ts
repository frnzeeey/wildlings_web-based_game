import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { RULES, SPEC_VERSION } from '@wildlings/shared';
import { Lobby, Conn } from './lobby.ts';
import { Db } from './db.ts';
import { log } from './log.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  dbPath: string;
  migrationsDir: string;
  staticDir?: string;
  corsOrigin?: string;
  reconnectGraceMs?: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/** HTTP (static web build, health, history API) + WebSocket game server + the fixed-rate sim loop. */
export function startServer(opts: ServerOptions): Promise<{ server: Server; lobby: Lobby; close: () => Promise<void> }> {
  const db = new Db(opts.dbPath, opts.migrationsDir);
  const lobby = new Lobby(db);
  if (opts.reconnectGraceMs !== undefined) lobby.graceMs = opts.reconnectGraceMs;
  const staticRoot = opts.staticDir && existsSync(opts.staticDir) ? resolve(opts.staticDir) : null;

  const http = createServer((req, res) => handleHttp(req, res));
  function cors(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', opts.corsOrigin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  }

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/health') {
      cors(res);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, spec: SPEC_VERSION, protocol: RULES.protocolVersion, schema: db.schemaVersion, ...lobby.stats }));
      return;
    }
    if (url.pathname === '/api/history') {
      cors(res);
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const p = token ? db.playerByToken(token) : undefined;
      if (!p) {
        res.writeHead(401, { 'content-type': 'application/json' }).end('[]');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(db.history(p.id)));
      return;
    }
    if (staticRoot) {
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      let file = join(staticRoot, rel);
      if (!file.startsWith(staticRoot)) {
        res.writeHead(403).end();
        return;
      }
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticRoot, 'index.html');
      if (existsSync(file)) {
        const ext = extname(file);
        res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });
  wss.on('connection', (ws) => {
    const conn = new Conn(ws);
    ws.on('message', (data) => {
      try {
        lobby.handle(conn, data.toString());
      } catch (e) {
        log.error('message handler failed', e);
      }
    });
    ws.on('close', () => lobby.closed(conn));
    ws.on('error', (e) => log.warn('socket error', e.message));
  });

  // Fixed-rate simulation loop with catch-up (capped so a stall can't spiral).
  const stepMs = 1000 / RULES.world.tickRate;
  let next = performance.now();
  let stopped = false;
  const loop = () => {
    if (stopped) return;
    const now = performance.now();
    let n = 0;
    while (now >= next && n < 8) {
      try {
        lobby.tick(Date.now());
      } catch (e) {
        log.error('tick failed', e);
      }
      next += stepMs;
      n++;
    }
    if (n >= 8) next = now + stepMs;
    setTimeout(loop, Math.max(0, next - performance.now()));
  };
  loop();

  return new Promise((ok) => {
    http.listen(opts.port, opts.host ?? '0.0.0.0', () => {
      log.info(`wildlings server on :${(http.address() as { port: number }).port} (spec ${SPEC_VERSION}, db ${opts.dbPath}${staticRoot ? `, serving ${staticRoot}` : ''})`);
      ok({
        server: http,
        lobby,
        close: () =>
          new Promise((done) => {
            stopped = true;
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => {
              db.close();
              done();
            });
          }),
      });
    });
  });
}
