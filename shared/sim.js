// Car physics and race progress. Pure functions over plain objects, used by the server.

export const VIEW_W = 1280; // logical viewport size in world units; elimination depends on it
export const VIEW_H = 720;
export const CAR_RADIUS = 16;

export const PHYS = {
  ACCEL: 420, // units/s^2 forward
  BRAKE: 800, // braking / reverse-to-forward deceleration
  MAX_SPEED: 430,
  MAX_REVERSE: 140,
  COAST_DRAG: 0.6, // 1/s, applied when no throttle
  GRIP: 5.5, // 1/s, how quickly sideways velocity dies (lower = more drift)
  TURN: 3.2, // rad/s at full steer
  TURN_FULL_SPEED: 140, // below this forward speed steering is scaled down
  OFF_SPEED_FACTOR: 0.45, // top speed multiplier off the asphalt
  OFF_DRAG: 2.2, // 1/s extra drag off the asphalt
  RESTITUTION: 0.5,
  // Progress jumps larger than this in one tick mean the car cut across the grass to a distant
  // part of the loop; they are not credited, so shortcuts can't skip part of the lap.
  MAX_PROGRESS_STEP: 100,
};

export const NO_INPUT = Object.freeze({ up: false, down: false, left: false, right: false });

export function createCar(id) {
  return { id, x: 0, y: 0, a: 0, vx: 0, vy: 0, s: 0, prog: 0, off: false };
}

/** Put a car on the track at arc length s, offset sideways by `lateral` units (+ = right of travel). */
export function placeCar(car, s, lateral, prog, track) {
  const p = track.pointAt(s);
  car.x = p.x - Math.sin(p.a) * lateral;
  car.y = p.y + Math.cos(p.a) * lateral;
  car.a = p.a;
  car.vx = 0;
  car.vy = 0;
  car.s = track.wrapS(s);
  car.prog = prog;
  car.off = false;
}

export function stepCar(car, input, dt, track) {
  const P = PHYS;
  const near = track.nearest(car.x, car.y);
  car.off = near.dist > near.hw; // road width varies along the track

  let fx = Math.cos(car.a);
  let fy = Math.sin(car.a);
  let rx = -fy;
  let ry = fx;
  let vf = car.vx * fx + car.vy * fy;
  let vl = car.vx * rx + car.vy * ry;

  const throttle = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  if (throttle > 0) vf += (vf < 0 ? P.BRAKE : P.ACCEL) * dt;
  else if (throttle < 0) vf -= (vf > 0 ? P.BRAKE : P.ACCEL * 0.6) * dt;
  else vf *= Math.exp(-P.COAST_DRAG * dt);

  if (car.off) vf *= Math.exp(-P.OFF_DRAG * dt);
  const maxV = P.MAX_SPEED * (car.off ? P.OFF_SPEED_FACTOR : 1);
  if (vf > maxV) vf = Math.max(maxV, vf - P.BRAKE * dt);
  if (vf < -P.MAX_REVERSE) vf = -P.MAX_REVERSE;

  vl *= Math.exp(-P.GRIP * dt);

  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const steerFactor = Math.max(-1, Math.min(1, vf / P.TURN_FULL_SPEED));
  car.a += steer * P.TURN * steerFactor * dt;

  fx = Math.cos(car.a);
  fy = Math.sin(car.a);
  rx = -fy;
  ry = fx;
  car.vx = fx * vf + rx * vl;
  car.vy = fy * vf + ry * vl;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
}

export function resolveCollisions(cars) {
  const minDist = CAR_RADIUS * 2;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= minDist) continue;
      if (d < 1e-6) {
        dx = 1;
        dy = 0;
        d = 1;
      }
      const nx = dx / d;
      const ny = dy / d;
      const push = (minDist - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const imp = (-(1 + PHYS.RESTITUTION) * rv) / 2;
        a.vx -= imp * nx;
        a.vy -= imp * ny;
        b.vx += imp * nx;
        b.vy += imp * ny;
      }
    }
  }
}

/** Accumulate unwrapped race progress from the change in arc length. */
export function updateProgress(car, track) {
  const L = track.length;
  const s = track.nearest(car.x, car.y).s;
  let delta = s - car.s;
  if (delta > L / 2) delta -= L;
  else if (delta < -L / 2) delta += L;
  if (Math.abs(delta) <= PHYS.MAX_PROGRESS_STEP) car.prog += delta;
  car.s = s;
}

/** Advance all cars by dt. inputs[i] belongs to cars[i]. */
export function stepWorld(cars, inputs, dt, track) {
  for (let i = 0; i < cars.length; i++) stepCar(cars[i], inputs[i] || NO_INPUT, dt, track);
  resolveCollisions(cars);
  for (const car of cars) updateProgress(car, track);
}
