// End-to-end: real server, real WebSocket clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../server/index.js';

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const msgs = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m));
  });
  const opened = new Promise((r) => ws.on('open', r));
  return {
    ws,
    msgs,
    opened,
    send: (o) => ws.send(JSON.stringify(o)),
    waitFor: (pred, ms = 15000) => {
      const hit = msgs.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
        waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
      });
    },
  };
}

test('lobby -> race -> elimination -> point', async (t) => {
  const srv = await startServer({
    port: 0,
    host: '127.0.0.1',
    roomOptions: { countdownSec: 0.2, roundOverSec: 0.3, gameOverSec: 0.5, target: 1 },
  });
  t.after(() => srv.close());

  const a = client(srv.port);
  const b = client(srv.port);
  await Promise.all([a.opened, b.opened]);

  a.send({ type: 'join', name: 'Ana' });
  const wa = await a.waitFor((m) => m.type === 'welcome');
  b.send({ type: 'join', name: 'Boki' });
  const wb = await b.waitFor((m) => m.type === 'welcome');
  assert.notEqual(wa.id, wb.id);

  const lobby = await a.waitFor((m) => m.type === 'lobby' && m.players.length === 2);
  assert.equal(lobby.owner, wa.id);

  // A non-owner cannot start the race.
  b.send({ type: 'start' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(srv.room.phase, 'lobby');

  // A late joiner is rejected once the race is running.
  a.send({ type: 'start' });
  await a.waitFor((m) => m.type === 'snap' && m.phase === 'racing');
  const late = client(srv.port);
  await late.opened;
  late.send({ type: 'join', name: 'Kasni' });
  const err = await late.waitFor((m) => m.type === 'error');
  assert.match(err.message, /Trka je u toku/);

  // A drives away (straight, off the road), B stays put: someone gets eliminated and scores.
  a.send({ type: 'input', up: true });
  const over = await a.waitFor((m) => m.type === 'snap' && m.phase === 'gameover');
  assert.equal(over.dead.length, 1);
  assert.ok(over.winner === wa.id || over.winner === wb.id);
  assert.equal(over.cars.length, 1, 'only the survivor still has a car');
  assert.ok(Number.isFinite(over.cars[0].x) && Number.isFinite(over.cars[0].y));
  assert.equal(over.cars[0].id, over.winner);
  assert.deepEqual(
    over.result.map((r) => r.pts),
    [2, 0],
    '2 players: survivor 2 points, eliminated 0',
  );

  // After the game, everyone is back on the start page with the final standings.
  const finalLobby = await a.waitFor((m) => m.type === 'lobby' && m.phase === 'lobby' && m.winner !== null);
  assert.equal(finalLobby.players.find((p) => p.id === over.winner).score, 2);

  a.ws.close();
  b.ws.close();
  late.ws.close();
});

test('static files are served and path traversal is blocked', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Micromašine/);

  const shared = await fetch(`${base}/shared/track.js`);
  assert.equal(shared.status, 200);

  for (const p of ['/..%2fpackage.json', '/shared/..%2fpackage.json', '/%2e%2e/server/index.js']) {
    const r = await fetch(`${base}${p}`);
    assert.ok(r.status === 403 || r.status === 404, `${p} -> ${r.status}`);
  }
});
