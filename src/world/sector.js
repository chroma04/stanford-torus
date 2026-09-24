// Generation of one 57.6 m sector of the ring: terrain, water, buildings,
// props, vegetation, shell structure and colliders. Implemented as a
// generator so the work can be spread over several frames.

import * as THREE from 'three';
import {
  SECTOR_LEN, ROWS_PER_SECTOR, ROW_DS, CELLS_PER_SECTOR, CELL_LEN, WATER_H, TERRACES, SPOKE_SPACING, SPOKES, CIRC, RAIL_U,
} from '../core/config.js';
import { noise2, hash, hashf, rng, smoothstep, clamp, deltaS, wrapS, lerp } from '../core/math.js';
import { getRow, NP, PROFILE, SEG, SEG_TYPE, SEG_TERRACE, sliceAt, regionAt, groundHeight } from './layout.js';
import { planCell, pathAt, occupied, promenade } from './plan.js';
import { MeshBuilder, PAT } from '../geom/builder.js';
import { buildHouse, buildMidrise } from '../geom/buildings.js';
import { buildProp, lamp as buildLamp } from '../geom/props.js';
import { buildTree } from '../geom/trees.js';
import { buildStair, buildBridge, buildEdge, edgeStyle, buildShell, buildRail, buildSpokeTower, railStation } from '../geom/structures.js';
import { placementMatrix } from '../core/ring.js';
import * as PAL from '../geom/palette.js';

const LAMP_KINDS = { post: { r: 9, y: 3.8, k: 1 }, short: { r: 5, y: 1.0, k: 0.7 }, lantern: { r: 5, y: 1.1, k: 0.7 } };

function sectorCells(i) {
  const out = [];
  for (let k = 0; k < CELLS_PER_SECTOR; k++) out.push(planCell(i * CELLS_PER_SECTOR + k));
  return out;
}

function neighbourCells(i, extra = 2) {
  const out = [];
  for (let k = -extra; k < CELLS_PER_SECTOR + extra; k++) out.push(planCell(i * CELLS_PER_SECTOR + k));
  return out;
}

/** Collect light sources near a sector (lamps and glowing props). */
function lightsNear(i) {
  const lights = [];
  for (const p of neighbourCells(i, 2)) {
    for (const l of p.lamps) lights.push({ s: l.s, u: l.u, h: l.h + LAMP_KINDS[l.kind === 'short' ? 'short' : 'post'].y, r: LAMP_KINDS[l.kind === 'short' ? 'short' : 'post'].r, k: 1 });
    for (const pr of p.props) {
      if (pr.kind === 'lantern') lights.push({ s: pr.s, u: pr.u, h: pr.h + 1.1, r: 5, k: 0.8 });
      else if (pr.kind === 'spokeTower') lights.push({ s: pr.s, u: pr.u, h: 5, r: 26, k: 0.7 });
      else if (pr.kind === 'kiosk' || pr.kind === 'cafe' || pr.kind === 'teahouse' || pr.kind === 'stall') lights.push({ s: pr.s, u: pr.u, h: pr.h + 2.5, r: 7, k: 0.6 });
    }
    for (const b of p.bridges) lights.push({ s: b.s, u: (b.uA + b.uB) / 2, h: 2, r: 6, k: 0.4 });
  }
  return lights;
}

function lampLight(lights, s, u, h) {
  let sum = 0;
  for (let k = 0; k < lights.length; k++) {
    const L = lights[k];
    const ds = deltaS(L.s, s);
    if (ds > L.r || ds < -L.r) continue;
    const du = u - L.u;
    const dh = (h - L.h) * 0.6;
    const d = Math.sqrt(ds * ds + du * du + dh * dh);
    if (d < L.r) {
      const f = 1 - d / L.r;
      sum += f * f * L.k;
    }
  }
  return Math.min(1, sum);
}

// ---------------------------------------------------------------------------
// Terrain

const GRASS = {
  lawn: [[0.37, 0.55, 0.3], [0.48, 0.61, 0.32]],
  town: [[0.39, 0.56, 0.31], [0.47, 0.6, 0.34]],
  res: [[0.37, 0.55, 0.3], [0.48, 0.61, 0.32]],
  garden: [[0.34, 0.54, 0.31], [0.45, 0.62, 0.35]],
  meadow: [[0.44, 0.59, 0.31], [0.58, 0.63, 0.35]],
  orchard: [[0.4, 0.56, 0.29], [0.51, 0.6, 0.31]],
  forest: [[0.32, 0.5, 0.27], [0.42, 0.55, 0.29]],
  farm: [[0.5, 0.4, 0.28], [0.56, 0.44, 0.3]],
  paddy: [[0.42, 0.52, 0.3], [0.48, 0.57, 0.32]],
  berm: [[0.38, 0.56, 0.3], [0.46, 0.6, 0.33]],
};

/** Grass palette key for a point on the valley floor or a terrace top. */
export function grassKey(sl, reg) {
  if (reg.kind === 'berm') return 'berm';
  if (reg.kind === 'terrace') {
    const side = reg.side;
    if (side.tw < 0.6) return side.use === 'forest' ? 'forest' : 'meadow';
    return side.use;
  }
  if (sl.z.core > 0.5) {
    const b = sl.z.biome.key;
    return b === 'forest' ? 'forest' : b === 'meadow' ? 'meadow' : 'lawn';
  }
  return 'lawn';
}

/** sRGB grass colour at (s, u), matching the terrain's vertex colours. */
export function grassColor(s, u, key, out = [0, 0, 0]) {
  const g = GRASS[key] || GRASS.lawn;
  const n1 = noise2(s, u, 9, 501);
  const n2 = noise2(s, u, 42, 502);
  const tint = clamp(0.5 + 0.5 * n2 + 0.25 * n1, 0, 1);
  out[0] = lerp(g[0][0], g[1][0], tint);
  out[1] = lerp(g[0][1], g[1][1], tint);
  out[2] = lerp(g[0][2], g[1][2], tint);
  return out;
}

const WALL_COL = { town: [0.86, 0.81, 0.71], res: [0.83, 0.77, 0.65], garden: [0.8, 0.75, 0.63], farm: [0.75, 0.68, 0.56], paddy: [0.62, 0.6, 0.56], orchard: [0.78, 0.72, 0.6], meadow: [0.78, 0.72, 0.6], forest: [0.66, 0.64, 0.58] };
const SAND = [0.89, 0.82, 0.62];
const MUD = [0.52, 0.46, 0.34];

const _reg = {};
const _path = { d: 99, pave: 0 };

export function* buildTerrainGen(i, lights) {
  const s0 = i * SECTOR_LEN;
  const rows = ROWS_PER_SECTOR + 1;
  const r0 = i * ROWS_PER_SECTOR;
  // Column layout (duplicate vertices at creases)
  const colL = new Int32Array(NP);
  const colR = new Int32Array(NP);
  let nc = 0;
  for (let j = 0; j < NP; j++) {
    if (PROFILE[j].crease && j > 0 && j < NP - 1) {
      colL[j] = nc++;
      colR[j] = nc++;
    } else {
      colL[j] = nc;
      colR[j] = nc;
      nc++;
    }
  }
  const nv = rows * nc;
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const col = new Uint8Array(nv * 4);
  const surf0 = new Float32Array(nv * 4); // pathD, pave, lamp, ao
  const surf1 = new Uint8Array(nv * 4); // wall, farm, sand, paddy
  const suv = new Float32Array(nv * 2); // s, profile coordinate

  // world positions of all rows needed (one extra row either side for normals)
  const R0r = CIRC / (2 * Math.PI);
  const WP = [];
  for (let ri = -1; ri <= rows; ri++) {
    const R = getRow(r0 + ri);
    const th = ((r0 + ri) * ROW_DS) / R0r;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const arr = new Float64Array(NP * 3);
    for (let j = 0; j < NP; j++) {
      const r = R0r - R.H[j];
      arr[j * 3] = r * c;
      arr[j * 3 + 1] = r * sn;
      arr[j * 3 + 2] = R.U[j];
    }
    WP.push(arr);
  }
  const P = (row, j, out) => {
    const arr = WP[row - r0 + 1];
    out[0] = arr[j * 3];
    out[1] = arr[j * 3 + 1];
    out[2] = arr[j * 3 + 2];
    return out;
  };
  const a = [0, 0, 0];
  const b2 = [0, 0, 0];
  const tS = [0, 0, 0];
  const tP = [0, 0, 0];
  const segLen = (row, j0, j1) => {
    const arr = WP[row - r0 + 1];
    return Math.hypot(arr[j1 * 3] - arr[j0 * 3], arr[j1 * 3 + 1] - arr[j0 * 3 + 1], arr[j1 * 3 + 2] - arr[j0 * 3 + 2]);
  };

  for (let ri = 0; ri < rows; ri++) {
    if (ri > 0 && ri % 10 === 0) yield;
    const row = r0 + ri;
    const R = getRow(row);
    const sl = R.slice;
    const s = s0 + ri * ROW_DS;
    for (let j = 0; j < NP; j++) {
      const u = R.U[j];
      const h = R.H[j];
      // tangent along s
      P(row + 1, j, a);
      P(row - 1, j, b2);
      tS[0] = a[0] - b2[0];
      tS[1] = a[1] - b2[1];
      tS[2] = a[2] - b2[2];
      const copies = colL[j] === colR[j] ? [[colL[j], 0]] : [[colL[j], -1], [colR[j], 1]];
      for (const [cidx, which] of copies) {
        // profile tangent
        let ja = j - 1;
        let jb = j + 1;
        if (which === -1) jb = j;
        if (which === 1) ja = j;
        if (ja < 0) ja = 0;
        if (jb > NP - 1) jb = NP - 1;
        // skip degenerate segments
        while (segLen(row, ja, jb) < 1e-3 && (ja > 0 || jb < NP - 1)) {
          if (which <= 0 && ja > 0) ja--;
          else if (jb < NP - 1) jb++;
          else ja--;
        }
        P(row, jb, a);
        P(row, ja, b2);
        tP[0] = a[0] - b2[0];
        tP[1] = a[1] - b2[1];
        tP[2] = a[2] - b2[2];
        let nx = tP[1] * tS[2] - tP[2] * tS[1];
        let ny = tP[2] * tS[0] - tP[0] * tS[2];
        let nz = tP[0] * tS[1] - tP[1] * tS[0];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const vi = ri * nc + cidx;
        P(row, j, a);
        pos[vi * 3] = a[0];
        pos[vi * 3 + 1] = a[1];
        pos[vi * 3 + 2] = a[2];
        nrm[vi * 3] = nx;
        nrm[vi * 3 + 1] = ny;
        nrm[vi * 3 + 2] = nz;
        // segment type this vertex belongs to
        let seg;
        if (which === -1) seg = SEG_TYPE[j - 1];
        else if (which === 1) seg = SEG_TYPE[j];
        else seg = j < NP - 1 ? SEG_TYPE[j] : SEG_TYPE[j - 1];
        const segK = which === -1 ? SEG_TERRACE[j - 1] : j < NP - 1 ? SEG_TERRACE[j] : SEG_TERRACE[j - 1];
        const reg = regionAt(sl, u, _reg);
        const side = reg.side;
        const use = side.use;
        let c = [0.5, 0.7, 0.35];
        let pathD = 99;
        let pave = 0;
        let ao = 1;
        let wall = 0;
        let farm = 0;
        let sand = 0;
        let paddy = 0;
        const n1 = noise2(s, u, 9, 501);
        const n2 = noise2(s, u, 42, 502);
        const tint = clamp(0.5 + 0.5 * n2 + 0.25 * n1, 0, 1);
        if (seg === SEG.WALL) {
          const wc = WALL_COL[use] || WALL_COL.res;
          const k = 1 + 0.05 * n1;
          c = [wc[0] * k, wc[1] * k, wc[2] * k];
          wall = 1;
          ao = PROFILE[j].kind === 'wallBot' ? 0.72 : 1;
        } else if (seg === SEG.BED) {
          c = MUD;
          sand = 1;
        } else if (seg === SEG.BANK) {
          const canal = sl.river.canal;
          const lk = sl.z.lake;
          const g = GRASS[sl.z.core > 0.5 ? use : 'lawn'] || GRASS.lawn;
          const gc = [lerp(g[0][0], g[1][0], tint), lerp(g[0][1], g[1][1], tint), lerp(g[0][2], g[1][2], tint)];
          const sandy = PROFILE[j].kind === 'edge' ? 1 : 0.2 + lk * 0.8;
          c = canal > 0.5 ? WALL_COL.town : [lerp(gc[0], SAND[0], sandy), lerp(gc[1], SAND[1], sandy), lerp(gc[2], SAND[2], sandy)];
          wall = canal;
          sand = canal > 0.5 ? 0 : sandy;
        } else if (seg === SEG.BERM) {
          const g = GRASS.berm;
          c = [lerp(g[0][0], g[1][0], tint), lerp(g[0][1], g[1][1], tint), lerp(g[0][2], g[1][2], tint)];
        } else {
          // valley or terrace top
          const key = seg === SEG.TERRACE ? (side.tw < 0.6 ? (use === 'forest' ? 'forest' : 'meadow') : use) : sl.z.core > 0.5 ? (sl.z.biome.key === 'forest' ? 'forest' : sl.z.biome.key === 'meadow' ? 'meadow' : 'lawn') : 'lawn';
          c = grassColor(s, u, key);
          pathAt(s, u, sl, _path);
          pathD = _path.d;
          pave = _path.pave;
          if (seg === SEG.TERRACE && segK >= 0) {
            if (use === 'farm' && side.tw > 0.5) farm = 1;
            if (side.paddy > 0.5 && side.tw > 0.6) paddy = 1;
            const xBack = side.x[segK + 1];
            ao = 0.62 + 0.38 * smoothstep(0.0, 2.6, xBack - reg.x);
          } else if (seg === SEG.VALLEY) {
            ao = 0.62 + 0.38 * smoothstep(0.0, 2.6, side.x0 - reg.x);
            // sandy lake shores
            const lk = sl.z.lake;
            if (lk > 0.2) {
              const t = clamp(1 - (reg.x - side.bankTop) / 5, 0, 1) * lk;
              c = [lerp(c[0], SAND[0], t), lerp(c[1], SAND[1], t), lerp(c[2], SAND[2], t)];
              sand = t;
            }
          }
        }
        col[vi * 4] = Math.round(clamp(c[0], 0, 1) * 255);
        col[vi * 4 + 1] = Math.round(clamp(c[1], 0, 1) * 255);
        col[vi * 4 + 2] = Math.round(clamp(c[2], 0, 1) * 255);
        col[vi * 4 + 3] = 255;
        surf0[vi * 4] = clamp(pathD, -6, 6);
        surf0[vi * 4 + 1] = pave;
        surf0[vi * 4 + 2] = lampLight(lights, s, u, h);
        surf0[vi * 4 + 3] = ao;
        surf1[vi * 4] = Math.round(clamp(wall, 0, 1) * 255);
        surf1[vi * 4 + 1] = farm * 255;
        surf1[vi * 4 + 2] = Math.round(clamp(sand, 0, 1) * 255);
        surf1[vi * 4 + 3] = paddy * 255;
        suv[vi * 2] = s;
        suv[vi * 2 + 1] = seg === SEG.WALL || (seg === SEG.BANK && wall > 0.5) ? h : u;
      }
    }
  }
  // indices
  const quads = (rows - 1) * (NP - 1);
  const idx = new Uint32Array(quads * 6);
  let q = 0;
  for (let ri = 0; ri < rows - 1; ri++) {
    for (let j = 0; j < NP - 1; j++) {
      const A = ri * nc + colR[j];
      const B = ri * nc + colL[j + 1];
      const C = (ri + 1) * nc + colR[j];
      const D = (ri + 1) * nc + colL[j + 1];
      idx[q++] = A;
      idx[q++] = B;
      idx[q++] = C;
      idx[q++] = B;
      idx[q++] = D;
      idx[q++] = C;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
  g.setAttribute('surf0', new THREE.BufferAttribute(surf0, 4));
  g.setAttribute('surf1', new THREE.BufferAttribute(surf1, 4, true));
  g.setAttribute('suv', new THREE.BufferAttribute(suv, 2));
  g.setIndex(new THREE.BufferAttribute(nv > 65535 ? idx : Uint16Array.from(idx), 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Water: river / lake surface, paddy fields, fountain pools.

export function buildWater(i, cells) {
  const s0 = i * SECTOR_LEN;
  const rows = ROWS_PER_SECTOR + 1;
  const P = [];
  const N = [];
  const W = [];
  const I = [];
  const R0 = CIRC / (2 * Math.PI);
  const push = (s, u, h, shore, along, across, kind) => {
    const th = s / R0;
    const r = R0 - h;
    P.push(r * Math.cos(th), r * Math.sin(th), u);
    N.push(-Math.cos(th), -Math.sin(th), 0);
    W.push(shore, along, across, kind);
    return P.length / 3 - 1;
  };
  // river strip
  const cols = 12;
  const base = P.length / 3;
  for (let ri = 0; ri < rows; ri++) {
    const R = getRow(i * ROWS_PER_SECTOR + ri);
    const sl = R.slice;
    const s = s0 + ri * ROW_DS;
    const c = sl.river.c;
    const hw = sl.river.hw;
    const ext = sl.river.canal > 0.5 ? 0.3 : 1.6;
    for (let k = 0; k <= cols; k++) {
      const t = k / cols;
      const u = c - hw - ext + (2 * (hw + ext)) * t;
      push(s, u, WATER_H, hw - Math.abs(u - c), s, u - c, 0);
    }
  }
  for (let ri = 0; ri < rows - 1; ri++) {
    for (let k = 0; k < cols; k++) {
      const a = base + ri * (cols + 1) + k;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      I.push(a, b, c, b, d, c);
    }
  }
  // paddies
  for (const si of [0, 1]) {
    for (let k = 0; k < TERRACES; k++) {
      let prev = null;
      for (let ri = 0; ri < rows; ri++) {
        const R = getRow(i * ROWS_PER_SECTOR + ri);
        const sl = R.slice;
        const side = sl.sides[si];
        const s = s0 + ri * ROW_DS;
        const on = side.paddy > 0.5 && side.tw > 0.6;
        if (!on) {
          prev = null;
          continue;
        }
        const sg = side.sigma;
        const xa = side.x[k] + 2.35;
        const xb = side.x[k + 1] - 0.3;
        const hwat = side.L[k + 1] - 0.28 * side.paddy + 0.14;
        const ids = [];
        const nCols = 4;
        for (let q = 0; q <= nCols; q++) {
          const x = xa + ((xb - xa) * q) / nCols;
          ids.push(push(s, sg * x, hwat, Math.min(x - xa, xb - x), s, x - xa, 1));
        }
        if (prev) {
          for (let q = 0; q < nCols; q++) {
            const a = prev[q];
            const b = prev[q + 1];
            const c = ids[q];
            const d = ids[q + 1];
            if (sg > 0) I.push(a, b, c, b, d, c);
            else I.push(a, c, b, b, c, d);
          }
        }
        prev = ids;
      }
    }
  }
  // fountain pools
  for (const cell of cells) {
    for (const p of cell.props) {
      if (p.kind !== 'fountain') continue;
      const segs = 24;
      const center = push(p.s, p.u, p.h + 0.55, 3, 0, 0, 2);
      const ring = [];
      for (let q = 0; q < segs; q++) {
        const a = (q / segs) * Math.PI * 2;
        const ds = Math.sin(a) * 3.0;
        const du = Math.cos(a) * 3.0;
        ring.push(push(p.s + ds, p.u + du, p.h + 0.55, 0, ds, du, 2));
      }
      for (let q = 0; q < segs; q++) I.push(center, ring[q], ring[(q + 1) % segs]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('wat', new THREE.Float32BufferAttribute(W, 4));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Vegetation scatter

function speciesFor(R, sl, reg) {
  const b = sl.z.biome.key;
  const core = sl.z.core > 0.5;
  const nearBank = reg.kind === 'valley' && reg.x - reg.side.bankTop < 5;
  if (core && (b === 'lake' || b === 'lake2') && nearBank && sl.z.lake > 0.2) return R() < 0.7 ? 'willow' : 'birch';
  if (reg.kind === 'berm') return R() < 0.7 ? 'bush' : 'hedgeBush';
  const use = reg.side.use;
  if (core && (b === 'forest' || use === 'forest')) return R.weighted([['conifer', 0.45], ['round', 0.22], ['birch', 0.15], ['bush', 0.1], ['autumn', 0.08]]);
  if (core && b === 'paddy') return R.weighted([['cherry', 0.35], ['round', 0.15], ['bush', 0.4], ['cypress', 0.1]]);
  if (core && b === 'meadow') return R.weighted([['round', 0.35], ['fruit', 0.2], ['bush', 0.35], ['birch', 0.1]]);
  if (core && b === 'farm') return R.weighted([['round', 0.4], ['bush', 0.4], ['cypress', 0.2]]);
  if (use === 'garden') return R.weighted([['fruit', 0.3], ['bush', 0.35], ['cypress', 0.15], ['cherry', 0.2]]);
  return R.weighted([['round', 0.42], ['cypress', 0.14], ['birch', 0.12], ['bush', 0.24], ['autumn', 0.04], ['cherry', 0.04]]);
}

function densityFor(sl, reg) {
  const z = sl.z;
  const b = z.biome.key;
  const core = z.core > 0.5;
  const use = reg.side.use;
  if (reg.kind === 'valley') {
    if (z.town > 0.5) return 0.0;
    if (!core) return 0.16;
    if (b === 'forest') return 0.55;
    if (b === 'lake' || b === 'lake2') return 0.3;
    if (b === 'farm') return 0.04;
    if (b === 'paddy') return 0.12;
    return 0.1;
  }
  if (reg.kind === 'terrace') {
    if (reg.side.tw < 0.6) return use === 'forest' ? 0.6 : 0.2;
    if (use === 'garden') return 0.26;
    if (use === 'res') return 0.08;
    if (use === 'town') return 0.03;
    return 0;
  }
  if (reg.kind === 'berm') return 0.25;
  return 0;
}

export function* scatterTreesGen(i) {
  const s0 = i * SECTOR_LEN;
  const trees = [];
  const cellsz = 3.4;
  const ns = Math.round(SECTOR_LEN / cellsz);
  const du = 3.4;
  const reg = {};
  for (let a = 0; a < ns; a++) {
    if (a > 0 && a % 4 === 0) yield;
    for (let bu = Math.floor(-66 / du); bu <= Math.ceil(66 / du); bu++) {
      const hsd = hash(i, a, bu, 77);
      const jx = ((hsd & 1023) / 1023 - 0.5) * cellsz * 0.9;
      const jy = (((hsd >>> 10) & 1023) / 1023 - 0.5) * du * 0.9;
      const s = s0 + (a + 0.5) * (SECTOR_LEN / ns) + jx;
      const u = bu * du + jy;
      const sl = sliceAt(s);
      regionAt(sl, u, reg);
      const dens = densityFor(sl, reg);
      if (dens <= 0) continue;
      if (((hsd >>> 20) & 1023) / 1023 > dens) continue;
      if (reg.kind === 'terrace') {
        const side = reg.side;
        if (reg.x - side.x[reg.k] < 1.2 || side.x[reg.k + 1] - reg.x < 1.3) continue;
      }
      if (reg.kind === 'valley' && (reg.x - reg.side.bankTop < 1.0 || reg.side.x0 - reg.x < 1.3)) continue;
      if (reg.kind === 'berm' && reg.x > reg.side.xEnd + 1.5) continue;
      pathAt(s, u, sl, _path);
      if (_path.d < 1.3) continue;
      if (occupied(s, u, 0.9)) continue;
      const R = rng(hsd);
      const species = speciesFor(R, sl, reg);
      trees.push({ s, u, h: groundHeight(s, u), species, scale: R.range(0.8, 1.2), seed: R() });
    }
  }
  // explicit trees from the plans
  for (const cell of sectorCells(i)) {
    for (const t of cell.trees) trees.push({ ...t, h: groundHeight(t.s, t.u) });
  }
  return trees;
}

function scatterFlowers(b, i) {
  const s0 = i * SECTOR_LEN;
  const reg = {};
  const cellsz = 2.2;
  const ns = Math.round(SECTOR_LEN / cellsz);
  for (let a = 0; a < ns; a++) {
    for (let bu = -30; bu <= 30; bu++) {
      const hsd = hash(i, a, bu, 991);
      const s = s0 + (a + 0.5) * (SECTOR_LEN / ns) + ((hsd & 255) / 255 - 0.5) * 2;
      const u = bu * 2.2 + (((hsd >>> 8) & 255) / 255 - 0.5) * 2;
      const sl = sliceAt(s);
      regionAt(sl, u, reg);
      if (reg.kind !== 'valley' && reg.kind !== 'terrace') continue;
      const b0 = sl.z.biome.key;
      const core = sl.z.core > 0.5;
      let dens = 0.05;
      if (core && b0 === 'meadow') dens = 0.55;
      else if (core && (b0 === 'lake' || b0 === 'lake2')) dens = 0.14;
      else if (reg.side.use === 'garden') dens = 0.2;
      else if (sl.z.town > 0.5) dens = 0;
      else if (core && b0 === 'farm') dens = 0.04;
      if (reg.kind === 'terrace' && reg.side.tw > 0.6 && (reg.side.use === 'farm' || reg.side.paddy > 0.5)) dens = 0;
      if (((hsd >>> 16) & 1023) / 1023 > dens) continue;
      pathAt(s, u, sl, _path);
      if (_path.d < 0.5) continue;
      if (occupied(s, u, 0.3)) continue;
      const R = rng(hsd);
      const h = groundHeight(s, u);
      b.placeMatrix(placementMatrix(s, u, h, R() * 6.28));
      b.identity().reset();
      const fc = R.pick(PAL.FLOWERS);
      const n = R.int(3, 6);
      for (let k = 0; k < n; k++) {
        const x = R.range(-0.4, 0.4);
        const z = R.range(-0.4, 0.4);
        b.color(R.pick(PAL.FOLIAGE)).pattern(PAT.LEAF, R()).sway(0.3);
        b.sphere(x, 0.12, z, 0.14, 0.1, 0.14, 0);
        b.reset().color(fc).sway(0.45);
        b.sphere(x, 0.32 + R() * 0.12, z, 0.085, 0.06, 0.085, 0);
      }
    }
  }
  b.reset();
}

/** High-detail foliage built a few trees at a time. */
export function* buildFoliageGen(trees, i, lod = true) {
  const b = new MeshBuilder();
  let n = 0;
  for (const t of trees) {
    buildTree(b, t, lod);
    if (++n % (lod ? 12 : 40) === 0) yield;
  }
  if (lod) {
    scatterFlowers(b, i);
    yield;
  }
  return b.empty ? null : b.toGeometry();
}

export function buildFoliage(trees, lod, i = null) {
  const b = new MeshBuilder();
  for (const t of trees) buildTree(b, t, lod);
  if (i !== null && lod) scatterFlowers(b, i);
  return b.empty ? null : b.toGeometry();
}

// ---------------------------------------------------------------------------
// Edges (railings etc.) along terrace fronts and canal quays

function buildEdges(b, i, cells) {
  const s0 = i * SECTOR_LEN;
  const rows = ROWS_PER_SECTOR;
  const stairs = [];
  const bridges = [];
  for (const c of neighbourCells(i, 2)) {
    stairs.push(...c.stairs);
    bridges.push(...c.bridges);
  }
  for (const si of [0, 1]) {
    for (let k = 0; k < TERRACES; k++) {
      let run = [];
      let style = null;
      const flush = () => {
        if (run.length >= 2 && style) buildEdge(b, run, style, si === 0 ? -1 : 1);
        run = [];
      };
      for (let ri = 0; ri <= rows; ri += 2) {
        const s = s0 + ri * ROW_DS;
        const R = getRow(i * ROWS_PER_SECTOR + ri);
        const side = R.slice.sides[si];
        const st = side.tw > 0.62 ? edgeStyle(side.use) : null;
        // gap where a stair arrives on this terrace
        let gap = false;
        for (const f of stairs) {
          if (f.si !== si || f.level !== k - 1) continue;
          const d = deltaS(f.sHigh, s) * f.dir;
          if (d > -2.6 && d < 0.8) gap = true;
          // stairs of this level sit below; keep edge
        }
        if (!st || gap || (style && st !== style)) {
          flush();
          style = st;
          if (!st || gap) continue;
        }
        style = st;
        run.push({ s, u: side.sigma * (side.x[k] + 0.22), h: side.L[k + 1] });
      }
      flush();
    }
    // canal quay railings in town
    let run = [];
    const flushQ = () => {
      if (run.length >= 2) buildEdge(b, run, 'rail', 0);
      run = [];
    };
    for (let ri = 0; ri <= rows; ri++) {
      const s = s0 + ri * ROW_DS;
      const R = getRow(i * ROWS_PER_SECTOR + ri);
      const sl = R.slice;
      const side = sl.sides[si];
      let gap = sl.river.canal < 0.6;
      for (const br of bridges) if (Math.abs(deltaS(br.s, s)) < br.width / 2 + 0.3) gap = true;
      if (gap) {
        flushQ();
        continue;
      }
      run.push({ s, u: side.sigma * (side.bankTop + 0.25), h: sl.river.bankH });
    }
    flushQ();
  }
}

// ---------------------------------------------------------------------------
// Sector generation

export function* generateSector(i) {
  const s0 = i * SECTOR_LEN;
  const s1 = s0 + SECTOR_LEN;
  const cells = sectorCells(i);
  const lights = lightsNear(i);
  yield;
  const terrain = yield* buildTerrainGen(i, lights);
  yield;
  const water = buildWater(i, cells);
  yield;

  const colliders = [];
  const props = new MeshBuilder();
  const fountains = [];
  const lampsOut = [];
  for (const c of cells) {
    yield;
    for (const h of c.houses) {
      const top = buildHouse(props, h);
      const sg = h.si === 0 ? -1 : 1;
      colliders.push({ t: 'box', s: (h.sA + h.sB) / 2, u: (sg * (h.xF + h.xB)) / 2, hs: (h.sB - h.sA) / 2 + 0.1, hu: (h.xB - h.xF) / 2 + 0.1, bottom: h.base - 1, top: h.base + top });
    }
    for (const m of c.midrises) {
      const top = buildMidrise(props, m);
      const sg = m.si === 0 ? -1 : 1;
      colliders.push({ t: 'box', s: (m.sA + m.sB) / 2, u: (sg * (m.xF + m.xB)) / 2, hs: (m.sB - m.sA) / 2 + 0.1, hu: (m.xB - m.xF) / 2 + 0.1, bottom: m.base - 1, top: m.base + top });
    }
    for (const st of c.stairs) {
      buildStair(props, st);
      const sg = st.si === 0 ? -1 : 1;
      const uA = sg * st.xIn;
      const uB = sg * (st.xWall + 0.05);
      colliders.push({ t: 'ramp', sLow: st.sLow, sHigh: st.sHigh, uMin: Math.min(uA, uB), uMax: Math.max(uA, uB), hLow: st.hLow, hHigh: st.hHigh });
    }
    for (const br of c.bridges) {
      buildBridge(props, br);
      colliders.push({ t: 'deck', s: br.s, hw: br.width / 2, uA: br.uA, uB: br.uB, hA: br.hA, hB: br.hB, rise: br.rise, c: br.c });
    }
    for (const l of c.lamps) {
      props.placeMatrix(placementMatrix(l.s, l.u, l.h, hashf(Math.round(l.s * 10)) * 6.28));
      props.identity().reset();
      buildLamp(props, l.kind, rng(hash(Math.round(l.s * 100))));
      colliders.push({ t: 'circle', s: l.s, u: l.u, r: 0.2, bottom: l.h - 1, top: l.h + 4 });
      lampsOut.push(l);
    }
    for (const p of c.props) {
      if (p.kind === 'spokeTower') {
        buildSpokeTower(props, p.s, p.u);
        colliders.push({ t: 'circle', s: p.s, u: p.u, r: 9.7, bottom: -5, top: 200 });
        continue;
      }
      buildProp(props, p);
      if (p.col) {
        if (p.col.r) colliders.push({ t: 'circle', s: p.s, u: p.u, r: p.col.r, bottom: p.h - 1, top: p.h + p.col.top });
        else colliders.push({ t: 'box', s: p.s, u: p.u, hs: p.col.hs, hu: p.col.hu, bottom: p.h - 1, top: p.h + p.col.top, yaw: p.yaw || 0 });
      }
      if (p.kind === 'fountain') fountains.push({ s: p.s, u: p.u, h: p.h });
      if (p.kind === 'jetty') {
        const sg = p.u > 0 ? 1 : -1;
        colliders.push({ t: 'deck', s: p.s, hw: 0.8, uA: p.u - sg * 0.5, uB: p.u - sg * (p.len || 6), hA: 0.45, hB: 0.45, rise: 0, c: 0, flat: true });
      }
    }
  }
  yield;
  buildEdges(props, i, cells);
  // rail station near each spoke
  for (let k = 0; k < SPOKES; k++) {
    const ss = wrapS(k * SPOKE_SPACING + 30);
    if (ss >= s0 && ss < s1) {
      railStation(props, ss, groundHeight(ss - 5, RAIL_U + 5.8));
      colliders.push({ t: 'box', s: ss - 5, u: RAIL_U + 5.8, hs: 1.3, hu: 1.3, bottom: -10, top: 60 });
    }
  }
  yield;

  const shell = new MeshBuilder();
  let spokeS = null;
  for (let k = 0; k < SPOKES; k++) {
    const ss = k * SPOKE_SPACING;
    if (Math.abs(deltaS(s0 + SECTOR_LEN / 2, ss)) < SECTOR_LEN) spokeS = ss;
  }
  buildShell(shell, s0, s1, spokeS);
  buildRail(shell, s0, s1);
  yield;

  const trees = yield* scatterTreesGen(i);
  for (const t of trees) {
    if (t.species !== 'bush' && t.species !== 'hedgeBush') colliders.push({ t: 'circle', s: t.s, u: t.u, r: 0.35, bottom: t.h - 1, top: t.h + 6 });
  }
  yield;
  const foliageLow = yield* buildFoliageGen(trees, i, false);
  yield;

  return {
    i, s0, s1,
    terrain,
    water,
    props: props.empty ? null : props.toGeometry(),
    shell: shell.toGeometry(),
    foliageLow,
    trees,
    colliders,
    fountains,
    lamps: lampsOut,
  };
}

export { smoothstep, promenade, CELL_LEN, hashf };
