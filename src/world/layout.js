// The large-scale plan of the habitat: districts along the ring, the river,
// and the cross-section profile of the land (valley, terraces, berm) at any s.
// Everything here is a pure function of position so any part of the ring can
// be generated independently and always comes out the same.

import {
  CIRC, TUBE_HC, TUBE_R, SPOKES, SPOKE_SPACING, TERRACES, WATER_H,
  ROW_DS, SECTORS, ROWS_PER_SECTOR,
} from '../core/config.js';
import { noiseS, noise2, smoothstep, lerp, clamp, wrapS, hash } from '../core/math.js';

// ---------------------------------------------------------------------------
// Biomes: each of the six stretches between spokes has its own character.

export const BIOMES = {
  lake: { key: 'lake', tw: [0.0, 1.0], lake: 1, valleyAmp: 1.3, use: ['forest', 'res'], label: 'Lakeside' },
  farm: { key: 'farm', tw: [1.0, 1.0], lake: 0, valleyAmp: 0.5, use: ['farm', 'farm'], label: 'Farms' },
  forest: { key: 'forest', tw: [0.0, 0.0], lake: 0.3, valleyAmp: 1.8, use: ['forest', 'forest'], label: 'Woods' },
  paddy: { key: 'paddy', tw: [1.0, 1.0], lake: 0, valleyAmp: 0.4, use: ['paddy', 'paddy'], label: 'Rice Terraces' },
  lake2: { key: 'lake2', tw: [1.0, 0.0], lake: 1, valleyAmp: 1.1, use: ['garden', 'forest'], label: 'Water Gardens' },
  meadow: { key: 'meadow', tw: [0.35, 1.0], lake: 0, valleyAmp: 1.0, use: ['meadow', 'orchard'], label: 'Meadows' },
};
export const SEGMENT_BIOMES = ['lake', 'farm', 'forest', 'paddy', 'lake2', 'meadow'].map((k) => BIOMES[k]);

// ---------------------------------------------------------------------------
// Names — procedurally generated, one per spoke town and per stretch.

const SYL_A = ['Ar', 'Bel', 'Cor', 'Del', 'Es', 'Fal', 'Gal', 'Hal', 'Ir', 'Kel', 'Lun', 'Mer', 'Nor', 'Or', 'Pel', 'Quin', 'Ros', 'Sel', 'Tal', 'Ul', 'Val', 'Wyn'];
const SYL_B = ['a', 'e', 'i', 'o', 'ia', 'ea', 'ou', 'y'];
const SYL_C = ['ran', 'dell', 'mont', 'wick', 'sary', 'thon', 'lis', 'more', 'vale', 'mere', 'ston', 'bury', 'dor', 'nis'];

function makeName(seed) {
  const h1 = hash(seed, 1);
  const h2 = hash(seed, 2);
  const h3 = hash(seed, 3);
  return SYL_A[h1 % SYL_A.length] + SYL_B[h2 % SYL_B.length] + SYL_C[h3 % SYL_C.length];
}

export const TOWN_NAMES = Array.from({ length: SPOKES }, (_, i) => makeName(1000 + i * 7));
export const SEGMENT_NAMES = Array.from({ length: SPOKES }, (_, i) => makeName(2000 + i * 13));

// ---------------------------------------------------------------------------
// Zones

/** Which side of the valley the river is pushed to in the town around spoke k. */
export const townRiverSide = (k) => (k % 2 === 0 ? 1 : -1);

export function zoneAt(sIn, out = {}) {
  const s = wrapS(sIn);
  const k = Math.round(s / SPOKE_SPACING);
  const d = s - k * SPOKE_SPACING;
  const ad = Math.abs(d);
  const j = noiseS(s, 160, 7) * 22;
  const town = 1 - smoothstep(95, 145, ad + j * 0.4);
  const core = smoothstep(235, 315, ad + j);
  const seg = Math.min(SPOKES - 1, Math.floor(s / SPOKE_SPACING));
  const segMid = (seg + 0.5) * SPOKE_SPACING;
  const biome = SEGMENT_BIOMES[seg];
  out.s = s;
  out.spoke = ((k % SPOKES) + SPOKES) % SPOKES;
  out.dSpoke = d;
  out.town = town;
  out.core = core;
  out.res = Math.max(0, 1 - town - core);
  out.seg = seg;
  out.biome = biome;
  out.dMid = s - segMid;
  const dm = Math.abs(out.dMid) + noiseS(s, 90, 9) * 25;
  out.lake = biome.lake * (1 - smoothstep(60, 185, dm)) * core;
  return out;
}

/** River centre-line, half-width and how much it is a walled canal. */
export function riverAt(s, z, out = {}) {
  const meander = 7.5 * noiseS(s, 360, 21) + 3.0 * noiseS(s, 125, 22);
  const lakeShift = z.lake * 5 * noiseS(s, 600, 24);
  const townC = 20 * townRiverSide(z.spoke);
  out.c = lerp(meander * (1 - 0.6 * z.lake) + lakeShift, townC, z.town);
  out.hw = 4.3 + 1.1 * noiseS(s, 210, 23) + z.lake * (15 + 4 * noiseS(s, 90, 25)) - 0.6 * z.town;
  out.canal = smoothstep(0.35, 0.8, z.town);
  out.bankH = 0.5 + 0.55 * out.canal;
  return out;
}

const _rise = new Float64Array(TERRACES);

/**
 * Parameters of one side of the valley (si = 0 left / u < 0, si = 1 right).
 * Distances are measured outward from the tube's centre plane (x = sigma * u).
 */
export function sideAt(s, z, river, si, out = {}) {
  const sigma = si === 0 ? -1 : 1;
  const b = z.biome;
  const tw = clamp(z.town + z.res + z.core * b.tw[si], 0, 1);
  const bankTop = sigma * river.c + river.hw + 2.5 * (1 - river.canal);
  let x0 = 25 + 3 * noiseS(s, 170, 31 + si) + z.lake * 9 + z.town * 1.5;
  x0 = Math.max(x0, bankTop + 7);
  const H = 26 + 3 * noiseS(s, 240, 41 + si);
  const A0 = lerp(1.6 + 0.4 * noiseS(s, 150, 45 + si), river.bankH + 0.25, z.town);
  const hj = A0 + H + 2.2;
  const xj = Math.sqrt(TUBE_R * TUBE_R - (hj - TUBE_HC) * (hj - TUBE_HC)) - 0.15;
  const xEnd = xj - 3.2;
  const xs = out.x || (out.x = new Float64Array(TERRACES + 1));
  const L = out.L || (out.L = new Float64Array(TERRACES + 1)); // L[0] = A0, L[k+1] = level of terrace k
  xs[0] = x0;
  for (let k = 1; k < TERRACES; k++) {
    xs[k] = x0 + (xEnd - x0) * (k / TERRACES + 0.035 * noiseS(s, 110, 60 + k + si * 7));
  }
  xs[TERRACES] = xEnd;
  let sum = 0;
  for (let k = 0; k < TERRACES; k++) {
    _rise[k] = 1 + 0.25 * noiseS(s, 95, 70 + k + si * 7);
    sum += _rise[k];
  }
  L[0] = A0;
  for (let k = 0; k < TERRACES; k++) L[k + 1] = L[k] + (_rise[k] / sum) * H;
  out.si = si;
  out.sigma = sigma;
  out.tw = tw;
  out.bankTop = bankTop;
  out.x0 = x0;
  out.xEnd = xEnd;
  out.xj = xj;
  out.hj = hj;
  out.H = H;
  out.A0 = A0;
  // Land use of the terraces on this side.
  out.use = z.town > 0.5 ? 'town' : z.core > 0.5 ? b.use[si] : 'res';
  out.paddy = b.key === 'paddy' ? smoothstep(0.5, 0.9, z.core) : 0;
  return out;
}

/** Everything about the cross-section at s. */
export function sliceAt(s, out = {}) {
  out.s = wrapS(s);
  out.z = zoneAt(out.s, out.z || {});
  out.river = riverAt(out.s, out.z, out.river || {});
  out.sides = out.sides || [{}, {}];
  sideAt(out.s, out.z, out.river, 0, out.sides[0]);
  sideAt(out.s, out.z, out.river, 1, out.sides[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Heights

export function valleyHeight(s, u, t, sl, side) {
  const z = sl.z;
  const amp = z.res * 0.35 + z.core * z.biome.valleyAmp;
  const bankH = sl.river.bankH;
  const base = bankH + (side.A0 - bankH) * t * t;
  const hill = amp * (0.5 + 0.5 * noise2(s, u, 38, 81 + side.si)) * Math.pow(Math.sin(Math.PI * t), 0.8);
  return base + hill;
}

/** Height of the natural (unterraced) hillside at lateral distance x. */
function naturalHeight(s, x, side) {
  const t = clamp((x - side.x0) / (side.xEnd - side.x0), 0, 1);
  const e = Math.pow(t, 1.35);
  const bump = 1.6 * noise2(s, x * side.sigma, 30, 91 + side.si) * Math.sin(Math.PI * t);
  return side.A0 + side.H * e + bump;
}

// Relative positions of the interior points across a terrace top (denser at
// the front, where the walkway runs).
const TERRACE_FRACS = [0.12, 0.3, 0.5, 0.7, 0.88];
export const NV = 24; // valley points per side

// ---------------------------------------------------------------------------
// Cross-section profile. A fixed number of points so neighbouring rows always
// line up into a grid. Walls are vertical pairs of points.

export const SEG = { BED: 0, BANK: 1, VALLEY: 2, WALL: 3, TERRACE: 4, BERM: 5 };

const sideLayout = [];
// inner → outer
for (let i = 0; i < NV; i++) sideLayout.push({ kind: 'valley', i, crease: i === 0 });
for (let k = 0; k < TERRACES; k++) {
  sideLayout.push({ kind: 'wallBot', k, crease: true });
  sideLayout.push({ kind: 'wallTop', k, crease: true });
  for (let f = 0; f < TERRACE_FRACS.length; f++) sideLayout.push({ kind: 'top', k, f, crease: false });
}
sideLayout.push({ kind: 'bermBot', crease: true });
sideLayout.push({ kind: 'bermTop', crease: false });
const SIDE_N = sideLayout.length;

/** Profile point descriptors in order of increasing u. */
export const PROFILE = [];
for (let i = SIDE_N - 1; i >= 0; i--) PROFILE.push({ ...sideLayout[i], si: 0 });
PROFILE.push({ kind: 'edge', si: 0, crease: true });
PROFILE.push({ kind: 'bed', b: -1, crease: false });
PROFILE.push({ kind: 'bed', b: 0, crease: false });
PROFILE.push({ kind: 'bed', b: 1, crease: false });
PROFILE.push({ kind: 'edge', si: 1, crease: true });
for (let i = 0; i < SIDE_N; i++) PROFILE.push({ ...sideLayout[i], si: 1 });
export const NP = PROFILE.length;

// Segment type between point j and j+1, and the terrace index for terrace segments.
export const SEG_TYPE = new Uint8Array(NP - 1);
export const SEG_TERRACE = new Int8Array(NP - 1);
for (let j = 0; j < NP - 1; j++) {
  const a = PROFILE[j];
  const b = PROFILE[j + 1];
  const pair = (p, q) => (a.kind === p && b.kind === q) || (a.kind === q && b.kind === p);
  let t = SEG.VALLEY;
  let k = -1;
  if (a.kind === 'bed' || b.kind === 'bed') t = SEG.BED;
  else if (pair('edge', 'valley')) t = SEG.BANK;
  else if (pair('wallBot', 'wallTop')) {
    t = SEG.WALL;
    k = a.k;
  } else if (a.kind === 'top' || b.kind === 'top' || pair('wallTop', 'wallBot') || pair('wallTop', 'bermBot')) {
    t = SEG.TERRACE;
    k = a.kind === 'wallTop' || a.kind === 'top' ? a.k : b.k;
  } else if (pair('bermBot', 'bermTop')) t = SEG.BERM;
  SEG_TYPE[j] = t;
  SEG_TERRACE[j] = k;
}

/**
 * Compute the profile (u, h) at s into the provided arrays.
 */
export function computeProfile(s, sl, U, Hh) {
  const river = sl.river;
  const c = river.c;
  const hw = river.hw;
  const canal = river.canal;
  for (let j = 0; j < NP; j++) {
    const p = PROFILE[j];
    let u = 0;
    let h = 0;
    if (p.kind === 'bed') {
      u = c + p.b * hw * 0.55;
      h = p.b === 0 ? -1.55 - 0.6 * sl.z.lake : -1.35 - 0.45 * sl.z.lake;
    } else if (p.kind === 'edge') {
      const sg = p.si === 0 ? -1 : 1;
      u = c + sg * (hw - 0.4 * (1 - canal));
      h = WATER_H - 0.35 - 0.5 * canal;
    } else {
      const side = sl.sides[p.si];
      const sg = side.sigma;
      const tw = side.tw;
      let x;
      switch (p.kind) {
        case 'valley': {
          const t = p.i / NV;
          x = side.bankTop + (side.x0 - side.bankTop) * t;
          h = valleyHeight(sl.s, sg * x, t, sl, side);
          break;
        }
        case 'wallBot': {
          x = side.x[p.k];
          const T = side.L[p.k];
          h = lerp(naturalHeight(sl.s, x, side), T, tw);
          break;
        }
        case 'wallTop': {
          x = side.x[p.k];
          const T = side.L[p.k + 1];
          h = lerp(naturalHeight(sl.s, x, side), T, tw);
          break;
        }
        case 'top': {
          const f = TERRACE_FRACS[p.f];
          x = lerp(side.x[p.k], side.x[p.k + 1], f);
          let T = side.L[p.k + 1];
          if (side.paddy > 0 && f > 0.25) T -= 0.28 * side.paddy;
          h = lerp(naturalHeight(sl.s, x, side), T, tw);
          break;
        }
        case 'bermBot': {
          x = side.xEnd;
          h = lerp(naturalHeight(sl.s, x, side), side.L[TERRACES], tw);
          break;
        }
        case 'bermTop': {
          x = side.xj;
          h = side.hj;
          break;
        }
        default:
          x = 0;
      }
      u = sg * x;
    }
    U[j] = u;
    Hh[j] = h;
  }
}

// ---------------------------------------------------------------------------
// Row cache: the ground is a grid of rows spaced ROW_DS apart around the ring.

export const TOTAL_ROWS = SECTORS * ROWS_PER_SECTOR;
const rowU = new Array(TOTAL_ROWS);
const rowH = new Array(TOTAL_ROWS);
const rowSlice = new Array(TOTAL_ROWS);

export function rowIndex(r) {
  return ((r % TOTAL_ROWS) + TOTAL_ROWS) % TOTAL_ROWS;
}

export function getRow(rIn) {
  const r = rowIndex(rIn);
  if (!rowU[r]) {
    const sl = sliceAt(r * ROW_DS);
    const U = new Float32Array(NP);
    const H = new Float32Array(NP);
    computeProfile(sl.s, sl, U, H);
    rowU[r] = U;
    rowH[r] = H;
    rowSlice[r] = sl;
  }
  return { U: rowU[r], H: rowH[r], slice: rowSlice[r] };
}

/** Height of a row's profile at lateral position u (piecewise linear). */
function rowHeightAt(U, H, u) {
  if (u <= U[0]) return H[0];
  if (u >= U[NP - 1]) return H[NP - 1];
  // Binary search for the segment.
  let lo = 0;
  let hi = NP - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (U[mid] <= u) lo = mid;
    else hi = mid;
  }
  const du = U[hi] - U[lo];
  if (du < 1e-6) return Math.max(H[lo], H[hi]);
  return H[lo] + ((H[hi] - H[lo]) * (u - U[lo])) / du;
}

/** Terrain height at (s, u), matching the rendered ground mesh. */
export function groundHeight(s, u) {
  const x = wrapS(s) / ROW_DS;
  const r0 = Math.floor(x);
  const t = x - r0;
  const a = getRow(r0);
  const b = getRow(r0 + 1);
  return lerp(rowHeightAt(a.U, a.H, u), rowHeightAt(b.U, b.H, u), t);
}

/** Region classification at (s, u) using an existing slice. */
export function regionAt(sl, u, out = {}) {
  const r = sl.river;
  const si = u < r.c ? 0 : 1;
  const side = sl.sides[si];
  const x = side.sigma * u;
  out.si = si;
  out.side = side;
  out.x = x;
  out.k = -2;
  if (Math.abs(u - r.c) < r.hw) out.kind = 'water';
  else if (x < side.bankTop) out.kind = 'bank';
  else if (x < side.x0) {
    out.kind = 'valley';
    out.k = -1;
  } else if (x >= side.xEnd) out.kind = 'berm';
  else {
    out.kind = 'terrace';
    let k = 0;
    while (k < TERRACES - 1 && x >= side.x[k + 1]) k++;
    out.k = k;
  }
  return out;
}

/** Is (s,u) under open water? */
export function waterAt(s, u) {
  const sl = sliceAt(s);
  return Math.abs(u - sl.river.c) < sl.river.hw ? WATER_H : null;
}

export const RING_CIRC = CIRC;
