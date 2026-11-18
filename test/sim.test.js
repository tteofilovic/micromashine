import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, getTrack } from '../shared/track.js';
import { createCar, placeCar, stepWorld, updateProgress, PHYS } from '../shared/sim.js';

const DT = 1 / 60;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const klasik = getTrack('klasik');

test('there are at least 3 tracks with unique ids and names', () => {
  assert.ok(TRACKS.length >= 3, `only ${TRACKS.length} tracks`);
  assert.equal(new Set(TRACKS.map((t) => t.id)).size, TRACKS.length);
  assert.equal(new Set(TRACKS.map((t) => t.name)).size, TRACKS.length);
  assert.equal(getTrack('does-not-exist'), TRACKS[0], 'unknown id falls back to the first track');
});

for (const track of TRACKS) {
  test(`track ${track.id}: pointAt/nearest round-trip`, () => {
    assert.ok(track.length > 3000 && track.length < 12000, `length ${track.length}`);
    for (const s of [0, 500, 1234.5, track.length - 1]) {
      const p = track.pointAt(s);
      const n = track.nearest(p.x, p.y);
      assert.ok(n.dist < 0.5, `dist ${n.dist} at s=${s}`);
      assert.ok(Math.abs(n.s - track.wrapS(s)) < 1, `s ${n.s} vs ${s}`);
    }
  });

  test(`track ${track.id}: curves are wide enough for the road and its curbs (no inner-edge cusps)`, () => {
    // Curb outlines sit half-width + 14 from the centerline, so the local radius of curvature must
    // exceed that or the inner outline folds over itself. Radius is measured over ~36 units.
    let worst = Infinity;
    for (let i = 0; i < track.points.length; i++) {
      const b = track.points[i];
      const a = track.pointAt(track.cum[i] - 18);
      const c = track.pointAt(track.cum[i] + 18);
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const bc = Math.hypot(c.x - b.x, c.y - b.y);
      const ca = Math.hypot(a.x - c.x, a.y - c.y);
      const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (area2 < 1e-9) continue; // straight
      worst = Math.min(worst, (ab * bc * ca) / (2 * area2) - b.hw);
    }
    assert.ok(worst >= 22, `radius minus half-width is only ${worst.toFixed(0)}`);
  });

  test(`track ${track.id}: distant parts of the loop keep clear of each other`, () => {
    const pts = track.points;
    const L = track.length;
    let slack = Infinity; // distance between centerlines minus both half-widths minus a 90 margin
    for (let i = 0; i < pts.length; i += 2) {
      for (let j = i + 1; j < pts.length; j += 2) {
        const ds = Math.min(Math.abs(track.cum[i] - track.cum[j]), L - Math.abs(track.cum[i] - track.cum[j]));
        if (ds < 700) continue;
        slack = Math.min(slack, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) - pts[i].hw - pts[j].hw - 90);
      }
    }
    assert.ok(slack >= 0, `roads come too close: slack ${slack.toFixed(0)}`);
  });

  test(`track ${track.id}: starts on a straight, so the grid behind the line is straight too`, () => {
    const h0 = track.pointAt(0).a;
    const h1 = track.pointAt(-120).a;
    const d = Math.abs(Math.atan2(Math.sin(h0 - h1), Math.cos(h0 - h1)));
    assert.ok(d < 0.12, `heading changes ${d.toFixed(3)} rad over the grid`);
    for (const s of [-120, -60, 0, 60]) {
      assert.ok(track.pointAt(s).hw >= track.halfWidth * 0.95, `road is narrow at the start line (s=${s})`);
    }
  });

  test(`track ${track.id}: a pure-pursuit bot completes a lap and stays on the asphalt`, () => {
    const car = createCar(1);
    placeCar(car, 0, 0, 0, track);
    let offTicks = 0;
    let ticks = 0;
    while (car.prog < track.length && ticks < 60 * 60) {
      // Pure pursuit steering plus braking for the bend ahead.
      const bend = Math.abs(wrapAngle(track.pointAt(car.s + 260).a - track.pointAt(car.s).a));
      const vMax = bend > 1.0 ? 250 : bend > 0.5 ? 330 : 430;
      const v = Math.hypot(car.vx, car.vy);
      const target = track.pointAt(car.s + (bend > 1.0 ? 90 : 140));
      const err = wrapAngle(Math.atan2(target.y - car.y, target.x - car.x) - car.a);
      stepWorld([car], [{ up: v < vMax, down: v > vMax + 40, left: err < -0.05, right: err > 0.05 }], DT, track);
      if (car.off) offTicks++;
      ticks++;
    }
    assert.ok(car.prog >= track.length, `only reached ${car.prog.toFixed(0)} of ${track.length.toFixed(0)}`);
    assert.ok(offTicks / ticks < 0.05, `off-track ${((offTicks / ticks) * 100).toFixed(1)}% of the time`);
    console.log(`  ${track.id}: lap in ${(ticks * DT).toFixed(1)}s, off-track ${offTicks} ticks`);
  });
}

test('car accelerates with throttle, capped at max speed', () => {
  const car = createCar(1);
  placeCar(car, 0, 0, 0, klasik);
  // 2s stays on the start straight (the first bend is ~1000 units ahead).
  for (let i = 0; i < 60 * 2; i++) stepWorld([car], [{ up: true }], DT, klasik);
  assert.equal(car.off, false);
  const v = Math.hypot(car.vx, car.vy);
  assert.ok(v > PHYS.MAX_SPEED * 0.9 && v <= PHYS.MAX_SPEED + 1, `speed ${v}`);
});

test('physics stays finite under random inputs on every track', () => {
  for (const track of TRACKS) {
    const cars = [1, 2, 3, 4].map((id, i) => {
      const c = createCar(id);
      placeCar(c, -i * 20, (i % 2 ? 1 : -1) * 30, 0, track);
      return c;
    });
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 60 * 30; i++) {
      const inputs = cars.map(() => ({ up: rnd() > 0.2, down: rnd() > 0.9, left: rnd() > 0.6, right: rnd() > 0.6 }));
      stepWorld(cars, inputs, DT, track);
    }
    for (const c of cars) {
      for (const k of ['x', 'y', 'a', 'vx', 'vy', 'prog', 's']) assert.ok(Number.isFinite(c[k]), `${track.id}: ${k}=${c[k]}`);
    }
  }
});

test('progress is unwrapped and monotonic when driving forward across the start line', () => {
  const car = createCar(1);
  placeCar(car, klasik.length - 60, 0, -60, klasik);
  let last = car.prog;
  for (let i = 0; i < 60 * 3; i++) {
    stepWorld([car], [{ up: true }], DT, klasik);
    assert.ok(car.prog >= last - 1e-6, `prog went backwards at tick ${i}`);
    last = car.prog;
  }
  assert.ok(car.prog > 0, `prog ${car.prog}`);
});

test('cutting across the grass to a distant part of the loop earns no progress', () => {
  for (const track of TRACKS) {
    const car = createCar(1);
    placeCar(car, 300, 0, 300, track);
    const far = track.pointAt(300 + track.length * 0.45); // opposite side of the loop
    car.x = far.x;
    car.y = far.y;
    updateProgress(car, track);
    assert.equal(car.prog, 300, `${track.id}: prog jumped to ${car.prog}`);
    assert.ok(Math.abs(car.s - track.wrapS(300 + track.length * 0.45)) < 1, 'position tracking still follows the car');
  }
});

test('cars collide and are pushed apart', () => {
  const a = createCar(1);
  const b = createCar(2);
  placeCar(a, 0, 0, 0, klasik);
  placeCar(b, 0, 0, 0, klasik);
  b.x = a.x + 10;
  b.y = a.y;
  stepWorld([a, b], [{}, {}], DT, klasik);
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= 31.9);
});

test('most tracks have real bottlenecks, and none is too narrow for two cars', () => {
  const narrow = TRACKS.filter((t) => t.minHalfWidth <= t.maxHalfWidth * 0.75);
  assert.ok(narrow.length >= 3, `only ${narrow.length} tracks have a bottleneck`);
  for (const t of TRACKS) assert.ok(t.minHalfWidth >= 50, `${t.id}: half-width down to ${t.minHalfWidth}`);
});

test('tracks differ in length and road width', () => {
  const lengths = TRACKS.map((t) => t.length).sort((a, b) => a - b);
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i] - lengths[i - 1] > 150, 'two tracks have nearly the same length');
  const baseWidths = new Set(TRACKS.map((t) => t.halfWidth));
  assert.ok(baseWidths.size >= 2, 'all tracks have the same road width');
});

test('leaving the road is judged against the local width, narrow or wide', () => {
  for (const track of TRACKS) {
    // find the narrowest and widest places on the track
    let narrowS = 0;
    let wideS = 0;
    for (let s = 0; s < track.length; s += 10) {
      if (track.pointAt(s).hw < track.pointAt(narrowS).hw) narrowS = s;
      if (track.pointAt(s).hw > track.pointAt(wideS).hw) wideS = s;
    }
    for (const s of [narrowS, wideS]) {
      const hw = track.pointAt(s).hw;
      for (const [lateral, expectOff] of [[hw - 8, false], [hw + 8, true]]) {
        const car = createCar(1);
        placeCar(car, s, lateral, 0, track);
        stepWorld([car], [{}], DT, track);
        assert.equal(car.off, expectOff, `${track.id} s=${s.toFixed(0)} hw=${hw.toFixed(0)} lateral=${lateral.toFixed(0)}`);
      }
    }
  }
});
