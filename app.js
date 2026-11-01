import { generate, countSolutions, hasConflict, mulberry32, hashString, PEERS, ROW, COL, BOX } from './sudoku.js';

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const settings = Object.assign({ erase: 'diagonal', mistakes: 'instant', haptics: true }, store.get('sudoku.settings', {}));
let mode = store.get('sudoku.mode', 'commit');
let game = store.get('sudoku.game', null);
let selected = -1;
let checkedWrong = new Set();

const $ = id => document.getElementById(id);
const board = $('board');
const keypad = $('keypad');
const cells = [];

// Gesture geometry, in CSS pixels from the touch-down point.
const KEY = 54;
const R_CENTER = 18;
const R_ERASE = 115;
const R_RING_OUT = 175;
const SECTOR_DIGITS = [6, 9, 8, 7, 4, 1, 2, 3];

function buildBoard() {
  for (let b = 0; b < 9; b++) {
    const box = document.createElement('div');
    box.className = 'box';
    for (let k = 0; k < 9; k++) {
      const i = (((b / 3) | 0) * 3 + ((k / 3) | 0)) * 9 + (b % 3) * 3 + (k % 3);
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.i = i;
      const value = document.createElement('span');
      const notes = document.createElement('div');
      notes.className = 'notes';
      for (let d = 1; d <= 9; d++) notes.appendChild(document.createElement('span'));
      cell.append(value, notes);
      box.appendChild(cell);
      cells[i] = { el: cell, value, notes: [...notes.children] };
    }
    board.appendChild(box);
  }
}

function newGame({ kind, difficulty = null, puzzle, solution, label }) {
  if (kind === 'entering' && game && !game.entering) store.set('sudoku.prev', game);
  game = {
    kind, difficulty, label,
    givens: puzzle.slice(),
    solution,
    values: puzzle.slice(),
    notes: Array(81).fill(0),
    elapsed: 0,
    done: false,
    entering: kind === 'entering',
    history: [],
    future: [],
  };
  selected = -1;
  checkedWrong = new Set();
  timer.reset();
  save();
  render();
}

function startGenerated(difficulty) {
  const { puzzle, solution } = generate(difficulty);
  newGame({ kind: 'random', difficulty, puzzle, solution, label: difficulty });
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startDaily() {
  const day = todayKey();
  const { puzzle, solution } = generate('medium', mulberry32(hashString('daily-' + day)));
  newGame({ kind: 'daily', difficulty: 'medium', puzzle, solution, label: 'Daily ' + day });
}

function parsePuzzle(text) {
  const chars = text.replace(/\s/g, '').replace(/^.*[?&]p=/, '').replace(/[&#].*$/, '');
  if (chars.length !== 81 || /[^0-9._-]/.test(chars)) return null;
  return [...chars].map(c => (/[1-9]/.test(c) ? +c : 0));
}

function startCustom(puzzle, label) {
  if (puzzle.some((v, i) => hasConflict(puzzle, i))) {
    message('Not valid', 'The same digit appears twice in a row, column or box.');
    return false;
  }
  const { count, solution } = countSolutions(puzzle, 2);
  if (count === 0) {
    message('No solution', 'This puzzle cannot be solved.');
    return false;
  }
  newGame({ kind: 'custom', puzzle, solution: count === 1 ? solution : null, label });
  if (count > 1) message('More than one solution', 'You can still play it. Any valid filled board counts as solved.');
  return true;
}

function save() {
  if (game) store.set('sudoku.game', game);
}

/* ---------- moves, undo, redo ---------- */

function applyChange(changes) {
  const before = changes.map(c => ({ i: c.i, v: game.values[c.i], n: game.notes[c.i] }));
  setCells(changes);
  game.history.push({ before, after: changes });
  game.future = [];
  afterChange();
}

function setCells(list) {
  for (const c of list) {
    game.values[c.i] = c.v;
    game.notes[c.i] = c.n;
    checkedWrong.delete(c.i);
  }
}

function undo() {
  const step = game.history.pop();
  if (!step) return;
  setCells(step.before);
  game.future.push(step);
  afterChange();
}

function redo() {
  const step = game.future.pop();
  if (!step) return;
  setCells(step.after);
  game.history.push(step);
  afterChange();
}

function input(i, action) {
  if (game.done || (!game.entering && game.givens[i])) return;
  const v = game.values[i], n = game.notes[i];
  if (action === 'erase') {
    if (v || n) applyChange([{ i, v: 0, n: 0 }]);
    return;
  }
  const d = action, bit = 1 << d;
  if (mode === 'note' && !game.entering) {
    if (!v) applyChange([{ i, v: 0, n: n ^ bit }]);
    return;
  }
  if (v === d) {
    applyChange([{ i, v: 0, n }]);
    return;
  }
  const changes = [{ i, v: d, n }];
  if (!game.entering) {
    for (const p of PEERS[i]) {
      if (game.notes[p] & bit) changes.push({ i: p, v: game.values[p], n: game.notes[p] & ~bit });
    }
  }
  applyChange(changes);
}

function afterChange() {
  if (!game.entering && game.values.every(v => v)) {
    const solved = game.solution
      ? game.values.every((v, i) => v === game.solution[i])
      : game.values.every((v, i) => !hasConflict(game.values, i));
    if (solved) {
      game.done = true;
      timer.stop();
      setTimeout(() => message('Solved!', `${game.label} in ${formatTime(game.elapsed)}.`), 250);
    }
  }
  save();
  render();
}

/* ---------- rendering ---------- */

function isWrong(i) {
  if (game.entering || game.givens[i] || !game.values[i]) return false;
  if (settings.mistakes === 'check') return checkedWrong.has(i);
  return hasConflict(game.values, i);
}

function render() {
  const sel = selected;
  const selDigit = sel >= 0 ? game.values[sel] : 0;
  for (let i = 0; i < 81; i++) {
    const c = cells[i];
    const v = game.values[i];
    const isPeer = sel >= 0 && i !== sel && (ROW(i) === ROW(sel) || COL(i) === COL(sel) || BOX(i) === BOX(sel));
    c.el.classList.toggle('selected', i === sel);
    c.el.classList.toggle('peer', isPeer);
    c.el.classList.toggle('same', !!selDigit && v === selDigit && i !== sel);
    c.el.classList.toggle('given', !game.entering && !!game.givens[i]);
    c.el.classList.toggle('wrong', isWrong(i));
    c.el.classList.toggle('conflict', game.entering && hasConflict(game.values, i));
    c.value.textContent = v || '';
    const n = v ? 0 : game.notes[i];
    for (let d = 1; d <= 9; d++) {
      const s = c.notes[d - 1];
      const on = !!(n & (1 << d));
      s.textContent = on ? d : '';
      s.classList.toggle('hl', on && d === selDigit);
    }
  }
  document.body.classList.toggle('mode-note', mode === 'note' && !game.entering);
  document.body.classList.toggle('mode-commit', mode !== 'note' || game.entering);
  $('mode-pill').textContent = game.entering ? 'Entering puzzle' : mode === 'note' ? '✎ Notes' : '✓ Numbers';
  $('puzzle-label').textContent = game.entering ? 'Your puzzle' : game.label;
  $('bar-play').hidden = game.entering;
  $('bar-enter').hidden = !game.entering;
  $('hint').textContent = game.entering
    ? 'Enter the givens, then press Start'
    : 'Tap the background to switch between notes and numbers';
  $('btn-undo').disabled = $('btn-enter-undo').disabled = !game.history.length;
  $('btn-redo').disabled = $('btn-enter-redo').disabled = !game.future.length;
  $('btn-check').hidden = settings.mistakes !== 'check';
  $('btn-check').disabled = game.done;
  timer.show();
}

/* ---------- keypad gesture ---------- */

let gesture = null;

function classify(dx, dy) {
  const d = Math.hypot(dx, dy);
  if (d < R_CENTER) return 5;
  const s = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  if (d < R_ERASE) return SECTOR_DIGITS[s];
  if (settings.erase === 'ring') return d < R_RING_OUT ? 'erase' : 'cancel';
  return s % 2 === 1 ? 'erase' : 'cancel';
}

function showKeypad(x, y, i) {
  const half = KEY * 1.5 + 4;
  const cx = Math.min(Math.max(x, half), innerWidth - half);
  const cy = Math.min(Math.max(y, half), innerHeight - half);
  keypad.innerHTML = '';
  keypad.style.transform = `translate(${cx}px, ${cy}px)`;
  keypad.style.setProperty('--k', KEY + 'px');
  if (settings.erase === 'ring') {
    const ring = document.createElement('div');
    const mid = (R_ERASE + R_RING_OUT) / 2, w = R_RING_OUT - R_ERASE;
    ring.className = 'ring';
    ring.dataset.t = 'erase';
    Object.assign(ring.style, {
      width: mid * 2 + w + 'px', height: mid * 2 + w + 'px',
      left: -(mid + w / 2) + 'px', top: -(mid + w / 2) + 'px', borderWidth: w + 'px',
    });
    keypad.appendChild(ring);
  } else {
    const off = (R_ERASE + 28) / Math.SQRT2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const e = document.createElement('div');
      e.className = 'erase';
      e.dataset.t = 'erase';
      e.textContent = '⌫';
      e.style.left = sx * off + 'px';
      e.style.top = sy * off + 'px';
      keypad.appendChild(e);
    }
  }
  const v = game.values[i], n = game.notes[i];
  for (let d = 1; d <= 9; d++) {
    const k = document.createElement('div');
    k.className = 'key';
    k.dataset.t = d;
    k.textContent = d;
    k.style.left = (((d - 1) % 3) - 1) * KEY + 'px';
    k.style.top = (((d - 1) / 3 | 0) - 1) * KEY + 'px';
    const on = mode === 'note' && !game.entering ? !v && n & (1 << d) : v === d;
    k.classList.toggle('on', !!on);
    keypad.appendChild(k);
  }
  keypad.hidden = false;
}

function highlightTarget(t) {
  keypad.classList.toggle('cancel', t === 'cancel');
  for (const el of keypad.children) el.classList.toggle('target', el.dataset.t === String(t));
}

function haptic() {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(6);
}

board.addEventListener('pointerdown', e => {
  const cellEl = e.target.closest('.cell');
  if (!cellEl || gesture) return;
  e.preventDefault();
  const i = +cellEl.dataset.i;
  selected = i;
  render();
  if (game.done || (!game.entering && game.givens[i])) return;
  board.setPointerCapture(e.pointerId);
  gesture = { id: e.pointerId, i, x: e.clientX, y: e.clientY, target: 5 };
  showKeypad(e.clientX, e.clientY, i);
  highlightTarget(5);
});

board.addEventListener('pointermove', e => {
  if (!gesture || e.pointerId !== gesture.id) return;
  const t = classify(e.clientX - gesture.x, e.clientY - gesture.y);
  if (t !== gesture.target) {
    gesture.target = t;
    highlightTarget(t);
    if (t !== 'cancel') haptic();
  }
});

function endGesture(e, cancelled) {
  if (!gesture || e.pointerId !== gesture.id) return;
  const t = cancelled ? 'cancel' : classify(e.clientX - gesture.x, e.clientY - gesture.y);
  const i = gesture.i;
  gesture = null;
  keypad.hidden = true;
  if (t !== 'cancel') input(i, t);
}

board.addEventListener('pointerup', e => endGesture(e, false));
board.addEventListener('pointercancel', e => endGesture(e, true));
board.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- background tap toggles note / commit mode ---------- */

let bgDown = null;
const NOT_BACKGROUND = '#board, button, dialog, input, textarea, label, a';

document.addEventListener('pointerdown', e => {
  bgDown = e.target.closest(NOT_BACKGROUND) || gesture ? null : { x: e.clientX, y: e.clientY };
});

document.addEventListener('pointerup', e => {
  const down = bgDown;
  bgDown = null;
  if (!down || !game || game.entering) return;
  if (e.target.closest(NOT_BACKGROUND)) return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 20) return;
  mode = mode === 'note' ? 'commit' : 'note';
  store.set('sudoku.mode', mode);
  render();
});

/* ---------- timer ---------- */

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

const timer = {
  since: null,
  running() { return game && !game.done && !game.entering && !document.hidden; },
  tick() {
    const now = performance.now();
    if (this.since !== null && game) game.elapsed += now - this.since;
    this.since = this.running() ? now : null;
  },
  reset() { this.since = this.running() ? performance.now() : null; },
  stop() { this.tick(); this.since = null; },
  show() { if (game) $('timer').textContent = game.entering ? '' : formatTime(game.elapsed); },
};

setInterval(() => {
  timer.tick();
  timer.show();
}, 1000);
setInterval(save, 5000);
document.addEventListener('visibilitychange', () => {
  timer.tick();
  save();
});

/* ---------- dialogs and buttons ---------- */

function message(title, text) {
  $('msg-title').textContent = title;
  $('msg-text').textContent = text;
  const dlg = $('dlg-message');
  if (!dlg.open) dlg.showModal();
}

$('btn-undo').onclick = $('btn-enter-undo').onclick = undo;
$('btn-redo').onclick = $('btn-enter-redo').onclick = redo;

$('btn-check').onclick = () => {
  checkedWrong = new Set();
  for (let i = 0; i < 81; i++) {
    if (!game.givens[i] && hasConflict(game.values, i)) checkedWrong.add(i);
  }
  render();
  if (!checkedWrong.size) message('All good', 'No mistakes so far.');
};

$('btn-new').onclick = () => {
  $('daily-date').textContent = todayKey();
  $('dlg-new').showModal();
};

$('dlg-new').addEventListener('close', () => {
  const choice = $('dlg-new').returnValue;
  $('dlg-new').returnValue = '';
  if (['easy', 'medium', 'hard', 'expert'].includes(choice)) startGenerated(choice);
  else if (choice === 'daily') startDaily();
  else if (choice === 'enter') {
    newGame({ kind: 'entering', puzzle: Array(81).fill(0), solution: null, label: 'Your puzzle' });
  } else if (choice === 'import') {
    const puzzle = parsePuzzle($('import-text').value);
    if (!puzzle) message('Couldn’t read that', 'Paste 81 characters: digits 1–9, and 0 or . for blanks. A shared link works too.');
    else if (startCustom(puzzle, 'Imported')) $('import-text').value = '';
  } else if (choice === 'share') {
    sharePuzzle();
  }
});

async function sharePuzzle() {
  const url = location.origin + location.pathname + '?p=' + game.givens.join('');
  try {
    if (navigator.share) await navigator.share({ title: "Johan's Sudoku", url });
    else {
      await navigator.clipboard.writeText(url);
      message('Link copied', url);
    }
  } catch (err) {
    if (err?.name !== 'AbortError') message('Share this link', url);
  }
}

$('btn-enter-cancel').onclick = () => {
  const prev = store.get('sudoku.prev', null);
  if (prev) {
    game = prev;
    selected = -1;
    timer.reset();
    save();
    render();
  } else startGenerated('medium');
};

$('btn-enter-start').onclick = () => {
  const puzzle = game.values.slice();
  if (puzzle.filter(Boolean).length < 17) {
    message('Too few givens', 'A sudoku needs at least 17 givens to have one solution.');
    return;
  }
  startCustom(puzzle, 'Your puzzle');
};

$('btn-settings').onclick = () => {
  const form = $('dlg-settings').querySelector('form');
  form.erase.value = settings.erase;
  form.mistakes.value = settings.mistakes;
  form.haptics.checked = settings.haptics;
  $('dlg-settings').showModal();
};

$('dlg-settings').querySelector('form').addEventListener('change', e => {
  const form = e.currentTarget;
  settings.erase = form.erase.value;
  settings.mistakes = form.mistakes.value;
  settings.haptics = form.haptics.checked;
  store.set('sudoku.settings', settings);
  render();
});

/* ---------- start ---------- */

buildBoard();

const linked = new URLSearchParams(location.search).get('p');
history.replaceState(null, '', location.pathname);

const startedFromLink = !!linked && !!parsePuzzle(linked) && startCustom(parsePuzzle(linked), 'Shared puzzle');
if (!startedFromLink) {
  if (game) {
    timer.reset();
    render();
  } else startGenerated('medium');
}
