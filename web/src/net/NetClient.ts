import { PROTOCOL_VERSION, SPEC_VERSION, type ClientMsg, type ServerMsg } from '@wildlings/shared';
import { load, save } from '../settings.ts';

type Listener = (msg: ServerMsg) => void;
export type NetState = 'offline' | 'connecting' | 'online' | 'reconnecting';

export function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/**
 * One WebSocket connection to the game server. Reconnects automatically with backoff and
 * re-identifies with the stored token, so a dropped connection resumes the same player.
 */
export class NetClient {
  state: NetState = 'offline';
  playerId = '';
  name = '';
  lastError = '';
  rtt = 0;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: NetState) => void>();
  private wanted = false;
  private retry = 0;
  private retryTimer = 0;
  private pingTimer = 0;
  private pingId = 0;
  private pingSent = new Map<number, number>();
  private profile: { name: string; species: string };

  constructor(profile: { name: string; species: string }) {
    this.profile = profile;
  }

  get token(): string {
    return load('identity', { token: '' }).token;
  }

  setProfile(name: string, species: string): void {
    this.profile = { name, species };
    if (this.state === 'online') this.send({ t: 'profile', name, species });
  }

  connect(): void {
    this.wanted = true;
    if (this.ws) return;
    this.setState(this.retry ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(serverUrl());
    } catch (e) {
      this.lastError = String(e);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, spec: SPEC_VERSION, client: 'web', name: this.profile.name, species: this.profile.species, token: this.token || undefined });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.playerId = msg.playerId;
        this.name = msg.name;
        save('identity', { token: msg.token });
        this.retry = 0;
        this.setState('online');
        this.startPing();
      } else if (msg.t === 'pong') {
        const sent = this.pingSent.get(msg.id);
        if (sent) this.rtt = performance.now() - sent;
        this.pingSent.delete(msg.id);
      } else if (msg.t === 'error' && (msg.code === 'version' || msg.code === 'spec')) {
        this.lastError = msg.msg;
        this.wanted = false;
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      clearInterval(this.pingTimer);
      if (this.wanted) this.scheduleRetry();
      else this.setState('offline');
    };
    ws.onerror = () => {
      this.lastError = 'Could not reach the game server';
    };
  }

  disconnect(): void {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.setState('offline');
  }

  /** Test hook: drop the socket as if the network failed (it reconnects by itself). */
  simulateDrop(): void {
    this.ws?.close();
  }

  send(msg: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onState(l: (s: NetState) => void): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }

  private setState(s: NetState): void {
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }

  private scheduleRetry(): void {
    this.setState('reconnecting');
    const delay = Math.min(8000, 500 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private startPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      const id = ++this.pingId;
      this.pingSent.set(id, performance.now());
      this.send({ t: 'ping', id });
    }, 3000);
  }
}
