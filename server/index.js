// HTTP (static files) + WebSocket server. Run by the host: `npm start`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { startTunnel } from './tunnel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const SHARED_DIR = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function resolveFile(rawUrl) {
  let p;
  try {
    p = decodeURIComponent(rawUrl.split('?')[0]);
  } catch {
    return null;
  }
  if (p === '/') p = '/index.html';
  const isShared = p.startsWith('/shared/');
  const base = isShared ? SHARED_DIR : CLIENT_DIR;
  const full = path.resolve(base, isShared ? p.slice('/shared/'.length) : p.slice(1));
  return full.startsWith(base + path.sep) ? full : null; // blocks path traversal
}

function handleHttp(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const file = resolveFile(req.url || '/');
  if (!file) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

export function startServer({ port = 3000, host = '0.0.0.0', roomOptions = {} } = {}) {
  const room = new Room(roomOptions);
  const server = http.createServer(handleHttp);
  const wss = new WebSocketServer({ server, maxPayload: 1024 });

  wss.on('connection', (ws) => {
    let player = null;
    const send = (str) => {
      if (ws.readyState === ws.OPEN) ws.send(str);
    };
    const joinTimeout = setTimeout(() => {
      if (!player) ws.close();
    }, 10_000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;

      if (m.type === 'join' && !player) {
        const result = room.addPlayer({ name: m.name, send });
        if (result.error) {
          send(JSON.stringify({ type: 'error', message: result.error }));
          ws.close();
          return;
        }
        player = result;
        send(JSON.stringify({ type: 'welcome', id: player.id, color: player.color, target: room.opts.target }));
        room.broadcastLobby();
      } else if (m.type === 'input' && player) {
        room.setInput(player.id, m);
      } else if (m.type === 'start' && player) {
        room.start(player.id);
      } else if (m.type === 'ping' && player && typeof m.t === 'number') {
        send(JSON.stringify({ type: 'pong', t: m.t })); // lets the client measure round-trip time
      }
    });

    ws.on('close', () => {
      clearTimeout(joinTimeout);
      if (player) room.removePlayer(player.id);
    });
    ws.on('error', () => ws.terminate());
  });

  // Fixed-timestep game loop (60 Hz) driven by a faster timer with an accumulator.
  const DT = 1 / 60;
  let last = performance.now();
  let acc = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;
    while (acc >= DT) {
      room.tick(DT);
      acc -= DT;
    }
  }, 8);

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      clearInterval(loop); // don't keep the process alive if we never started listening
      wss.close();
      reject(err);
    });
    server.listen(port, host, () => {
      resolve({
        server,
        room,
        port: server.address().port,
        close() {
          clearInterval(loop);
          for (const c of wss.clients) c.terminate();
          wss.close();
          return new Promise((r) => server.close(r));
        },
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  const wantTunnel = !process.argv.includes('--no-tunnel') && !process.env.NO_TUNNEL;
  try {
    const { port: actual } = await startServer({ port });
    console.log('\nMicromašine server radi.\n');
    console.log(`  Ti (host):            http://localhost:${actual}`);
    const ips = lanAddresses();
    if (ips.length === 0) console.log('  Nije pronađena LAN adresa. Jesi li na mreži?');
    for (const ip of ips) console.log(`  Ostali igrači (LAN):  http://${ip}:${actual}`);

    if (wantTunnel) {
      console.log('\nPokrećem Cloudflare tunel za igranje preko interneta…');
      const tunnel = startTunnel(actual, {
        onUrl: (url) => {
          console.log(`\n  Ostali igrači (internet): ${url}`);
          console.log('  Svako ko ima ovaj link može da uđe u igru dok server radi.\n');
        },
        onError: (msg) => {
          console.log(`\n  Tunel nije dostupan: ${msg}`);
          if (/nije instaliran/.test(msg)) console.log('  Instaliraj ga sa: brew install cloudflared');
          console.log('  Igra i dalje radi na lokalnoj mreži (LAN).\n');
        },
      });
      const shutdown = () => {
        tunnel.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      process.on('exit', () => tunnel.stop());
    } else {
      console.log('\nTunel je isključen (samo LAN).');
    }
    console.log('Ctrl+C za kraj.\n');
  } catch (err) {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} je zauzet. Probaj: PORT=3001 npm start` : err);
    process.exit(1);
  }
}
