// Test-process preload inherited by the real adaptive Worker thread.
// Persistence goes to local PostgREST fixtures; no live upstreams are contacted.
import { Server } from 'node:http';

const nativeListen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => console.log(`ADAPTIVE_FIXTURE_PORT=${this.address().port}`));
  return nativeListen.apply(this, args);
};

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === '127.0.0.1') return nativeFetch(input, options);
  if (url.hostname === 'draw.ar-lottery01.com' && url.pathname.endsWith('/WinGo_30S.json')) {
    return Promise.resolve(Response.json({ current: { issueNumber: process.env.ADAPTIVE_FIXTURE_ACTIVE_PERIOD } }));
  }
  return Promise.resolve(new Response('Upstream disabled in restart fixture', { status: 503 }));
};
