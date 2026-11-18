// Keyboard input. Sends the full input state to the server whenever it changes.
const KEYMAP = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

export function setupInput(send) {
  const state = { up: false, down: false, left: false, right: false };
  const emit = () => send({ type: 'input', ...state });

  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (!k || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    if (!state[k]) {
      state[k] = true;
      emit();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    if (state[k]) {
      state[k] = false;
      emit();
    }
  });
  window.addEventListener('blur', () => {
    if (Object.values(state).some(Boolean)) {
      for (const k of Object.keys(state)) state[k] = false;
      emit();
    }
  });
}
