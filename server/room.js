// Authoritative game room: lobby, rounds, shared camera, elimination and scoring.
// Transport-agnostic: players are { send(string) } objects, so tests can drive it directly.
//
// Round rules: the race goes on until one car is left. Cars that fall out of the shared
// camera view are eliminated (they spectate). The k-th eliminated player (0-based) scores k
// points; the last survivor scores N (= number of players in the round, i.e. N-1 plus a +1
// bonus). 4 players -> 0, 1, 2, 4. The game ends once someone reaches `target` points.
// One track is picked at random when a game starts and is used until the game is decided.
import { createCar, placeCar, stepWorld, NO_INPUT, VIEW_W, VIEW_H, CAR_RADIUS } from '../shared/sim.js';
import { TRACKS, getTrack } from '../shared/track.js';

export const MAX_PLAYERS = 4;
const COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];
const GRID_ROW_GAP = 45;
const GRID_LATERAL = 40;
const CAMERA_SMOOTHING = 5; // 1/s

function cleanName(name, id) {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '';
  return s || `Igrač ${id}`;
}

const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;

export class Room {
  constructor(options = {}) {
    // options.trackId forces a track; options.rng replaces Math.random (both mostly for tests).
    this.opts = { target: 10, countdownSec: 3, roundOverSec: 4, gameOverSec: 8, ...options };
    this.track = null; // chosen when a game starts; stays set afterwards so the start page can show it
    this.players = new Map(); // id -> { id, name, color, send, input, score }
    this.cars = new Map(); // id -> car (alive cars only; eliminated players have none)
    this.nextId = 1;
    this.phase = 'lobby'; // lobby | countdown | racing | roundover | gameover
    this.timer = 0;
    this.cam = { x: 0, y: 0 };
    this.leaderId = null;
    this.winnerId = null; // game winner, kept until the next game starts
    this.respawn = { s: 0, prog: 0 };
    this.roundSize = 0; // players that started the current round
    this.eliminated = []; // this round, in order of elimination; null = player who disconnected
    this.roundResult = []; // [{ id, pts }] best first, set when a round ends
    this.tickCount = 0;
  }

  get ownerId() {
    return this.players.keys().next().value ?? null;
  }

  /** A single player can drive around without the round ever ending. */
  get practice() {
    return this.roundSize < 2;
  }

  addPlayer({ name, send }) {
    if (this.players.size >= MAX_PLAYERS) return { error: `Soba je puna (najviše ${MAX_PLAYERS} igrača).` };
    if (this.phase !== 'lobby') return { error: 'Trka je u toku, probaj kad se završi.' };
    const id = this.nextId++;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const player = {
      id,
      name: cleanName(name, id),
      color: COLORS.find((c) => !used.has(c)),
      send,
      input: { ...NO_INPUT },
      score: 0,
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    const wasAlive = this.cars.delete(id);
    if (wasAlive && (this.phase === 'countdown' || this.phase === 'racing')) this.eliminated.push(null);
    if (this.players.size === 0) {
      this.winnerId = null;
      this.resetToLobby();
    }
    this.broadcastLobby();
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p || !input) return;
    p.input = { up: !!input.up, down: !!input.down, left: !!input.left, right: !!input.right };
  }

  start(id) {
    if (id !== this.ownerId) return;
    if (this.phase !== 'lobby' && this.phase !== 'gameover') return;
    for (const p of this.players.values()) p.score = 0;
    this.winnerId = null;
    this.track = this.pickTrack();
    this.spawnAll(0, 0);
    this.setPhase('countdown', this.opts.countdownSec);
  }

  /** Random track, never the same one twice in a row (when there is more than one). */
  pickTrack() {
    if (this.opts.trackId) return getTrack(this.opts.trackId);
    const choices = TRACKS.filter((t) => t !== this.track);
    const pool = choices.length ? choices : TRACKS;
    return pool[Math.floor((this.opts.rng ?? Math.random)() * pool.length)];
  }

  resetToLobby() {
    this.cars.clear();
    this.eliminated = [];
    this.roundResult = [];
    this.leaderId = null;
    this.setPhase('lobby', 0);
  }

  setPhase(phase, timer = 0) {
    this.phase = phase;
    this.timer = timer;
    this.broadcastLobby();
  }

  /** Start a fresh round: every player gets a car on a 2-wide grid behind arc length s. */
  spawnAll(s, prog) {
    this.cars.clear();
    this.eliminated = [];
    this.roundResult = [];
    this.roundSize = this.players.size;
    let k = 0;
    for (const p of this.players.values()) {
      const row = Math.floor(k / 2);
      const col = k % 2;
      const car = createCar(p.id);
      placeCar(car, s - row * GRID_ROW_GAP, col ? GRID_LATERAL : -GRID_LATERAL, prog - row * GRID_ROW_GAP, this.track);
      this.cars.set(p.id, car);
      k++;
    }
    const c = this.track.pointAt(s - GRID_ROW_GAP / 2);
    this.cam = { x: c.x, y: c.y };
    this.leaderId = this.players.keys().next().value ?? null;
  }

  tick(dt) {
    this.tickCount++;
    switch (this.phase) {
      case 'countdown':
        this.timer -= dt;
        if (this.timer <= 0) this.setPhase('racing');
        break;
      case 'racing':
        this.tickRacing(dt);
        break;
      case 'roundover':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.spawnAll(this.respawn.s, this.respawn.prog);
          this.setPhase('countdown', this.opts.countdownSec);
        }
        break;
      case 'gameover':
        this.timer -= dt;
        if (this.timer <= 0) this.resetToLobby();
        break;
      default:
        break;
    }
    if (this.phase !== 'lobby' && this.tickCount % 2 === 0) this.broadcastSnapshot();
  }

  tickRacing(dt) {
    const cars = [...this.cars.values()];
    if (cars.length === 0) return;
    const inputs = cars.map((c) => this.players.get(c.id).input);
    stepWorld(cars, inputs, dt, this.track);

    let leader = cars[0];
    for (const c of cars) if (c.prog > leader.prog) leader = c;
    this.leaderId = leader.id;

    const k = 1 - Math.exp(-CAMERA_SMOOTHING * dt);
    this.cam.x += (leader.x - this.cam.x) * k;
    this.cam.y += (leader.y - this.cam.y) * k;

    if (!this.practice) {
      // Cars fully outside the shared view are out. If several go in the same tick,
      // the one furthest behind goes first (and so scores less).
      const out = cars
        .filter(
          (c) =>
            c !== leader &&
            (Math.abs(c.x - this.cam.x) > VIEW_W / 2 + CAR_RADIUS ||
              Math.abs(c.y - this.cam.y) > VIEW_H / 2 + CAR_RADIUS),
        )
        .sort((a, b) => a.prog - b.prog);
      for (const c of out) {
        this.cars.delete(c.id);
        this.eliminated.push(c.id);
      }
      if (this.cars.size <= 1) this.endRound();
    }
  }

  endRound() {
    const survivor = [...this.cars.values()][0];
    if (!survivor) return;

    // Placement points: k-th eliminated gets k (disconnected players still take up a place).
    const result = [{ id: survivor.id, pts: this.eliminated.length + 1 }];
    for (let i = this.eliminated.length - 1; i >= 0; i--) {
      if (this.eliminated[i] !== null) result.push({ id: this.eliminated[i], pts: i });
    }
    for (const r of result) {
      const p = this.players.get(r.id);
      if (p) p.score += r.pts;
    }
    this.roundResult = result;
    this.leaderId = survivor.id;
    this.respawn = { s: survivor.s, prog: survivor.prog };

    const best = [...this.players.values()].sort((a, b) => b.score - a.score);
    if (best[0] && best[0].score >= this.opts.target) {
      // Tie on total: whoever did better this round wins.
      const roundPts = (id) => result.find((r) => r.id === id)?.pts ?? 0;
      const top = best.filter((p) => p.score === best[0].score).sort((a, b) => roundPts(b.id) - roundPts(a.id))[0];
      this.winnerId = top.id;
      this.setPhase('gameover', this.opts.gameOverSec);
    } else {
      this.setPhase('roundover', this.opts.roundOverSec);
    }
  }

  broadcast(obj) {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const p of this.players.values()) p.send(str);
  }

  broadcastLobby() {
    this.broadcast({
      type: 'lobby',
      phase: this.phase,
      owner: this.ownerId,
      target: this.opts.target,
      winner: this.winnerId,
      track: this.track ? { id: this.track.id, name: this.track.name } : null,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
    });
  }

  broadcastSnapshot() {
    this.broadcast({
      type: 'snap',
      phase: this.phase,
      count: this.phase === 'countdown' ? round3(Math.max(0, this.timer)) : 0,
      cam: { x: round1(this.cam.x), y: round1(this.cam.y) },
      leader: this.leaderId,
      dead: this.eliminated.filter((id) => id !== null),
      result: this.phase === 'roundover' || this.phase === 'gameover' ? this.roundResult : [],
      winner: this.winnerId,
      cars: [...this.cars.values()].map((c) => ({ id: c.id, x: round1(c.x), y: round1(c.y), a: round3(c.a) })),
    });
  }
}
