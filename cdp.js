const WebSocket = require('ws');
const http = require('http');

const get = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); })
    .on('error', rej);
});

class Cdp {
  constructor(port = 9222) { this.port = port; this.ws = null; this.id = 0; this.pending = new Map(); }

  async connect() {
    const tabs = await get(`http://127.0.0.1:${this.port}/json/list`);
    const tab = tabs.find(t => t.type === 'page' && /chess\.com/.test(t.url));
    if (!tab) throw new Error('no chess.com tab');
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = new WebSocket(tab.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
    this.ws.on('close', () => this.pending.clear());
  }

  call(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const r = await this.call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

module.exports = { Cdp };