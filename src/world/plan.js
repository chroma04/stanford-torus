// Per-cell feature planning: houses, stairs, lamps, bridges, props and paths.
// Each 11.52 m cell of the ring is planned independently (and memoised), from
// deterministic hashes of its index, so neighbouring sectors can consult each
// other's plans without generating geometry.

import { CELL_LEN, TOTAL_CELLS, TERRACES, SPOKE_SPACING, SPOKES, CIRC } from '../core/config.js';
import { hash, hashf, rng, wrapS, deltaS, clamp, noiseS, smoothstep, lerp } from '../core/math.js';
import { sliceAt, groundHeight, regionAt, townRiverSide } from './layout.js';

const cache = new Map();

export const cellOfS = (s) => Math.floor(wrapS(s) / CELL_LEN) % TOTAL_CELLS;
export const cellIndex = (c) => ((c % TOTAL_CELLS) + TOTAL_CELLS) % TOTAL_CELLS;

/** Where the riverside promenade runs on a side (distance from centre plane). */
export function promenade(sl, side) {
  const town = sl.z.town;
  const wig = sl.z.core * 2.0 * noiseS(sl.s, 70, 90 + side.si);
  return {
    x: side.bankTop + 2.3 + town * 0.8 + Math.max(0, wig),
    hw: 1.45 + town * 0.9,
  };
}

/** Front walkway along terrace k. */
export function walkway(sl, side, k) {
  const wig = (1 - side.tw) * 2.2 * noiseS(sl.s, 45, 120 + k + side.si * 5);
  return { x: side.x[k] + 1.25 + Math.max(-0.6, wig), hw: side.tw > 0.5 ? 0.95 + sl.z.town * 0.25 : 0.7 };
}

function paveStyle(sl, use) {
  if (use === 'town' || use === 'res' || use === 'garden') return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Town (spoke) plans

const townCache = new Map();

export function townPlan(k) {
  if (townCache.has(k)) return townCache.get(k);
  const s0 = k * SPOKE_SPACING;
  const side = townRiverSide(k); // river side; plaza extends to the other side
  const R = rng(hash(777, k));
  const feats = [];
  feats.push({ kind: 'spokeTower', s: s0, u: 0, r: 10.6, col: { r: 10.4, top: 12 } });
  // Fountains in the plaza
  for (const d of [-42, 42]) {
    feats.push({ kind: 'fountain', s: s0 + d, u: -side * 11, r: 4.2, seed: R(), col: { r: 3.7, top: 0.85 } });
  }
  // Market stalls
  for (const dir of [-1, 1]) {
    const n = 3 + R.int(0, 2);
    for (let i = 0; i < n; i++) {
      const ds = dir * (14 + i * 5.2);
      feats.push({ kind: 'stall', s: s0 + ds, u: -side * (17.5 + (i % 2) * 0.6), yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, seed: R(), r: 2.2, col: { hs: 0.8, hu: 1.25, top: 2.6 } });
    }
  }
  // Benches in a ring around the tower
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    if (Math.abs(Math.sin(a)) > 0.92) continue; // leave the entrances free
    feats.push({ kind: 'bench', s: s0 + Math.sin(a) * 14.5, u: Math.cos(a) * 14.5, yaw: -a + Math.PI, seed: R(), r: 1.0 });
  }
  // Planter trees lining the plaza
  for (let d = -55; d <= 55; d += 11) {
    if (Math.abs(d) < 8) continue;
    feats.push({ kind: 'planterTree', s: s0 + d, u: -side * 23.5, seed: R(), r: 1.4, col: { r: 1.2, top: 0.7 } });
  }
  // Cafe tables near the canal
  for (let i = 0; i < 5; i++) {
    const ds = R.range(-50, 50);
    if (Math.abs(ds) < 16 || Math.abs(Math.abs(ds) - 26) < 3) continue;
    feats.push({ kind: 'parasol', s: s0 + ds, u: side * 12.2, seed: R(), r: 1.6 });
  }
  // Park lawns beyond the plaza: tree avenues, flowerbeds and benches
  for (const dir of [-1, 1]) {
    for (let d = 70; d <= 112; d += 10.5) {
      feats.push({ kind: 'planterTree', s: s0 + dir * d, u: -side * 13, seed: R(), r: 1.4, col: { r: 1.2, top: 0.7 } });
      if (R() < 0.6) feats.push({ kind: 'flowerbed', s: s0 + dir * (d + 5), u: -side * 8.5, yaw: 0, seed: R(), r: 1.8 });
      else feats.push({ kind: 'bench', s: s0 + dir * (d + 5), u: -side * 9.5, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, seed: R(), r: 1.0 });
    }
  }
  // A sculpture
  feats.push({ kind: 'sculpture', s: s0 + (R() < 0.5 ? -1 : 1) * 30, u: -side * 5, seed: R(), r: 2.0, col: { r: 1.4, top: 5 } });
  const plan = { k, s0, side, feats };
  townCache.set(k, plan);
  return plan;
}

// ---------------------------------------------------------------------------
// Cell plans

function stairOffset(level, si) {
  return hash(31, level + 5, si) % 5;
}

export function planCell(cIn) {
  const c = cellIndex(cIn);
  if (cache.has(c)) return cache.get(c);
  const s0 = c * CELL_LEN;
  const s1 = s0 + CELL_LEN;
  const sc = s0 + CELL_LEN / 2;
  const sl = sliceAt(sc);
  const z = sl.z;
  const R = rng(hash(4242, c));
  const plan = {
    c, s0, s1, sc,
    houses: [], stairs: [], lamps: [], bridges: [], props: [], trees: [], paths: [], midrises: [],
    use: [sl.sides[0].use, sl.sides[1].use],
  };
  cache.set(c, plan);

  const town = z.town > 0.5;
  const dSpoke = z.dSpoke;

  // --- Bridges -------------------------------------------------------------
  const river = sl.river;
  let bridge = null;
  if (town) {
    for (const d of [-26, 26]) {
      const sb = z.spoke * SPOKE_SPACING + d;
      if (Math.abs(deltaS(sc, sb)) < CELL_LEN / 2) bridge = { s: wrapS(sb), style: 'town' };
    }
  } else if (z.town < 0.1 && river.hw < 8.5) {
    if (z.core < 0.5 && c % 8 === 3) bridge = { s: sc, style: 'stone' };
    else if (z.core >= 0.5 && c % 11 === 6) bridge = { s: sc, style: 'wood' };
  }
  if (bridge) {
    const bs = sliceAt(bridge.s);
    const r = bs.river;
    const L = bs.sides[0];
    const Rr = bs.sides[1];
    const uA = -L.bankTop + (r.canal > 0.5 ? 0 : 0.6);
    const uB = Rr.bankTop - (r.canal > 0.5 ? 0 : 0.6);
    const width = bridge.style === 'town' ? 3.4 : bridge.style === 'wood' ? 2.0 : 2.6;
    const hA = groundHeight(bridge.s, uA);
    const hB = groundHeight(bridge.s, uB);
    const rise = 0.9 + 0.12 * r.hw;
    Object.assign(bridge, { uA, uB, hA, hB, width, rise, c: r.c });
    plan.bridges.push(bridge);
    // Cross paths from each bridge end across the valley to the terrace wall.
    for (const si of [0, 1]) {
      const side = bs.sides[si];
      plan.paths.push({
        sA: bridge.s, uA: side.sigma * side.bankTop, sB: bridge.s, uB: side.sigma * (side.x0 - 0.3),
        hw: width / 2 + 0.2, pave: paveStyle(bs, side.use),
      });
    }
    // Lamps at the bridge ends
    for (const [u, sg] of [[uA, -1], [uB, 1]]) {
      plan.lamps.push({ s: bridge.s - (width / 2 + 0.5), u: u + sg * 0.8, h: groundHeight(bridge.s, u + sg * 0.8), kind: 'post' });
    }
  }

  // --- Per side ------------------------------------------------------------
  for (const si of [0, 1]) {
    const side = sl.sides[si];
    const sg = side.sigma;
    const use = side.use;
    const prom = promenade(sl, side);
    const stairLevels = new Set();

    // Stairs between levels (-1 = valley → terrace 0)
    if (side.tw > 0.6) {
      for (let level = -1; level < TERRACES - 1; level++) {
        if ((c + stairOffset(level, si)) % 5 !== 0) continue;
        if (bridge && level === -1) continue;
        const xWall = side.x[level + 1];
        const hLow = side.L[level + 1];
        const hHigh = side.L[level + 2];
        const rise = hHigh - hLow;
        const run = clamp(rise * 1.55, 6, CELL_LEN - 1.6);
        const dir = hash(c, level, si, 9) & 1 ? 1 : -1;
        const sLow = sc - (dir * run) / 2;
        const sHigh = sc + (dir * run) / 2;
        plan.stairs.push({ si, level, sLow, sHigh, dir, xIn: xWall - 1.95, xOut: xWall + 0.25, xWall, hLow, hHigh, width: 1.8 });
        stairLevels.add(level);
        // Approach path from the lower walkway to the bottom of the flight.
        const xWalk = level === -1 ? prom.x : walkway(sl, side, level).x;
        const sApp = sLow - dir * 1.1;
        plan.paths.push({ sA: sApp, uA: sg * xWalk, sB: sApp, uB: sg * (xWall - 0.9), hw: 1.0, pave: paveStyle(sl, use) });
        plan.paths.push({ sA: sApp, uA: sg * (xWall - 0.9), sB: sLow + dir * 0.5, uB: sg * (xWall - 0.9), hw: 1.0, pave: paveStyle(sl, use) });
      }
    }

    // Terrace contents
    for (let k = 0; k < TERRACES; k++) {
      const xF = side.x[k];
      const xBk = side.x[k + 1];
      const width = xBk - xF;
      const level = side.L[k + 1];
      const hasStair = stairLevels.has(k);
      const lampy = (use === 'town' || use === 'res' || use === 'garden') && side.tw > 0.6;
      if (lampy && c % 2 === (k + si) % 2) {
        plan.lamps.push({ s: s0 + 2.5, u: sg * (xF + 0.4), h: level, kind: 'post' });
      }
      if (use === 'paddy' && c % 2 === 0 && side.tw > 0.6) {
        plan.props.push({ kind: 'lantern', s: s0 + 3.5, u: sg * (xF + 0.45), h: level, yaw: 0, seed: R(), r: 0.5, col: { r: 0.35, top: 1.4 } });
      }
      if (side.tw < 0.8) continue;

      // keep the top terrace clear below the monorail station
      const nearStation = si === 0 && k === TERRACES - 1 && Math.abs(deltaS(z.spoke * SPOKE_SPACING + 30, sc)) < 22;
      if (use === 'town' || use === 'res' || use === 'garden') {
        if (hasStair || nearStation) {
          // a bench and flowers by the stair foot
          continue;
        }
        const depth = Math.min(width - 3.3, use === 'town' ? 8 : 7.2);
        if (depth < 3.6) continue;
        const pHouse = use === 'garden' ? 0.35 : 0.84;
        if (R() < pHouse) {
          const pair = R() < 0.3;
          const gapA = R.range(0.8, 2.2);
          const gapB = R.range(0.8, 2.2);
          const total = CELL_LEN - gapA - gapB;
          const widths = pair ? [total / 2 - 0.5, total / 2 - 0.5] : [total];
          let sCur = s0 + gapA;
          for (const w of widths) {
            // Back of the house hugs the wall behind (take the maximum wall position over the footprint).
            let xWallMax = xBk;
            for (const t of [0, 0.5, 1]) {
              const ss = sliceAt(sCur + w * t);
              xWallMax = Math.max(xWallMax, ss.sides[si].x[k + 1]);
            }
            const floors = use === 'town' ? R.int(2, 3) : R.weighted([[1, 0.45], [2, 0.55]]);
            plan.houses.push({
              si, k, sA: sCur, sB: sCur + w, xF: xWallMax + 0.3 - depth, xB: xWallMax + 0.3,
              base: level, floors, seed: hash(c, si, k, Math.round(sCur * 10)), town: use === 'town',
            });
            sCur += w + 1.0;
          }
        } else {
          // Garden plot: flowerbeds, a bench, a small tree
          const x = xF + width * 0.6;
          plan.props.push({ kind: 'flowerbed', s: sc + R.range(-3, 3), u: sg * x, h: level, yaw: 0, seed: R(), r: 1.8 });
          plan.props.push({ kind: 'bench', s: sc + R.range(-4, 4), u: sg * (xF + 2.6), h: level, yaw: sg > 0 ? -Math.PI / 2 : Math.PI / 2, seed: R(), r: 1.0 });
          if (R() < 0.7) plan.trees.push({ s: sc + R.range(-4, 4), u: sg * (xBk - 1.8), species: R() < 0.5 ? 'fruit' : 'round', scale: R.range(0.6, 0.85), seed: R() });
        }
      } else if (use === 'farm') {
        if (!hasStair && R() < 0.22 && width > 7) {
          plan.props.push({ kind: 'greenhouse', s: sc, u: sg * (xF + width * 0.62), h: level, yaw: 0, seed: R(), r: 4.5, len: CELL_LEN - 2.5, wid: Math.min(width - 3.2, 6), col: { hs: (CELL_LEN - 2.5) / 2, hu: Math.min(width - 3.2, 6) / 2, top: 3.2 } });
        } else if (!hasStair && R() < 0.12) {
          plan.props.push({ kind: 'shed', s: sc, u: sg * (xBk - 2.4), h: level, yaw: 0, seed: R(), r: 2.6, col: { hs: 1.4, hu: 1.8, top: 3 } });
        }
      } else if (use === 'orchard') {
        for (let i = 0; i < 3; i++) {
          for (const f of [0.45, 0.8]) {
            plan.trees.push({ s: s0 + 2 + i * 3.8, u: sg * (xF + width * f), species: 'fruit', scale: R.range(0.75, 0.95), seed: R() });
          }
        }
      }
    }

    // Promenade lamps
    const promLit = use !== 'farm' || z.core < 0.5 || true;
    if (promLit && !(town && Math.abs(dSpoke) < 60)) {
      const lu = sg * (prom.x + prom.hw + 0.45);
      plan.lamps.push({ s: s0 + 8.2, u: lu, h: groundHeight(s0 + 8.2, lu), kind: z.core > 0.5 ? 'short' : 'post' });
    }

    // Valley strip features between the promenade and terrace wall
    const xa = prom.x + prom.hw + 1.4;
    const xb = side.x0 - (stairLevels.has(-1) ? 3.0 : 1.2);
    const room = xb - xa;
    if (town) {
      // Mid-rise buildings on the plaza side, away from the centre.
      const plazaSide = -townRiverSide(z.spoke);
      if (sg === plazaSide && Math.abs(dSpoke) > 50 && Math.abs(dSpoke) < 118 && !stairLevels.has(-1)) {
        const depth = 8.5;
        const x1 = side.x0 + 0.3;
        plan.midrises.push({ si, sA: s0 + 0.8, sB: s1 - 0.8, xF: x1 - depth, xB: x1, base: groundHeight(sc, sg * (x1 - depth)), floors: R.int(3, 5), seed: hash(c, 99, si) });
      }
      continue;
    }
    if (room < 2.5) continue;
    const xm = (xa + xb) / 2;
    const um = sg * xm;
    const yawFace = sg > 0 ? Math.PI / 2 : -Math.PI / 2; // face towards the river
    const biome = z.biome.key;
    const core = z.core > 0.5;
    let choice;
    if (!core) {
      choice = R.weighted([
        ['kiosk', 0.07], ['cafe', 0.09], ['pavilion', 0.06], ['playground', 0.07], ['benches', 0.26],
        ['sculpture', 0.04], ['plots', 0.08], ['none', 0.33],
      ]);
    } else if (biome === 'lake' || biome === 'lake2') {
      choice = z.lake > 0.3
        ? R.weighted([['boathouse', 0.09], ['benches', 0.25], ['pavilion', 0.08], ['picnic', 0.16], ['none', 0.42]])
        : R.weighted([['benches', 0.25], ['picnic', 0.15], ['none', 0.6]]);
    } else if (biome === 'farm') {
      choice = R.weighted([['barn', 0.12], ['hay', 0.2], ['orchard', 0.42], ['none', 0.26]]);
    } else if (biome === 'forest') {
      choice = R.weighted([['rocks', 0.3], ['benches', 0.1], ['lookout', 0.04], ['none', 0.56]]);
    } else if (biome === 'paddy') {
      choice = R.weighted([['bamboo', 0.3], ['teahouse', 0.07], ['lanterns', 0.2], ['cherry', 0.25], ['none', 0.18]]);
    } else {
      choice = R.weighted([['beehives', 0.12], ['picnic', 0.16], ['gazebo', 0.06], ['meadow', 0.4], ['none', 0.26]]);
    }
    if (!core && ['none', 'benches', 'plots', 'sculpture', 'playground'].includes(choice)) {
      plan.trees.push({ s: s0 + 0.9, u: sg * (xa + 0.5), species: R() < 0.7 ? 'round' : 'cypress', scale: R.range(0.8, 1.0), seed: R() });
    }
    const hAt = (s, u) => groundHeight(s, u);
    const put = (kind, s, u, extra = {}) => {
      plan.props.push({ kind, s, u, h: hAt(s, u), yaw: yawFace, seed: R(), r: 1.5, ...extra });
    };
    switch (choice) {
      case 'kiosk':
        if (room > 4) put('kiosk', sc, um, { r: 2.6, col: { hs: 1.6, hu: 1.6, top: 3.4 } });
        break;
      case 'cafe':
        if (room > 6) {
          put('cafe', sc, sg * (xb - 2.6), { r: 3.4, col: { hs: 2.2, hu: 2.6, top: 3.6 } });
          put('parasol', sc - 3.5, sg * (xa + 1.2), { r: 1.5 });
          put('parasol', sc + 3.5, sg * (xa + 1.2), { r: 1.5 });
        }
        break;
      case 'pavilion':
        if (room > 5) put('pavilion', sc, um, { r: 3.2, col: { r: 0.3, top: 4 } });
        break;
      case 'playground':
        if (room > 5) put('playground', sc, um, { r: 3.5 });
        break;
      case 'benches':
        put('bench', sc - 3, sg * (xa - 0.2), { r: 1.0 });
        put('flowerbed', sc + 2, um, { r: 1.6, yaw: 0 });
        break;
      case 'sculpture':
        put('sculpture', sc, um, { r: 2, col: { r: 1.2, top: 4 } });
        break;
      case 'plots':
        for (let i = 0; i < 3; i++) put('plot', s0 + 2.4 + i * 3.4, sg * (xb - 1.6), { r: 1.4, yaw: 0 });
        break;
      case 'boathouse': {
        const bankU = sg * side.bankTop;
        put('boathouse', sc, sg * (side.bankTop + 2.6), { r: 3.5, col: { hs: 2.1, hu: 2.5, top: 3.5 } });
        plan.props.push({ kind: 'jetty', s: sc, u: bankU, h: 0.35, yaw: yawFace, seed: R(), r: 1.2, len: 7 });
        plan.props.push({ kind: 'rowboat', s: sc + 2.2, u: bankU - sg * 4.5, h: 0, yaw: R.range(-0.4, 0.4), seed: R(), r: 1.5, float: true });
        break;
      }
      case 'picnic':
        put('picnic', sc + R.range(-3, 3), um, { r: 1.6 });
        break;
      case 'barn':
        if (room > 7) put('barn', sc, sg * (xb - 3.4), { r: 5.2, col: { hs: 2.9, hu: 4.2, top: 6 } });
        break;
      case 'hay':
        for (let i = 0; i < 3; i++) put('haybale', sc + R.range(-4, 4), sg * R.range(xa + 1, xb - 1), { r: 0.9, yaw: R.range(0, 6.28), col: { r: 0.6, top: 1.0 } });
        break;
      case 'orchard':
        for (let i = 0; i < 3; i++) {
          for (let x = xa + 1.5; x < xb - 1; x += 3.6) {
            plan.trees.push({ s: s0 + 2 + i * 3.8, u: sg * x, species: 'fruit', scale: R.range(0.7, 0.9), seed: R() });
          }
        }
        break;
      case 'rocks':
        for (let i = 0; i < 3; i++) put('rock', sc + R.range(-5, 5), sg * R.range(xa, xb), { r: 1.2, yaw: R.range(0, 6.28), scale: R.range(0.6, 1.8) });
        break;
      case 'lookout':
        if (room > 4) put('lookout', sc, um, { r: 2.4, col: { r: 1.6, top: 9 } });
        break;
      case 'bamboo':
        put('bamboo', sc, um, { r: 2.2, col: { r: 1.4, top: 7 } });
        break;
      case 'teahouse':
        if (room > 6) put('teahouse', sc, um, { r: 3.4, col: { hs: 2.4, hu: 2.4, top: 3.6 } });
        break;
      case 'lanterns':
        put('lantern', sc - 3, sg * (xa - 0.3), { r: 0.5, col: { r: 0.35, top: 1.4 } });
        put('lantern', sc + 3, sg * (xa - 0.3), { r: 0.5, col: { r: 0.35, top: 1.4 } });
        break;
      case 'cherry':
        plan.trees.push({ s: sc, u: um, species: 'cherry', scale: R.range(0.8, 1.05), seed: R() });
        break;
      case 'beehives':
        for (let i = 0; i < 3; i++) put('beehive', sc - 2 + i * 1.6, sg * (xb - 1.2), { r: 0.6, yaw: yawFace });
        break;
      case 'gazebo':
        if (room > 5) put('pavilion', sc, um, { r: 3.2, col: { r: 0.3, top: 4 } });
        break;
      case 'meadow':
        put('wildflowers', sc, um, { r: 0, yaw: 0, spread: Math.min(room / 2, 5) });
        break;
      default:
        break;
    }
    // Riverside extras
    if (z.core > 0.5 && R() < 0.35) {
      const bu = sg * (side.bankTop - 0.8);
      plan.props.push({ kind: 'reeds', s: sc + R.range(-4, 4), u: bu, h: groundHeight(sc, bu), yaw: 0, seed: R(), r: 0 });
    }
  }

  // --- Town features belonging to this cell ------------------------------------
  if (z.town > 0.02) {
    const tp = townPlan(z.spoke);
    for (const f of tp.feats) {
      const d = deltaS(s0, f.s);
      if (d >= 0 && d < CELL_LEN) {
        const s = wrapS(f.s);
        plan.props.push({ ...f, s, h: groundHeight(s, f.u) });
      }
    }
  }
  return plan;
}

/** All cells overlapping [sA, sB] (s may be unwrapped). */
export function cellsBetween(sA, sB) {
  const cA = Math.floor(sA / CELL_LEN);
  const cB = Math.floor(sB / CELL_LEN);
  const out = [];
  for (let c = cA; c <= cB; c++) out.push(planCell(c));
  return out;
}

// ---------------------------------------------------------------------------
// Paths

function segDist(s, u, p) {
  // distance from (s,u) to the segment p (in s/u metres, s wrapped)
  const ax = 0;
  const ay = p.uA;
  const bx = deltaS(p.sA, p.sB);
  const by = p.uB;
  const px = deltaS(p.sA, s);
  const py = u;
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
  t = clamp(t, 0, 1);
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return Math.hypot(dx, dy);
}

const _reg = {};

/**
 * Signed distance to the nearest walkable path at (s, u) (negative inside) and
 * whether it is paved. `sl` must be the slice at s.
 */
export function pathAt(s, u, sl, out = { d: 99, pave: 0 }) {
  const reg = regionAt(sl, u, _reg);
  let d = 99;
  let pave = 0;
  const side = reg.side;
  const use = side.use;
  if (reg.kind === 'valley' || reg.kind === 'bank') {
    const prom = promenade(sl, side);
    const dp = Math.abs(reg.x - prom.x) - prom.hw;
    if (dp < d) {
      d = dp;
      pave = sl.z.core > 0.5 && !(sl.z.biome.lake && sl.z.lake > 0.2) ? 0 : 1;
    }
    if (sl.z.town > 0.02) {
      const dSp = Math.abs(sl.z.dSpoke) - (60 + 5 * noiseS(s, 40, 5));
      if (dSp < d) {
        d = dSp;
        pave = 1;
      }
    }
  } else if (reg.kind === 'terrace') {
    const hasWalk = use !== 'forest' || reg.k % 2 === 1;
    if (hasWalk) {
      const w = walkway(sl, side, reg.k);
      const dw = Math.abs(reg.x - w.x) - w.hw;
      if (dw < d) {
        d = dw;
        pave = paveStyle(sl, use);
      }
    }
  }
  if (reg.kind !== 'water' && reg.kind !== 'berm') {
    const c = Math.floor(wrapS(s) / CELL_LEN);
    for (let dc = -1; dc <= 1; dc++) {
      const p = planCell(c + dc);
      for (const path of p.paths) {
        const dd = segDist(s, u, path) - path.hw;
        if (dd < d) {
          d = dd;
          pave = path.pave;
        }
      }
    }
  }
  out.d = d;
  out.pave = pave;
  return out;
}

// ---------------------------------------------------------------------------
// Exclusion test for scattering vegetation.

/** true if (s,u) is too close to a planned structure. */
export function occupied(s, u, margin = 0.8) {
  const c = Math.floor(wrapS(s) / CELL_LEN);
  for (let dc = -1; dc <= 1; dc++) {
    const p = planCell(c + dc);
    for (const hsx of p.houses) {
      const ds0 = deltaS(hsx.sA, s);
      const len = hsx.sB - hsx.sA;
      const x = u * (hsx.si === 0 ? -1 : 1);
      if (ds0 > -margin && ds0 < len + margin && x > hsx.xF - margin - 1.2 && x < hsx.xB + margin) return true;
    }
    for (const m of p.midrises) {
      const ds0 = deltaS(m.sA, s);
      const len = m.sB - m.sA;
      const x = u * (m.si === 0 ? -1 : 1);
      if (ds0 > -margin && ds0 < len + margin && x > m.xF - margin - 1.5 && x < m.xB + margin) return true;
    }
    for (const st of p.stairs) {
      const a = Math.min(st.sLow, st.sHigh) - 2;
      const b = Math.max(st.sLow, st.sHigh) + 1;
      const ds0 = deltaS(a, s);
      const x = u * (st.si === 0 ? -1 : 1);
      if (ds0 > -margin && ds0 < b - a + margin && x > st.xIn - margin && x < st.xOut + margin) return true;
    }
    for (const b of p.bridges) {
      if (Math.abs(deltaS(b.s, s)) < b.width / 2 + margin + 0.5) return true;
    }
    for (const pr of p.props) {
      const r = (pr.r || 1) + margin;
      const ds = deltaS(pr.s, s);
      if (ds * ds + (u - pr.u) * (u - pr.u) < r * r) return true;
    }
    for (const t of p.trees) {
      const ds = deltaS(t.s, s);
      if (ds * ds + (u - t.u) * (u - t.u) < 4) return true;
    }
    for (const l of p.lamps) {
      const ds = deltaS(l.s, s);
      if (ds * ds + (u - l.u) * (u - l.u) < 1.5) return true;
    }
  }
  return false;
}

export { lerp, smoothstep, CIRC, SPOKES };
