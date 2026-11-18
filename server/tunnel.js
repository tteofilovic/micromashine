// Starts a Cloudflare "quick tunnel" (cloudflared) so friends can reach the server over the internet.
// The tunnel is optional: if cloudflared is missing or fails, the game keeps working on the LAN.
import { spawn } from 'node:child_process';

const URL_RE = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.trycloudflare\.com/i;

/** Extract the public tunnel URL from a line of cloudflared output, or null. */
export function parseTunnelUrl(text) {
  const m = URL_RE.exec(text);
  return m ? m[0] : null;
}

/**
 * Spawn the tunnel pointing at http://localhost:<port>.
 * Callbacks: onUrl(url) once the public URL is known; onError(message) if it can't run or dies early.
 * `command`/`args` can be overridden (tests use a fake cloudflared).
 * Returns { stop() }.
 */
export function startTunnel(port, { onUrl, onError, command = 'cloudflared', args, timeoutMs = 30_000 } = {}) {
  const finalArgs = args ?? ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'];
  let child;
  let urlFound = false;
  let stopped = false;

  const fail = (message) => {
    if (!stopped) onError?.(message);
  };

  try {
    child = spawn(command, finalArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    fail(`Ne mogu da pokrenem ${command}: ${err.message}`);
    return { stop() {} };
  }

  const timer = setTimeout(() => {
    if (!urlFound) fail('Tunel nije dobio javnu adresu u roku od 30 s. Proveri internet vezu.');
  }, timeoutMs);
  timer.unref();

  const onData = (chunk) => {
    if (urlFound) return;
    const url = parseTunnelUrl(chunk.toString());
    if (url) {
      urlFound = true;
      clearTimeout(timer);
      onUrl?.(url);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData); // cloudflared logs to stderr

  child.on('error', (err) => {
    clearTimeout(timer);
    fail(err.code === 'ENOENT' ? `${command} nije instaliran.` : `Greška tunela: ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    if (!stopped) fail(urlFound ? 'Tunel je prekinut, igrači preko interneta gube vezu.' : `Tunel se zatvorio (${signal ?? `kod ${code}`}).`);
  });

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (child && child.exitCode === null && !child.killed) child.kill();
    },
  };
}
