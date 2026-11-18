// Track geometry shared by server (physics) and client (rendering).
// A track is a closed centripetal Catmull-Rom spline sampled into a polyline (the "centerline").
// Control points are [x, y] or [x, y, halfWidth]; the half-width is interpolated smoothly between
// control points, so a track can have narrow bottlenecks. Points without it use the track default.
// Arc length `s` along the centerline is used for race progress; s = 0 is the start/finish line.
import { TRACK_DEFS } from './track-defs.js';

const SAMPLE_SPACING = 24; // target distance between samples along a spline segment
const CURB = 14; // visual curb width beyond the asphalt

// Centripetal Catmull-Rom (alpha = 0.5), Barry-Goldman form. Unlike the uniform variant it does not
// overshoot or form cusps when neighbouring control points are unevenly spaced.
function catmullRom(p0, p1, p2, p3, t) {
  const knot = (a, b, prev) => prev + Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-6);
  const t0 = 0;
  const t1 = knot(p0, p1, t0);
  const t2 = knot(p1, p2, t1);
  const t3 = knot(p2, p3, t2);
  const u = t1 + (t2 - t1) * t;
  const mix = (a, b, ta, tb) => {
    const k = (u - ta) / (tb - ta);
    return [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k];
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  const c = mix(b1, b2, t1, t2);
  return { x: c[0], y: c[1] };
}

const smooth = (t) => t * t * (3 - 2 * t);

export class Track {
  constructor({ id, name, halfWidth, points: control }) {
    this.id = id;
    this.name = name;
    this.halfWidth = halfWidth; // default / nominal half-width

    const hwOf = (c) => c[2] ?? halfWidth;
    const pts = [];
    const n = control.length;
    for (let i = 0; i < n; i++) {
      const p0 = control[(i - 1 + n) % n];
      const p1 = control[i];
      const p2 = control[(i + 1) % n];
      const p3 = control[(i + 2) % n];
      const samples = Math.min(40, Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / SAMPLE_SPACING)));
      for (let k = 0; k < samples; k++) {
        const t = k / samples;
        const pt = catmullRom(p0, p1, p2, p3, t);
        pt.hw = hwOf(p1) + (hwOf(p2) - hwOf(p1)) * smooth(t);
        pts.push(pt);
      }
    }
    this.points = pts; // { x, y, hw }

    // segs[i]: pts[i] -> pts[(i + 1) % N]; cum[i]: arc length at pts[i]; cum[N]: total length.
    const N = pts.length;
    this.segs = [];
    this.cum = [0];
    for (let i = 0; i < N; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % N];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      this.segs.push({ ax: a.x, ay: a.y, dx, dy, len, len2: len * len, h0: a.hw, h1: b.hw });
      this.cum.push(this.cum[i] + len);
    }
    this.length = this.cum[N];

    this.maxHalfWidth = Math.max(...pts.map((p) => p.hw));
    this.minHalfWidth = Math.min(...pts.map((p) => p.hw));
    const margin = this.maxHalfWidth + CURB;
    this.bounds = {
      minX: Math.min(...pts.map((p) => p.x)) - margin,
      maxX: Math.max(...pts.map((p) => p.x)) + margin,
      minY: Math.min(...pts.map((p) => p.y)) - margin,
      maxY: Math.max(...pts.map((p) => p.y)) + margin,
    };
  }

  /** Wrap an arc-length value into [0, length). */
  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Closest point on the centerline: { s, dist, x, y, hw } (hw = road half-width there). */
  nearest(x, y) {
    const segs = this.segs;
    let bestD2 = Infinity;
    let bi = 0;
    let bt = 0;
    let bx = 0;
    let by = 0;
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      let t = ((x - sg.ax) * sg.dx + (y - sg.ay) * sg.dy) / sg.len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = sg.ax + sg.dx * t;
      const py = sg.ay + sg.dy * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < bestD2) {
        bestD2 = d2;
        bi = i;
        bt = t;
        bx = px;
        by = py;
      }
    }
    const sg = segs[bi];
    return { s: this.cum[bi] + bt * sg.len, dist: Math.sqrt(bestD2), x: bx, y: by, hw: sg.h0 + (sg.h1 - sg.h0) * bt };
  }

  /** Point on the centerline at arc length s: { x, y, a, hw } where a is the heading angle. */
  pointAt(s) {
    s = this.wrapS(s);
    const cum = this.cum;
    let lo = 0;
    let hi = this.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const sg = this.segs[lo];
    const t = (s - cum[lo]) / sg.len;
    return {
      x: sg.ax + sg.dx * t,
      y: sg.ay + sg.dy * t,
      a: Math.atan2(sg.dy, sg.dx),
      hw: sg.h0 + (sg.h1 - sg.h0) * t,
    };
  }
}

export const TRACKS = TRACK_DEFS.map((d) => new Track(d));

/** Look up a track by id; unknown ids fall back to the first track. */
export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
