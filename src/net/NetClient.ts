import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'error';

/** Thin typed WebSocket wrapper. */
export class NetClient {
  private ws: WebSocket | null = null;
  status: NetStatus = 'offline';
  ping = 0;
  private handlers: Array<(m: ServerMsg) => void> = [];
  private statusHandlers: Array<(s: NetStatus, info?: string) => void> = [];
  private pingTimer: number | null = null;

  onMessage(fn: (m: ServerMsg) => void) {
    this.handlers.push(fn);
  }

  onStatus(fn: (s: NetStatus, info?: string) => void) {
    this.statusHandlers.push(fn);
  }

  private setStatus(s: NetStatus, info?: string) {
    this.status = s;
    for (const h of this.statusHandlers) h(s, info);
  }

  connect(url: string, hello: Extract<ClientMsg, { t: 'hello' }>) {
    this.disconnect();
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.setStatus('error', String(e));
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send(hello);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'welcome') this.setStatus('online');
      if (msg.t === 'pong') this.ping = performance.now() - msg.ts;
      if (msg.t === 'error') this.setStatus('error', msg.message);
      for (const h of this.handlers) h(msg);
    };
    ws.onerror = () => this.setStatus('error', 'Could not reach the server. Is it running? (npm run server)');
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.ws === ws) {
        this.ws = null;
        if (this.status !== 'error') this.setStatus('offline');
      }
    };
  }

  send(m: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  disconnect() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.status !== 'offline') this.setStatus('offline');
  }
}
