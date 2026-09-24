import { PAT } from './builder.js';
import { ringToWorld, placementMatrix } from '../core/ring.js';
import { R0, TUBE_HC, TUBE_R, WINDOW_HALF_ANGLE, RAIL_H, RAIL_U, ROW_DS } from '../core/config.js';
import { rng, deltaS, clamp } from '../core/math.js';
import * as P from './palette.js';

const _a = { x: 0, y: 0, z: 0 };

function wp(s, u, h) {
  const th = s / R0;
  const r = R0 - h;
  return [r * Math.cos(th), r * Math.sin(th), u];
}

/**
 * Extrude a closed (or open) profile along a list of ring samples {s, u, h}.
 * The profile is a list of [du, dh] offsets, counter-clockwise when viewed
 * looking along +s. Geometry is emitted directly in world space.
 */
export function extrudeAlongS(b, samples, profile, closed = true, uvScale = 1) {
  b.place = null;
  b.bend = null;
  b.identity();
  const n = profile.length;
  const edges = closed ? n : n - 1;
  for (let i = 0; i < samples.length - 1; i++) {
    const p0 = samples[i];
    const p1 = samples[i + 1];
    for (let j = 0; j < edges; j++) {
      const q0 = profile[j];
      const q1 = profile[(j + 1) % n];
      const A = wp(p0.s, p0.u + q0[0], p0.h + q0[1]);
      const B = wp(p0.s, p0.u + q1[0], p0.h + q1[1]);
      const C = wp(p1.s, p1.u + q1[0], p1.h + q1[1]);
      const D = wp(p1.s, p1.u + q0[0], p1.h + q0[1]);
      const el = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
      b.quadFace(A[0], A[1], A[2], D[0], D[1], D[2], C[0], C[1], C[2], B[0], B[1], B[2], [p0.s * uvScale, 0, p1.s * uvScale, el]);
    }
  }
}

/** End cap for an extrusion (flat polygon at one sample). */
export function capAt(b, sample, profile, facing) {
  b.place = null;
  b.bend = null;
  const pts = profile.map((q) => wp(sample.s, sample.u + q[0], sample.h + q[1]));
  const th = sample.s / R0;
  const fx = -Math.sin(th) * facing;
  const fy = Math.cos(th) * facing;
  const ids = pts.map((p) => b.vert(p[0], p[1], p[2], fx, fy, 0));
  for (let i = 1; i < ids.length - 1; i++) {
    if (facing > 0) b.tri(ids[0], ids[i + 1], ids[i]);
    else b.tri(ids[0], ids[i], ids[i + 1]);
  }
}

// ---------------------------------------------------------------------------
// Stairs

export function buildStair(b, st) {
  const sg = st.si === 0 ? -1 : 1;
  const sMid = (st.sLow + st.sHigh) / 2;
  const uC = sg * (st.xWall - 0.95);
  b.placeMatrix(placementMatrix(sMid, uC, st.hLow, 0));
  b.identity().reset();
  const run = Math.abs(st.sHigh - st.sLow);
  const rise = st.hHigh - st.hLow;
  const n = Math.max(4, Math.round(rise / 0.19));
  const tread = run / n;
  const w = 1.9;
  // local z = -(s - sMid); low end at z = dir*run/2
  const zLow = (st.dir * run) / 2;
  for (let i = 0; i < n; i++) {
    const za = zLow - st.dir * tread * i;
    const zb = za - st.dir * tread;
    const top = ((i + 1) * rise) / n;
    const zc = (za + zb) / 2;
    b.color(P.STONE).pattern(PAT.STONE, 0.4);
    b.box(0, (top - 0.6) / 2, zc, w, top + 0.6, tread + 0.005, { skip: 'ny', topPattern: PAT.PAVING });
  }
  b.reset();
  // handrail on the open (valley) side
  const xr = -sg * 0.9;
  b.color(P.METAL_DARK);
  const zHigh = -zLow;
  b.tube(xr, 1.0, zLow, xr, rise + 1.0, zHigh, 0.04, 0.04, 6);
  const posts = Math.max(2, Math.round(run / 1.8));
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    const z = zLow + (zHigh - zLow) * t;
    const y = rise * Math.min(1, Math.max(0, (t * n + 0.5) / n));
    b.box(xr, y + 0.5, z, 0.06, 1.0, 0.06);
  }
  b.reset();
}

// ---------------------------------------------------------------------------
// Bridges

export function buildBridge(b, br) {
  const R = rng(Math.floor(br.s * 1000));
  const uMid = (br.uA + br.uB) / 2;
  const span = br.uB - br.uA;
  b.placeMatrix(placementMatrix(br.s, uMid, 0, 0));
  b.identity().reset();
  const w = br.width;
  const N = 20;
  const deck = (t) => {
    const hEnds = br.hA + (br.hB - br.hA) * t;
    const x = -span / 2 + span * t;
    const c = (x - (br.c - uMid)) / (span / 2);
    return hEnds + br.rise * Math.max(0, 1 - c * c) * 0.9 + 0.05;
  };
  const style = br.style;
  const deckCol = style === 'wood' ? P.WOOD_LIGHT : 0xd8cfbf;
  const sideCol = style === 'wood' ? P.WOOD : P.STONE;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push([-span / 2 + span * t, deck(t)]);
  }
  // deck top
  b.color(deckCol).pattern(style === 'wood' ? PAT.WOOD : PAT.PAVING, 0.3);
  for (let i = 0; i < N; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    b.quadFace(x0, y0, w / 2, x1, y1, w / 2, x1, y1, -w / 2, x0, y0, -w / 2, [x0, -w / 2, x1, w / 2]);
  }
  // side walls / fascia and underside
  b.color(sideCol).pattern(style === 'wood' ? PAT.WOOD : PAT.STONE, 0.5);
  const under = (x) => {
    if (style !== 'stone' && style !== 'town') return null;
    const c = (x - (br.c - uMid)) / (span / 2);
    const archTop = -0.4 + br.rise * 0.9 * Math.max(0, 1 - c * c);
    return archTop;
  };
  for (const sz of [-1, 1]) {
    const z = (sz * w) / 2;
    for (let i = 0; i < N; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      let b0 = y0 - 0.35;
      let b1 = y1 - 0.35;
      const u0 = under(x0);
      const u1 = under(x1);
      if (u0 !== null) {
        b0 = Math.min(b0, Math.max(-1.4, u0));
        b1 = Math.min(b1, Math.max(-1.4, u1));
        b0 = Math.min(y0 - 0.35, Math.max(-2.0, Math.min(b0, y0 - 0.35)));
      }
      if (sz > 0) b.quadFace(x0, b0, z, x1, b1, z, x1, y1, z, x0, y0, z, [x0, b0, x1, y1]);
      else b.quadFace(x1, b1, z, x0, b0, z, x0, y0, z, x1, y1, z, [x0, b0, x1, y1]);
    }
  }
  // underside (arch intrados or flat)
  for (let i = 0; i < N; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    let b0 = y0 - 0.35;
    let b1 = y1 - 0.35;
    const u0 = under(x0);
    const u1 = under(x1);
    if (u0 !== null) {
      b0 = Math.min(b0, Math.max(-1.4, u0));
      b1 = Math.min(b1, Math.max(-1.4, u1));
    }
    b.quadFace(x1, b1, w / 2, x0, b0, w / 2, x0, b0, -w / 2, x1, b1, -w / 2);
  }
  b.reset();
  // parapets / railings
  if (style === 'wood') {
    b.color(P.WOOD);
    for (const sz of [-1, 1]) {
      const z = (sz * (w - 0.1)) / 2;
      for (let i = 0; i <= N; i += 2) b.box(pts[i][0], pts[i][1] + 0.5, z, 0.1, 1.0, 0.1);
      for (let i = 0; i < N; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        b.tube(x0, y0 + 1.0, z, x1, y1 + 1.0, z, 0.05, 0.05, 4);
      }
    }
    // piers in the water
    for (const x of [-span / 6, span / 6]) {
      for (const sz of [-1, 1]) b.cylinder(x, -2.2, (sz * w) / 2.4, 0.14, 0.14, deck(0.5 + x / span) + 2.0, 6);
    }
  } else {
    b.color(style === 'town' ? 0xe8e0d0 : P.STONE).pattern(PAT.STONE, 0.2);
    for (const sz of [-1, 1]) {
      const z = (sz * (w - 0.3)) / 2;
      for (let i = 0; i < N; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const hgt = 0.85;
        const t = 0.28;
        // outer + inner + top faces of the parapet segment
        b.quadFace(x0, y0, z + t / 2, x1, y1, z + t / 2, x1, y1 + hgt, z + t / 2, x0, y0 + hgt, z + t / 2);
        b.quadFace(x1, y1, z - t / 2, x0, y0, z - t / 2, x0, y0 + hgt, z - t / 2, x1, y1 + hgt, z - t / 2);
        b.quadFace(x0, y0 + hgt, z + t / 2, x1, y1 + hgt, z + t / 2, x1, y1 + hgt, z - t / 2, x0, y0 + hgt, z - t / 2);
      }
      // end caps
      for (const i of [0, N]) {
        const [x, y] = pts[i];
        const f = i === 0 ? -1 : 1;
        if (f > 0) b.quadFace(x, y, z + 0.14, x, y, z - 0.14, x, y + 0.85, z - 0.14, x, y + 0.85, z + 0.14);
        else b.quadFace(x, y, z - 0.14, x, y, z + 0.14, x, y + 0.85, z + 0.14, x, y + 0.85, z - 0.14);
      }
    }
    b.reset();
    if (style === 'town') {
      // flower boxes on the parapets
      for (let i = 2; i < N; i += 4) {
        for (const sz of [-1, 1]) {
          const [x, y] = pts[i];
          b.color(P.WOOD).box(x, y + 0.95, (sz * (w - 0.3)) / 2, 1.0, 0.2, 0.3);
          b.color(R.pick(P.FLOWERS)).pattern(PAT.LEAF, R()).sway(0.2);
          b.sphere(x, y + 1.12, (sz * (w - 0.3)) / 2, 0.45, 0.16, 0.16, 0);
          b.reset();
        }
      }
    }
  }
  return { deck };
}

// ---------------------------------------------------------------------------
// Terrace-edge railings, parapets, hedges, fences (emitted per sector)

export function edgeStyle(use) {
  switch (use) {
    case 'town': return 'parapet';
    case 'res': return 'rail';
    case 'garden': return 'hedge';
    case 'farm': case 'orchard': case 'meadow': return 'fence';
    case 'paddy': return 'curb';
    default: return null;
  }
}

/**
 * samples: [{s, u, h}] along the edge (u already on the correct side), sg: side sign.
 */
export function buildEdge(b, samples, style, sg) {
  if (samples.length < 2) return;
  b.reset();
  if (style === 'parapet') {
    b.color(0xefe7d8).pattern(PAT.PLAIN);
    const prof = [[-0.14, -0.3], [0.14, -0.3], [0.14, 0.8], [-0.14, 0.8]];
    extrudeAlongS(b, samples, prof, true);
    b.color(0xd6c7a8);
    extrudeAlongS(b, samples.map((p) => ({ ...p, h: p.h + 0.8 })), [[-0.2, 0], [0.2, 0], [0.2, 0.08], [-0.2, 0.08]], true);
    capAt(b, samples[0], prof, -1);
    capAt(b, samples[samples.length - 1], prof, 1);
  } else if (style === 'hedge') {
    b.color(0x3f7f4f).pattern(PAT.LEAF, 0.4);
    const prof = [[-0.35, -0.2], [0.35, -0.2], [0.38, 0.5], [0.25, 0.85], [0, 0.95], [-0.25, 0.85], [-0.38, 0.5]];
    extrudeAlongS(b, samples, prof, true);
    capAt(b, samples[0], prof, -1);
    capAt(b, samples[samples.length - 1], prof, 1);
  } else if (style === 'curb') {
    b.color(P.STONE_DARK).pattern(PAT.STONE, 0.6);
    extrudeAlongS(b, samples, [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.25], [-0.2, 0.25]], true);
  } else if (style === 'rail' || style === 'fence') {
    const wood = style === 'fence';
    b.color(wood ? P.WOOD : P.METAL_DARK);
    const rt = wood ? 0.06 : 0.035;
    for (const y of wood ? [0.45, 0.9] : [0.5, 1.0]) {
      extrudeAlongS(b, samples.map((p) => ({ ...p, h: p.h + y })), [[-rt, -rt], [rt, -rt], [rt, rt], [-rt, rt]], true);
    }
    // posts every other sample
    for (let i = 0; i < samples.length; i += 2) {
      const p = samples[i];
      b.placeMatrix(placementMatrix(p.s, p.u, p.h, 0));
      b.identity();
      if (wood) b.box(0, 0.45, 0, 0.12, 1.1, 0.12);
      else b.box(0, 0.5, 0, 0.06, 1.05, 0.06);
    }
  }
  b.reset();
}

// ---------------------------------------------------------------------------
// The habitat shell: curved walls up to the skylight, ribs, glazing bars,
// light strips and the monorail.

const SHELL_TOP = WINDOW_HALF_ANGLE; // phi of window edge (from the top)
const SHELL_BOTTOM = (102 * Math.PI) / 180;

function shellPoint(phi, sg, inset = 0) {
  const r = TUBE_R - inset;
  return { u: sg * r * Math.sin(phi), h: TUBE_HC + r * Math.cos(phi) };
}

export function buildShell(b, s0, s1, spokeS = null) {
  b.place = null;
  b.bend = null;
  b.identity().reset();
  const rows = Math.max(2, Math.round((s1 - s0) / 2.4));
  const cols = 34;
  b.color(0xaeb8c1).pattern(PAT.PANEL, 0.5);
  for (const sg of [-1, 1]) {
    const base = b.vertexCount;
    for (let i = 0; i <= rows; i++) {
      const s = s0 + ((s1 - s0) * i) / rows;
      for (let j = 0; j <= cols; j++) {
        const phi = SHELL_TOP + ((SHELL_BOTTOM - SHELL_TOP) * j) / cols;
        const p = shellPoint(phi, sg);
        const w = wp(s, p.u, p.h);
        const th = s / R0;
        // inward normal in (u,h): (-sg sin phi, -cos phi) → world: nu*lat + nh*up
        const nu = -sg * Math.sin(phi);
        const nh = -Math.cos(phi);
        b.vert(w[0], w[1], w[2], -nh * Math.cos(th), -nh * Math.sin(th), nu, s, TUBE_R * (phi - SHELL_TOP));
      }
    }
    const W = cols + 1;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = base + i * W + j;
        const bb = a + 1;
        const c = a + W;
        const d = c + 1;
        if (sg > 0) {
          b.tri(a, c, bb);
          b.tri(bb, c, d);
        } else {
          b.tri(a, bb, c);
          b.tri(bb, d, c);
        }
      }
    }
  }
  b.reset();

  // Ribs every 19.2 m
  const RIB = 19.2;
  const first = Math.ceil((s0 - RIB / 2) / RIB) * RIB + RIB / 2;
  for (let sr = first; sr < s1; sr += RIB) {
    if (sr < s0) continue;
    if (spokeS !== null && Math.abs(deltaS(spokeS, sr)) < 8) continue;
    b.color(0xe9edf0).pattern(PAT.METAL, 0.2);
    const segs = 64;
    const depth = 1.5;
    const hw = 0.55;
    const pts = [];
    for (let k = 0; k <= segs; k++) {
      const phi = -SHELL_BOTTOM + (2 * SHELL_BOTTOM * k) / segs;
      pts.push(phi);
    }
    for (let k = 0; k < segs; k++) {
      const pa = pts[k];
      const pb = pts[k + 1];
      const oa = shellPoint(Math.abs(pa), Math.sign(pa) || 1, -0.1);
      const ob = shellPoint(Math.abs(pb), Math.sign(pb) || 1, -0.1);
      const ia = shellPoint(Math.abs(pa), Math.sign(pa) || 1, depth);
      const ib = shellPoint(Math.abs(pb), Math.sign(pb) || 1, depth);
      // inner face
      const A = wp(sr - hw, ia.u, ia.h);
      const B = wp(sr + hw, ia.u, ia.h);
      const C = wp(sr + hw, ib.u, ib.h);
      const D = wp(sr - hw, ib.u, ib.h);
      b.quadFace(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], D[0], D[1], D[2]);
      // side faces
      for (const side of [-1, 1]) {
        const s = sr + side * hw;
        const E = wp(s, oa.u, oa.h);
        const F = wp(s, ia.u, ia.h);
        const G = wp(s, ib.u, ib.h);
        const H = wp(s, ob.u, ob.h);
        if (side < 0) b.quadFace(E[0], E[1], E[2], F[0], F[1], F[2], G[0], G[1], G[2], H[0], H[1], H[2]);
        else b.quadFace(F[0], F[1], F[2], E[0], E[1], E[2], H[0], H[1], H[2], G[0], G[1], G[2]);
      }
      // outer face (visible from outside through the window of the far side)
      const O1 = wp(sr - hw, oa.u, oa.h);
      const O2 = wp(sr + hw, oa.u, oa.h);
      const O3 = wp(sr + hw, ob.u, ob.h);
      const O4 = wp(sr - hw, ob.u, ob.h);
      if (Math.abs(pa) < SHELL_TOP + 0.02) b.quadFace(O2[0], O2[1], O2[2], O1[0], O1[1], O1[2], O4[0], O4[1], O4[2], O3[0], O3[1], O3[2]);
    }
    b.reset();
  }

  // Longitudinal glazing bars across the skylight and heavy edge beams.
  const samples = (u, h) => {
    const out = [];
    const n = Math.max(2, Math.round((s1 - s0) / 4.8));
    for (let i = 0; i <= n; i++) out.push({ s: s0 + ((s1 - s0) * i) / n, u, h });
    return out;
  };
  const bars = [];
  const nb = 6;
  for (let i = -nb; i <= nb; i++) bars.push((i / nb) * SHELL_TOP);
  for (const phi of bars) {
    const edge = Math.abs(Math.abs(phi) - SHELL_TOP) < 1e-6;
    const sg = phi < 0 ? -1 : 1;
    const inset = edge ? 0.9 : 0.35;
    const p = shellPoint(Math.abs(phi), sg, inset);
    // profile rotated to the local radial direction
    const rn = [-sg * Math.sin(Math.abs(phi)), -Math.cos(Math.abs(phi))]; // inward
    const tn = [-rn[1], rn[0]]; // tangent (ccw)
    const hw = edge ? 0.9 : 0.22;
    const hd = edge ? 0.9 : 0.35;
    const prof = [
      [tn[0] * -hw + rn[0] * -hd, tn[1] * -hw + rn[1] * -hd],
      [tn[0] * hw + rn[0] * -hd, tn[1] * hw + rn[1] * -hd],
      [tn[0] * hw + rn[0] * hd, tn[1] * hw + rn[1] * hd],
      [tn[0] * -hw + rn[0] * hd, tn[1] * -hw + rn[1] * hd],
    ];
    // ensure CCW orientation of the profile in (u, h)
    let area = 0;
    for (let k = 0; k < 4; k++) {
      const q0 = prof[k];
      const q1 = prof[(k + 1) % 4];
      area += q0[0] * q1[1] - q1[0] * q0[1];
    }
    if (area < 0) prof.reverse();
    b.color(edge ? 0xdfe5e9 : 0xf2f5f7).pattern(PAT.METAL, 0.1);
    extrudeAlongS(b, samples(p.u, p.h), prof, true);
    if (edge) {
      // light strip under the edge beam
      const q = shellPoint(Math.abs(phi) + 0.035, sg, 0.25);
      b.color(0xf7fbff).pattern(PAT.SKYLIGHT, 0);
      const lp = [[-0.5, -0.12], [0.5, -0.12], [0.5, 0.12], [-0.5, 0.12]];
      extrudeAlongS(b, samples(q.u, q.h), lp, true);
    }
  }
  b.reset();
  // Transverse glazing bars every 4.8 m (between ribs)
  const TB = 4.8;
  const firstT = Math.ceil(s0 / TB) * TB;
  b.color(0xf2f5f7).pattern(PAT.METAL, 0.1);
  for (let st = firstT; st < s1 - 0.01; st += TB) {
    if (Math.abs(((st - RIB / 2) % RIB + RIB) % RIB) < 0.1) continue;
    if (spokeS !== null && Math.abs(deltaS(spokeS, st)) < 8) continue;
    const segs = 12;
    for (let k = 0; k < segs; k++) {
      const pa = -SHELL_TOP + (2 * SHELL_TOP * k) / segs;
      const pb = -SHELL_TOP + (2 * SHELL_TOP * (k + 1)) / segs;
      const ia = shellPoint(Math.abs(pa), Math.sign(pa) || 1, 0.5);
      const ib = shellPoint(Math.abs(pb), Math.sign(pb) || 1, 0.5);
      const oa = shellPoint(Math.abs(pa), Math.sign(pa) || 1, 0.1);
      const ob = shellPoint(Math.abs(pb), Math.sign(pb) || 1, 0.1);
      const A = wp(st - 0.15, ia.u, ia.h);
      const B = wp(st + 0.15, ia.u, ia.h);
      const C = wp(st + 0.15, ib.u, ib.h);
      const D = wp(st - 0.15, ib.u, ib.h);
      b.quadFace(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], D[0], D[1], D[2]);
      for (const side of [-1, 1]) {
        const s = st + side * 0.15;
        const E = wp(s, oa.u, oa.h);
        const F = wp(s, ia.u, ia.h);
        const G = wp(s, ib.u, ib.h);
        const H = wp(s, ob.u, ob.h);
        if (side < 0) b.quadFace(E[0], E[1], E[2], F[0], F[1], F[2], G[0], G[1], G[2], H[0], H[1], H[2]);
        else b.quadFace(F[0], F[1], F[2], E[0], E[1], E[2], H[0], H[1], H[2], G[0], G[1], G[2]);
      }
    }
  }
  b.reset();
}

/** Wall-mounted monorail beam and brackets for [s0, s1]. */
export function buildRail(b, s0, s1) {
  const n = Math.max(2, Math.round((s1 - s0) / 4.8));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push({ s: s0 + ((s1 - s0) * i) / n, u: RAIL_U, h: RAIL_H });
  b.color(0xd8dde1).pattern(PAT.METAL, 0.3);
  extrudeAlongS(b, pts, [[-0.45, -1.4], [0.45, -1.4], [0.45, 0], [-0.45, 0]], true);
  b.color(0x6b7780);
  extrudeAlongS(b, pts, [[-0.5, -1.55], [0.5, -1.55], [0.5, -1.4], [-0.5, -1.4]], true);
  // brackets every 11.52 m
  const B = 11.52;
  const first = Math.ceil(s0 / B) * B;
  for (let s = first; s < s1; s += B) {
    const wallPhi = Math.acos((RAIL_H - 1.2 - TUBE_HC) / TUBE_R);
    const wallU = -TUBE_R * Math.sin(wallPhi);
    b.placeMatrix(placementMatrix(s, RAIL_U, RAIL_H, 0));
    b.identity().color(0xaab4bb).pattern(PAT.METAL, 0.3);
    b.box((wallU - RAIL_U) / 2, -1.2, 0, Math.abs(wallU - RAIL_U) + 0.6, 0.5, 0.5);
    const lowPhi = Math.acos((RAIL_H - 6 - TUBE_HC) / TUBE_R);
    const lowU = -TUBE_R * Math.sin(lowPhi);
    b.tube(0, -1.5, 0, lowU - RAIL_U + 0.3, -6, 0, 0.18, 0.18, 6);
    b.pattern(PAT.LAMP, 0).color(0xdff4ff).box(0.55, -1.0, 0, 0.12, 0.25, 0.4);
  }
  b.reset();
}

// ---------------------------------------------------------------------------
// Spoke tower: the elevator column that descends from the ceiling to the town plaza.

export function buildSpokeTower(b, s, u = 0) {
  const h0 = 1.05;
  b.placeMatrix(placementMatrix(s, u, h0, 0));
  b.identity().reset();
  // plinth steps
  b.color(0xd8cfbf).pattern(PAT.PAVING, 0.2);
  b.cylinder(0, -0.8, 0, 11.6, 11.6, 0.9, 48);
  b.cylinder(0, -0.8, 0, 11.0, 11.0, 1.15, 48);
  // base hall: glass drum with white frame
  b.pattern(PAT.GLASS, 0.3).color(0x9fc6d8);
  b.cylinder(0, 0.3, 0, 9.4, 9.4, 4.6, 40, { caps: 'none' });
  b.reset().color(0xf4f4f2);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    b.push().translate(Math.cos(a) * 9.45, 0, Math.sin(a) * 9.45).rotateY(-a);
    b.box(0, 2.6, 0, 0.3, 4.6, 0.35);
    b.pop();
  }
  b.cylinder(0, 4.9, 0, 10.3, 10.3, 0.7, 48);
  // entrance canopies towards ±s (local ∓z)
  for (const sz of [-1, 1]) {
    b.color(0xf4f4f2).box(0, 3.9, sz * 11.3, 5.2, 0.25, 3.4);
    b.color(0x8b979f).box(-2.4, 1.95, sz * 12.7, 0.2, 3.9, 0.2);
    b.box(2.4, 1.95, sz * 12.7, 0.2, 3.9, 0.2);
    b.pattern(PAT.GLOW, 0).color(0x9fe0ff).box(0, 4.15, sz * 12.8, 3.4, 0.35, 0.1);
    b.reset();
  }
  // upper drum and transition to the shaft
  b.color(0xe6ebee).pattern(PAT.PANEL, 0.4);
  b.lathe(0, 5.6, 0, [[10.0, 0], [9.6, 1.6], [7.5, 3.6], [5.6, 5.4], [5.2, 7.0]], 40);
  b.reset();
  // shaft
  const top = 96 - h0 + 1.5;
  b.color(0xd9e0e4).pattern(PAT.PANEL, 0.6);
  b.cylinder(0, 12.6, 0, 5.2, 5.2, top - 12.6, 32, { caps: 'none' });
  b.reset();
  // flanges
  b.color(0xf2f5f7).pattern(PAT.METAL, 0.2);
  for (let y = 18; y < top - 4; y += 12) b.cylinder(0, y, 0, 5.8, 5.8, 0.7, 32);
  // collar where the shaft meets the ceiling structure
  b.lathe(0, top - 16, 0, [[5.3, 0], [6.4, 6], [9.5, 13], [11, 16.5]], 32);
  // elevator rails
  b.color(0x6b7780);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    b.push().translate(Math.cos(a) * 5.5, 0, Math.sin(a) * 5.5).rotateY(-a);
    b.box(0, (12.6 + top) / 2, 0, 0.5, top - 12.6, 0.9);
    b.pop();
    // lights along the rails
    b.pattern(PAT.LAMP, 0).color(0xdff4ff);
    for (let y = 16; y < top - 6; y += 6) {
      b.push().translate(Math.cos(a) * 5.85, 0, Math.sin(a) * 5.85).rotateY(-a);
      b.box(0, y, 0, 0.2, 0.3, 0.25);
      b.pop();
    }
    b.reset().color(0x6b7780);
  }
  b.reset();
}

export function railStation(b, s, groundH) {
  // Platform on the valley side of the rail beam with a lift tower down to the top terrace.
  const y0 = RAIL_H - 0.9;
  b.placeMatrix(placementMatrix(s, RAIL_U + 3.2, y0, 0));
  b.identity().reset();
  const L = 30;
  const drop = y0 - groundH;
  b.color(0xe2e6e8).pattern(PAT.PAVING, 0.5).box(0, 0, 0, 4.2, 0.4, L);
  b.reset().color(0xf4f4f2);
  for (const z of [-L / 2 + 1, -L / 6, L / 6, L / 2 - 1]) {
    b.box(1.8, 1.6, z, 0.2, 3.2, 0.2);
    b.cylinder(0.8, -drop - 0.5, z, 0.4, 0.3, drop + 0.3, 10);
    b.cylinder(0.8, -drop - 0.5, z, 0.7, 0.7, 0.8, 10);
  }
  b.color(0x6f9e8a).pattern(PAT.METAL, 0.1).box(0.4, 3.3, 0, 5.2, 0.2, L + 1);
  b.reset().color(P.METAL_DARK);
  b.box(2.05, 0.7, 0, 0.05, 1.0, L);
  b.pattern(PAT.GLOW, 0).color(0x9fe0ff).box(1.9, 2.8, 0, 0.1, 0.35, 6);
  b.reset();
  // lift tower
  b.pattern(PAT.GLASS, 0.6).color(0xa8cfde);
  b.box(2.6, (-drop - 0.3) / 2 + 0.3, 5, 2.4, drop + 0.3, 2.4);
  b.reset().color(0xf4f4f2).box(2.6, 0.6, 5, 2.7, 0.3, 2.7);
  b.box(2.6, -drop + 0.1, 5, 2.9, 0.4, 2.9);
  b.pattern(PAT.GLOW, 0).color(0x9fe0ff).box(2.6, -drop + 2.6, 6.22, 1.2, 0.3, 0.06);
  b.reset();
}

export { clamp, ROW_DS, _a, ringToWorld };
