export const ROW = i => (i / 9) | 0;
export const COL = i => i % 9;
export const BOX = i => ((ROW(i) / 3) | 0) * 3 + ((COL(i) / 3) | 0);

export const UNITS = [];
for (let r = 0; r < 9; r++) UNITS.push([...Array(9)].map((_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push([...Array(9)].map((_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = ((b / 3) | 0) * 3, c0 = (b % 3) * 3;
  UNITS.push([...Array(9)].map((_, k) => (r0 + ((k / 3) | 0)) * 9 + c0 + (k % 3)));
}

export const PEERS = [...Array(81)].map((_, i) => {
  const set = new Set();
  for (const u of UNITS) if (u.includes(i)) for (const p of u) if (p !== i) set.add(p);
  return [...set];
});

const CELL_UNITS = [...Array(81)].map((_, i) => UNITS.filter(u => u.includes(i)));
const ALL = 0x3fe;

function popcount(m) {
  let c = 0;
  while (m) { m &= m - 1; c++; }
  return c;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function candidates(g, i) {
  let used = 0;
  for (const p of PEERS[i]) used |= 1 << g[p];
  return ALL & ~used;
}

export function hasConflict(g, i) {
  if (!g[i]) return false;
  return PEERS[i].some(p => g[p] === g[i]);
}

// Backtracking with minimum-remaining-values; stops once `limit` solutions are found.
export function countSolutions(grid, limit = 2, rng = null) {
  const g = grid.slice();
  for (let i = 0; i < 81; i++) if (hasConflict(g, i)) return { count: 0, solution: null };
  let count = 0, solution = null;
  const rec = () => {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = candidates(g, i);
      const c = popcount(m);
      if (c === 0) return false;
      if (c < bestCount) { best = i; bestMask = m; bestCount = c; if (c === 1) break; }
    }
    if (best === -1) {
      count++;
      if (!solution) solution = g.slice();
      return count >= limit;
    }
    const digits = [];
    for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
    if (rng) shuffle(digits, rng);
    for (const d of digits) {
      g[best] = d;
      if (rec()) return true;
    }
    g[best] = 0;
    return false;
  };
  rec();
  return { count, solution };
}

// Human-style solver. Level 1: naked and hidden singles. Level 2 adds locked
// candidates and naked/hidden pairs. Returns true if it solves the grid.
export function logicalSolve(grid, level) {
  const g = grid.slice();
  const cand = g.map((v, i) => (v ? 0 : candidates(g, i)));
  const place = (i, d) => {
    g[i] = d;
    cand[i] = 0;
    for (const p of PEERS[i]) cand[p] &= ~(1 << d);
  };
  for (;;) {
    let progress = false;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      if (!cand[i]) return false;
      if (popcount(cand[i]) === 1) { place(i, 31 - Math.clz32(cand[i])); progress = true; }
    }
    for (const u of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        let spot = -1, n = 0;
        for (const i of u) {
          if (g[i] === d) { n = -1; break; }
          if (cand[i] & bit) { spot = i; n++; }
        }
        if (n === 1) { place(spot, d); progress = true; }
      }
    }
    if (progress) continue;
    if (level < 2) break;
    if (lockedCandidates(g, cand) || nakedPairs(g, cand) || hiddenPairs(g, cand)) continue;
    break;
  }
  return g.every(v => v);
}

function lockedCandidates(g, cand) {
  let changed = false;
  for (const u of UNITS) {
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      const spots = u.filter(i => cand[i] & bit);
      if (spots.length < 2) continue;
      for (const other of CELL_UNITS[spots[0]]) {
        if (other === u || !spots.every(i => other.includes(i))) continue;
        for (const i of other) {
          if (!spots.includes(i) && cand[i] & bit) { cand[i] &= ~bit; changed = true; }
        }
      }
    }
  }
  return changed;
}

function nakedPairs(g, cand) {
  let changed = false;
  for (const u of UNITS) {
    const pairs = u.filter(i => popcount(cand[i]) === 2);
    for (let a = 0; a < pairs.length; a++) {
      for (let b = a + 1; b < pairs.length; b++) {
        const m = cand[pairs[a]];
        if (cand[pairs[b]] !== m) continue;
        for (const i of u) {
          if (i !== pairs[a] && i !== pairs[b] && cand[i] & m) { cand[i] &= ~m; changed = true; }
        }
      }
    }
  }
  return changed;
}

function hiddenPairs(g, cand) {
  let changed = false;
  for (const u of UNITS) {
    const where = [];
    for (let d = 1; d <= 9; d++) where[d] = u.filter(i => cand[i] & (1 << d));
    for (let d1 = 1; d1 <= 9; d1++) {
      if (where[d1].length !== 2) continue;
      for (let d2 = d1 + 1; d2 <= 9; d2++) {
        if (where[d2].length !== 2 || where[d2][0] !== where[d1][0] || where[d2][1] !== where[d1][1]) continue;
        const keep = (1 << d1) | (1 << d2);
        for (const i of where[d1]) {
          if (cand[i] & ~keep) { cand[i] &= keep; changed = true; }
        }
      }
    }
  }
  return changed;
}

export function grade(puzzle) {
  if (logicalSolve(puzzle, 1)) return 1;
  if (logicalSolve(puzzle, 2)) return 2;
  return 3;
}

const RULES = {
  easy: { minClues: 38, maxLevel: 1, want: 1 },
  medium: { minClues: 0, maxLevel: 1, want: 1 },
  hard: { minClues: 0, maxLevel: 2, want: 2 },
  expert: { minClues: 0, maxLevel: 3, want: 3 },
};

function attempt(difficulty, rng) {
  const rule = RULES[difficulty];
  const solution = countSolutions(Array(81).fill(0), 1, rng).solution;
  const puzzle = solution.slice();
  let clues = 81;
  for (const i of shuffle([...Array(41).keys()], rng)) {
    const pair = i === 40 ? [40] : [i, 80 - i];
    if (clues - pair.length < rule.minClues) continue;
    for (const p of pair) puzzle[p] = 0;
    const ok = countSolutions(puzzle, 2).count === 1 && (rule.maxLevel === 3 || logicalSolve(puzzle, rule.maxLevel));
    if (ok) clues -= pair.length;
    else for (const p of pair) puzzle[p] = solution[p];
  }
  return { puzzle, solution, level: grade(puzzle) };
}

export function generate(difficulty, rng = Math.random, maxAttempts = 60) {
  const want = RULES[difficulty].want;
  let best = null;
  for (let n = 0; n < maxAttempts; n++) {
    const a = attempt(difficulty, rng);
    if (a.level === want) return { puzzle: a.puzzle, solution: a.solution };
    if (!best || Math.abs(a.level - want) < Math.abs(best.level - want)) best = a;
  }
  return { puzzle: best.puzzle, solution: best.solution };
}
