// Canvas rendering: track, cars, shared camera and HUD.
import { getTrack } from '/shared/track.js';
import { VIEW_W, VIEW_H } from '/shared/sim.js';

const CURB = 14;
const shapeCache = new Map(); // track id -> prebuilt paths

/** Outline of the road offset sideways from the centerline by (half-width + extra). side: +1 right, -1 left. */
function addRing(path, track, side, extra) {
  const pts = track.points;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const l = Math.hypot(tx, ty) || 1;
    const off = (pts[i].hw + extra) * side;
    const x = pts[i].x - (ty / l) * off;
    const y = pts[i].y + (tx / l) * off;
    if (i) path.lineTo(x, y);
    else path.moveTo(x, y);
  }
  path.closePath();
}

function shapesOf(track) {
  let shapes = shapeCache.get(track.id);
  if (!shapes) {
    const both = (extra) => {
      const p = new Path2D();
      addRing(p, track, 1, extra);
      addRing(p, track, -1, extra);
      return p; // filled with the even-odd rule: the area between the two rings
    };
    const single = (side, extra) => {
      const p = new Path2D();
      addRing(p, track, side, extra);
      return p;
    };
    const center = new Path2D();
    track.points.forEach((p, i) => (i ? center.lineTo(p.x, p.y) : center.moveTo(p.x, p.y)));
    center.closePath();
    shapes = {
      curb: both(CURB),
      asphalt: both(0),
      dashRight: single(1, CURB / 2),
      dashLeft: single(-1, CURB / 2),
      center,
    };
    shapeCache.set(track.id, shapes);
  }
  return shapes;
}

function drawTrack(ctx, track) {
  const sh = shapesOf(track);
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  ctx.fillStyle = '#c62828'; // curbs: red base + white dashes
  ctx.fill(sh.curb, 'evenodd');
  ctx.lineWidth = CURB;
  ctx.strokeStyle = '#fafafa';
  ctx.setLineDash([34, 34]);
  ctx.stroke(sh.dashRight);
  ctx.stroke(sh.dashLeft);
  ctx.setLineDash([]);

  ctx.fillStyle = '#454a52'; // asphalt
  ctx.fill(sh.asphalt, 'evenodd');

  ctx.lineWidth = 4; // center line
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.setLineDash([28, 36]);
  ctx.stroke(sh.center);
  ctx.setLineDash([]);

  const p = track.pointAt(0); // start/finish checker
  const hw = p.hw;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-10, -hw, 20, hw * 2);
  ctx.fillStyle = '#111';
  for (let k = 0; k < Math.ceil((hw * 2) / 20); k++) {
    for (let c = 0; c < 2; c++) if ((k + c) % 2 === 0) ctx.fillRect(-10 + c * 10, -hw + k * 20, 10, Math.min(20, hw - (-hw + k * 20)));
  }
  ctx.restore();
}

function drawGrid(ctx, cam, zoom) {
  const g = 240;
  const hx = VIEW_W / 2 / zoom + g;
  const hy = VIEW_H / 2 / zoom + g;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = Math.floor((cam.x - hx) / g) * g; x < cam.x + hx; x += g) {
    ctx.moveTo(x, cam.y - hy);
    ctx.lineTo(x, cam.y + hy);
  }
  for (let y = Math.floor((cam.y - hy) / g) * g; y < cam.y + hy; y += g) {
    ctx.moveTo(cam.x - hx, y);
    ctx.lineTo(cam.x + hx, y);
  }
  ctx.stroke();
}

function drawCar(ctx, car, player, isMe) {
  const color = player ? player.color : '#999';
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.a);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; // shadow
  ctx.fillRect(-16, -8, 36, 22);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-18, -10, 36, 20, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(20,30,40,0.85)'; // windshield
  ctx.fillRect(2, -7, 8, 14);
  ctx.fillStyle = '#111'; // rear spoiler
  ctx.fillRect(-19, -9, 3, 18);
  ctx.restore();

  ctx.font = '600 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  const label = player ? player.name : '';
  ctx.strokeText(label, car.x, car.y - 24);
  ctx.fillText(label, car.x, car.y - 24);
  if (isMe) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(car.x - 6, car.y - 48);
    ctx.lineTo(car.x + 6, car.y - 48);
    ctx.lineTo(car.x, car.y - 38);
    ctx.fill();
  }
}

function bigText(ctx, text, y, size, color = '#fff') {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = size / 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, VIEW_W / 2, y);
  ctx.fillStyle = color;
  ctx.fillText(text, VIEW_W / 2, y);
}

function drawScoreboard(ctx, view, state) {
  const dead = new Set(view ? view.dead : []);
  ctx.textAlign = 'left';
  ctx.font = '700 20px system-ui, sans-serif';
  let y = 36;
  for (const p of state.players.values()) {
    ctx.globalAlpha = dead.has(p.id) ? 0.4 : 1;
    ctx.fillStyle = p.color;
    ctx.fillRect(20, y - 16, 18, 18);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 4;
    const text = `${p.name}  ${p.score}/${state.target}${dead.has(p.id) ? '  (ispao)' : ''}`;
    ctx.strokeText(text, 48, y);
    ctx.fillText(text, 48, y);
    y += 28;
  }
  ctx.globalAlpha = 1;
}

/** Centered list of lines, each { text, color }. */
function drawList(ctx, lines, top) {
  ctx.font = '700 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  lines.forEach((l, i) => {
    const y = top + i * 46;
    ctx.strokeText(l.text, VIEW_W / 2, y);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, VIEW_W / 2, y);
  });
}

function drawHud(ctx, view, state, now) {
  drawScoreboard(ctx, view, state);
  if (!view) return;

  const name = (id) => state.players.get(id)?.name ?? '?';
  const color = (id) => state.players.get(id)?.color ?? '#fff';
  const total = (id) => state.players.get(id)?.score ?? 0;

  if (view.phase === 'countdown') {
    bigText(ctx, String(Math.max(1, Math.ceil(view.count))), VIEW_H / 2, 160);
    if (state.track) bigText(ctx, `Staza: ${state.track.name}`, VIEW_H / 2 + 90, 40);
  } else if (view.phase === 'racing') {
    if (now < state.goUntil) bigText(ctx, 'KRENI!', VIEW_H / 2, 140, '#9ccc65');
    else if (view.dead.includes(state.myId)) bigText(ctx, 'Ispao si, gledaš trku', VIEW_H - 40, 30, '#ff8a80');
  } else if (view.phase === 'roundover' || view.phase === 'gameover') {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (view.phase === 'roundover') {
      const winner = view.result[0];
      bigText(ctx, winner ? `${name(winner.id)} je preživeo rundu!` : 'Kraj runde', 130, 60);
      drawList(
        ctx,
        view.result.map((r, i) => ({
          text: `${i + 1}. ${name(r.id)}   +${r.pts}   (ukupno ${total(r.id)}/${state.target})`,
          color: color(r.id),
        })),
        230,
      );
    } else {
      bigText(ctx, `${name(view.winner)} pobeđuje u igri!`, 130, 66, '#ffd54f');
      const sorted = [...state.players.values()].sort((a, b) => b.score - a.score);
      drawList(
        ctx,
        sorted.map((p, i) => ({ text: `${i + 1}. ${p.name}   ${p.score} poena`, color: p.color })),
        230,
      );
      bigText(ctx, 'Povratak na početnu stranu…', VIEW_H - 50, 30);
    }
  }
}

/** W, H are canvas pixel dimensions. view = interpolated snapshot or null. */
export function render(ctx, W, H, view, state, now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, W, H);

  // Fixed logical viewport (VIEW_W x VIEW_H), letterboxed: everyone sees the same area.
  const scale = Math.min(W / VIEW_W, H / VIEW_H);
  const ox = (W - VIEW_W * scale) / 2;
  const oy = (H - VIEW_H * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VIEW_W, VIEW_H);
  ctx.clip();

  ctx.fillStyle = '#3c7a3a';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Outside a race, show the whole track (the one used last, or the first) behind the lobby panel.
  const track = getTrack(state.track?.id);
  const inGame = view && state.phase !== 'lobby';
  const b = track.bounds;
  const fit = Math.min(VIEW_W / (b.maxX - b.minX), VIEW_H / (b.maxY - b.minY)) * 0.92;
  const zoom = inGame ? 1 : fit;
  const cam = inGame ? view.cam : { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  ctx.save();
  ctx.translate(VIEW_W / 2, VIEW_H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-cam.x, -cam.y);
  drawGrid(ctx, cam, zoom);
  drawTrack(ctx, track);
  if (inGame) {
    for (const car of view.cars) drawCar(ctx, car, state.players.get(car.id), car.id === state.myId);
  }
  ctx.restore();

  drawHud(ctx, inGame ? view : null, state, now);
  ctx.restore();
}
