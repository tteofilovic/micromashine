// Round / scoring rules, driven directly against Room (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { TRACKS } from '../shared/track.js';

const DT = 1 / 60;

function setup(n, options = {}) {
  const room = new Room({ countdownSec: 0.05, roundOverSec: 0.1, gameOverSec: 0.1, ...options });
  const msgs = [];
  const ids = [];
  for (let i = 0; i < n; i++) {
    const p = room.addPlayer({ name: `P${i + 1}`, send: (s) => msgs.push(JSON.parse(s)) });
    ids.push(p.id);
  }
  return { room, ids, msgs };
}

function tickUntil(room, pred, maxTicks = 600) {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return;
    room.tick(DT);
  }
  assert.fail(`condition not reached; phase=${room.phase}`);
}

/** Start and run until the race is on, with player 1 clearly in the lead. */
function startRace(room, ids) {
  room.start(ids[0]);
  tickUntil(room, () => room.phase === 'racing');
  ids.forEach((id, i) => (room.cars.get(id).prog = 1000 - i * 10)); // ids[0] leads
}

/** Throw a car far outside the camera without disturbing its race progress. */
function throwOut(room, id) {
  const car = room.cars.get(id);
  car.x += 3000;
  car.s = room.track.nearest(car.x, car.y).s; // so the teleport doesn't count as progress
}

test('4 players score 0, 1, 2, 4 in elimination order (last survivor gets +1 bonus)', () => {
  const { room, ids } = setup(4);
  startRace(room, ids);
  const [p1, p2, p3, p4] = ids;

  throwOut(room, p4);
  room.tick(DT);
  assert.equal(room.cars.size, 3);
  assert.equal(room.phase, 'racing', 'race continues while 3 are left');

  throwOut(room, p3);
  room.tick(DT);
  assert.equal(room.cars.size, 2);
  assert.equal(room.phase, 'racing', 'race continues while 2 are left');

  throwOut(room, p2);
  room.tick(DT);
  assert.equal(room.phase, 'roundover');

  const score = (id) => room.players.get(id).score;
  assert.deepEqual([score(p4), score(p3), score(p2), score(p1)], [0, 1, 2, 4]);
  assert.deepEqual(
    room.roundResult.map((r) => r.id),
    [p1, p2, p3, p4],
  );
});

test('next round respawns everyone, including eliminated players', () => {
  const { room, ids } = setup(4);
  startRace(room, ids);
  for (const id of ids.slice(1).reverse()) {
    throwOut(room, id);
    room.tick(DT);
  }
  assert.equal(room.phase, 'roundover');
  tickUntil(room, () => room.phase === 'countdown');
  assert.equal(room.cars.size, 4);
  assert.deepEqual(room.eliminated, []);
  tickUntil(room, () => room.phase === 'racing');
  assert.equal(room.cars.size, 4);
});

test('simultaneous elimination: the car furthest behind scores less', () => {
  const { room, ids } = setup(3);
  startRace(room, ids); // prog: ids[0]=1000, ids[1]=990, ids[2]=980
  throwOut(room, ids[1]);
  throwOut(room, ids[2]);
  room.tick(DT);
  assert.equal(room.phase, 'roundover');
  const score = (id) => room.players.get(id).score;
  assert.deepEqual([score(ids[2]), score(ids[1]), score(ids[0])], [0, 1, 3]);
});

test('game ends when a player reaches the target; start page keeps the standings', () => {
  const { room, ids, msgs } = setup(2, { target: 4 });
  startRace(room, ids);
  throwOut(room, ids[1]);
  room.tick(DT);
  // 2 players: loser 0, winner 2 -> nobody at 4 yet.
  assert.equal(room.phase, 'roundover');
  assert.equal(room.winnerId, null);

  tickUntil(room, () => room.phase === 'racing');
  ids.forEach((id, i) => (room.cars.get(id).prog = 1000 - i * 10));
  throwOut(room, ids[1]);
  room.tick(DT);
  assert.equal(room.phase, 'gameover');
  assert.equal(room.winnerId, ids[0]);
  assert.equal(room.players.get(ids[0]).score, 4);

  tickUntil(room, () => room.phase === 'lobby');
  const lobby = msgs.filter((m) => m.type === 'lobby').at(-1);
  assert.equal(lobby.phase, 'lobby');
  assert.equal(lobby.winner, ids[0]);
  assert.deepEqual(
    lobby.players.map((p) => p.score),
    [4, 0],
  );

  // Only the host can start a new game, which resets the scores.
  room.start(ids[1]);
  assert.equal(room.phase, 'lobby');
  room.start(ids[0]);
  assert.equal(room.phase, 'countdown');
  assert.deepEqual([...room.players.values()].map((p) => p.score), [0, 0]);
  assert.equal(room.winnerId, null);
});

test('tie on total points goes to whoever did better in the deciding round', () => {
  const { room, ids } = setup(3, { target: 4 });
  startRace(room, ids);
  // This round: ids[2] out first (+0), ids[1] second (+1), ids[0] survives (+3).
  room.players.get(ids[0]).score = 1; // 1 + 3 = 4
  room.players.get(ids[1]).score = 3; // 3 + 1 = 4, tied with ids[0]
  throwOut(room, ids[2]);
  room.tick(DT);
  throwOut(room, ids[1]);
  room.tick(DT);
  assert.equal(room.phase, 'gameover');
  assert.equal(room.players.get(ids[0]).score, 4);
  assert.equal(room.players.get(ids[1]).score, 4);
  assert.equal(room.winnerId, ids[0], 'survivor (+3 this round) beats the player with +1');
});

test('disconnecting mid-race counts as elimination; survivor still scores', () => {
  const { room, ids } = setup(2);
  startRace(room, ids);
  room.removePlayer(ids[1]);
  room.tick(DT);
  assert.equal(room.phase, 'roundover');
  assert.equal(room.players.get(ids[0]).score, 2);
});

test('a single player is in practice mode: the round never ends', () => {
  const { room, ids } = setup(1);
  startRace(room, ids);
  throwOut(room, ids[0]);
  for (let i = 0; i < 120; i++) room.tick(DT);
  assert.equal(room.phase, 'racing');
  assert.equal(room.players.get(ids[0]).score, 0);
});

test('eliminated players keep receiving snapshots and are listed as dead', () => {
  const { room, ids, msgs } = setup(3);
  startRace(room, ids);
  throwOut(room, ids[2]);
  room.tick(DT);
  room.tick(DT); // snapshots go out every 2nd tick
  const snap = msgs.filter((m) => m.type === 'snap').at(-1);
  assert.deepEqual(snap.dead, [ids[2]]);
  assert.ok(!snap.cars.some((c) => c.id === ids[2]), 'dead player has no car');
  assert.equal(snap.cars.length, 2);
});

test('a track is picked when the game starts and kept for every round until the game is decided', () => {
  const { room, ids } = setup(2, { target: 4 });
  assert.equal(room.track, null, 'no track before the first game');
  startRace(room, ids);
  const chosen = room.track;
  assert.ok(TRACKS.includes(chosen));

  throwOut(room, ids[1]);
  room.tick(DT);
  assert.equal(room.phase, 'roundover');
  tickUntil(room, () => room.phase === 'racing');
  assert.equal(room.track, chosen, 'same track in the next round');
  for (const car of room.cars.values()) assert.ok(room.track.nearest(car.x, car.y).dist < 100, 'cars spawn on that track');
});

test('every game gets a track, and never the same one twice in a row', () => {
  const { room, ids } = setup(2, { target: 1 });
  let prev = null;
  const seen = new Set();
  for (let game = 0; game < 30; game++) {
    room.start(ids[0]);
    assert.ok(room.track, 'track chosen');
    if (prev) assert.notEqual(room.track, prev, 'repeated track');
    seen.add(room.track.id);
    prev = room.track;
    tickUntil(room, () => room.phase === 'racing');
    ids.forEach((id, i) => (room.cars.get(id).prog = 1000 - i * 10));
    throwOut(room, ids[1]);
    room.tick(DT);
    assert.equal(room.phase, 'gameover');
    tickUntil(room, () => room.phase === 'lobby');
  }
  assert.equal(seen.size, TRACKS.length, 'all tracks come up');
});

test('lobby message tells clients which track is in use', () => {
  const { room, ids, msgs } = setup(2, { trackId: 'sikana' });
  room.broadcastLobby(); // the server does this after each join
  assert.equal(msgs.filter((m) => m.type === 'lobby').at(-1).track, null);
  room.start(ids[0]);
  const lobby = msgs.filter((m) => m.type === 'lobby').at(-1);
  assert.deepEqual(lobby.track, { id: 'sikana', name: 'Šikana' });
});
