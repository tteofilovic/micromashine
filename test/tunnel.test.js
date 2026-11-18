import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTunnelUrl, startTunnel } from '../server/tunnel.js';

test('parseTunnelUrl finds the quick-tunnel URL in cloudflared output', () => {
  const line = '2026-11-18T12:00:00Z INF |  https://random-words-here.trycloudflare.com                               |';
  assert.equal(parseTunnelUrl(line), 'https://random-words-here.trycloudflare.com');
  assert.equal(parseTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...'), null);
  assert.equal(parseTunnelUrl('https://api.trycloudflare.com/tunnel'), 'https://api.trycloudflare.com');
  assert.equal(parseTunnelUrl('https://example.com'), null);
  assert.equal(parseTunnelUrl(''), null);
});

const fake = (script) => ({ command: process.execPath, args: ['-e', script] });

test('startTunnel reports the URL printed by the (fake) tunnel process, then stops it', async () => {
  const url = await new Promise((resolve, reject) => {
    const t = startTunnel(3000, {
      ...fake("console.error('INF |  https://fake-name-1.trycloudflare.com  |'); setInterval(() => {}, 1000)"),
      onUrl: (u) => resolve({ u, t }),
      onError: reject,
    });
  });
  assert.equal(url.u, 'https://fake-name-1.trycloudflare.com');
  url.t.stop(); // must not report an error afterwards
  await new Promise((r) => setTimeout(r, 150));
});

test('startTunnel reports a missing cloudflared as "nije instaliran"', async () => {
  const msg = await new Promise((resolve) => {
    startTunnel(3000, { command: 'definitely-not-an-installed-binary-xyz', onError: resolve });
  });
  assert.match(msg, /nije instaliran/);
});

test('startTunnel reports an early exit', async () => {
  const msg = await new Promise((resolve) => {
    startTunnel(3000, { ...fake('process.exit(3)'), onError: resolve, onUrl: () => resolve('unexpected url') });
  });
  assert.match(msg, /zatvorio/);
});

test('startTunnel reports a tunnel that never gets a URL', async () => {
  let t;
  const msg = await new Promise((resolve) => {
    t = startTunnel(3000, { ...fake('setInterval(() => {}, 1000)'), timeoutMs: 200, onError: resolve });
  });
  t.stop();
  assert.match(msg, /javnu adresu/);
});

test('startTunnel tells when the tunnel dies after it was up', async () => {
  const msg = await new Promise((resolve) => {
    startTunnel(3000, {
      ...fake("console.error('https://up-then-down.trycloudflare.com'); setTimeout(() => process.exit(1), 100)"),
      onError: resolve,
    });
  });
  assert.match(msg, /prekinut/);
});
