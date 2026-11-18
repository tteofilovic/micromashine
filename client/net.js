// WebSocket client + snapshot buffer with interpolation.
const INTERP_DELAY_MS = 100;
const MAX_BUFFER = 30;

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
}

export class Net {
  constructor(onMessage, onClose) {
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buf = []; // { at: arrival time (performance.now), snap }
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Ne mogu da se povežem na server.'));
      ws.onclose = () => this.onClose();
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === 'snap') this.push(m);
        this.onMessage(m);
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  push(snap) {
    this.buf.push({ at: performance.now(), snap });
    if (this.buf.length > MAX_BUFFER) this.buf.shift();
  }

  clear() {
    this.buf.length = 0;
  }

  /** Interpolated view at `now`, or null if no snapshot has arrived yet. */
  sample(now) {
    const buf = this.buf;
    if (buf.length === 0) return null;
    const last = buf[buf.length - 1].snap;
    const t = now - INTERP_DELAY_MS;

    let a = buf[0];
    let b = buf[0];
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].at <= t) a = buf[i];
      if (buf[i].at >= t) {
        b = buf[i];
        break;
      }
      b = buf[i];
    }
    const k = b.at > a.at ? Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at))) : 0;

    const prev = new Map(a.snap.cars.map((c) => [c.id, c]));
    const cars = b.snap.cars.map((c) => {
      const p = prev.get(c.id) || c;
      return { id: c.id, x: lerp(p.x, c.x, k), y: lerp(p.y, c.y, k), a: lerpAngle(p.a, c.a, k) };
    });
    const cam = { x: lerp(a.snap.cam.x, b.snap.cam.x, k), y: lerp(a.snap.cam.y, b.snap.cam.y, k) };

    return {
      phase: last.phase,
      count: last.count,
      leader: last.leader,
      dead: last.dead,
      result: last.result,
      winner: last.winner,
      cam,
      cars,
    };
  }
}
