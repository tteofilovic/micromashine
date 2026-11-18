import { Net } from '/net.js';
import { setupInput } from '/input.js';
import { render } from '/render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const state = {
  myId: null,
  players: new Map(), // id -> { id, name, color, score }
  owner: null,
  winner: null, // winner of the last finished game (shown on the start page)
  track: null, // { id, name } of the track in use / used last, null before the first game
  phase: 'lobby',
  target: 5,
  goUntil: 0,
  joined: false,
};

const net = new Net(onMessage, () => {
  $('panel').hidden = false;
  $('joinForm').hidden = true;
  $('lobby').hidden = true;
  $('msg').textContent = 'Veza sa serverom je prekinuta. Osveži stranicu.';
});

function setPhase(phase) {
  if (phase === state.phase) return;
  if (phase === 'racing') state.goUntil = performance.now() + 800;
  state.phase = phase;
  updatePanel();
}

function onMessage(m) {
  switch (m.type) {
    case 'welcome':
      state.myId = m.id;
      state.target = m.target;
      state.joined = true;
      setupInput((msg) => net.send(msg));
      break;
    case 'lobby':
      state.players = new Map(m.players.map((p) => [p.id, p]));
      state.owner = m.owner;
      state.winner = m.winner;
      state.track = m.track;
      state.target = m.target;
      if (m.phase === 'lobby') net.clear();
      setPhase(m.phase);
      updatePanel();
      break;
    case 'snap':
      setPhase(m.phase);
      break;
    case 'error':
      $('msg').textContent = m.message;
      break;
    default:
      break;
  }
}

function updatePanel() {
  const showPanel = !state.joined || state.phase === 'lobby';
  $('panel').hidden = !showPanel;
  $('joinForm').hidden = state.joined;
  $('lobby').hidden = !state.joined;
  if (!state.joined) return;

  // After a finished game the start page lists the final standings (highest score first).
  const finished = state.winner !== null && state.phase === 'lobby';
  $('resultTitle').hidden = !finished;
  $('trackName').textContent = state.track
    ? `Prošla staza: ${state.track.name}. Nova se bira nasumično pri startu.`
    : 'Staza se bira nasumično kad host pokrene trku.';
  const players = [...state.players.values()];
  if (finished) players.sort((a, b) => b.score - a.score);

  $('players').replaceChildren(
    ...players.map((p) => {
      const li = document.createElement('li');
      if (finished && p.id === state.winner) li.className = 'winner';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.textContent = p.name;
      li.append(dot, name);
      if (finished) {
        const score = document.createElement('span');
        score.className = 'score';
        score.textContent = `${p.score} poena`;
        li.append(score);
      }
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = [
        finished && p.id === state.winner ? 'pobednik' : '',
        p.id === state.owner ? 'host' : '',
        p.id === state.myId ? 'ti' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      li.append(tag);
      return li;
    }),
  );
  const isOwner = state.owner === state.myId;
  $('start').hidden = !isOwner;
  $('wait').hidden = isOwner;
}

$('name').value = (() => {
  try {
    return localStorage.getItem('mm-name') || '';
  } catch {
    return '';
  }
})();

$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  try {
    localStorage.setItem('mm-name', name);
  } catch {
    /* storage may be unavailable */
  }
  $('msg').textContent = '';
  try {
    await net.connect();
    net.send({ type: 'join', name });
  } catch (err) {
    $('msg').textContent = err.message;
  }
});

$('start').addEventListener('click', () => net.send({ type: 'start' }));

function frame(now) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  render(ctx, w, h, net.sample(now), state, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
