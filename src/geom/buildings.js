import { PAT } from './builder.js';
import { rng } from '../core/math.js';
import { placementMatrix } from '../core/ring.js';
import * as P from './palette.js';

export const FLOOR_H = 3.1;

/** Orientation that makes a building's local +z face the valley on side si. */
export const frontYaw = (si) => (si === 0 ? -Math.PI / 2 : Math.PI / 2);

function roofGarden(b, R, w, d, y) {
  const n = R.int(2, 4);
  for (let i = 0; i < n; i++) {
    const x = R.range(-w / 2 + 0.8, w / 2 - 0.8);
    const z = R.range(-d / 2 + 0.8, d / 2 - 0.8);
    b.reset().color(P.WOOD).box(x, y + 0.25, z, 0.9, 0.5, 0.9);
    b.pattern(PAT.LEAF, R()).color(R.pick(P.FOLIAGE)).sway(0.15);
    b.sphere(x, y + 0.85, z, 0.62, 0.55, 0.62, 1);
    if (R() < 0.5) {
      b.reset().color(R.pick(P.FLOWERS));
      b.sphere(x + 0.2, y + 1.2, z + 0.15, 0.18, 0.16, 0.18, 0);
    }
  }
  b.reset();
}

function gableRoof(b, w, d, y, pitchH, over, color, alongX = true) {
  // Ridge along local x (or z). Two slopes + gable ends.
  b.pattern(PAT.ROOF, 0).color(color);
  const hw = w / 2 + over;
  const hd = d / 2 + over;
  if (alongX) {
    // slopes facing +z and -z
    b.quadFace(-hw, y, hd, hw, y, hd, hw, y + pitchH, 0, -hw, y + pitchH, 0, [0, 0, 2 * hw, Math.hypot(hd, pitchH)]);
    b.quadFace(hw, y, -hd, -hw, y, -hd, -hw, y + pitchH, 0, hw, y + pitchH, 0, [0, 0, 2 * hw, Math.hypot(hd, pitchH)]);
    // undersides (visible from below)
    b.pattern(PAT.PLAIN).color(0xb8ab98);
    b.quadFace(hw, y - 0.06, hd, -hw, y - 0.06, hd, -hw, y + pitchH - 0.06, 0, hw, y + pitchH - 0.06, 0);
    b.quadFace(-hw, y - 0.06, -hd, hw, y - 0.06, -hd, hw, y + pitchH - 0.06, 0, -hw, y + pitchH - 0.06, 0);
    b.color(0xd9d2c4);
    b.quadFace(hw, y, hd, -hw, y, hd, -hw, y - 0.12, hd - 0.05, hw, y - 0.12, hd - 0.05);
    b.quadFace(-hw, y, -hd, hw, y, -hd, hw, y - 0.12, -hd + 0.05, -hw, y - 0.12, -hd + 0.05);
    // gable ends (triangles)
    b.pattern(PAT.PLAIN).color(0xe9e2d4);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2);
      const nx = sx;
      const i0 = b.vert(x, y, sx * (d / 2), nx, 0, 0);
      const i1 = b.vert(x, y, -sx * (d / 2), nx, 0, 0);
      const i2 = b.vert(x, y + pitchH, 0, nx, 0, 0);
      b.tri(i0, i1, i2);
    }
  } else {
    b.quadFace(hw, y, hd, hw, y, -hd, 0, y + pitchH, -hd, 0, y + pitchH, hd, [0, 0, 2 * hd, Math.hypot(hw, pitchH)]);
    b.quadFace(-hw, y, -hd, -hw, y, hd, 0, y + pitchH, hd, 0, y + pitchH, -hd, [0, 0, 2 * hd, Math.hypot(hw, pitchH)]);
    b.pattern(PAT.PLAIN).color(0xb8ab98);
    b.quadFace(hw, y - 0.06, -hd, hw, y - 0.06, hd, 0, y + pitchH - 0.06, hd, 0, y + pitchH - 0.06, -hd);
    b.quadFace(-hw, y - 0.06, hd, -hw, y - 0.06, -hd, 0, y + pitchH - 0.06, -hd, 0, y + pitchH - 0.06, hd);
    b.color(0xe9e2d4);
    for (const sz of [-1, 1]) {
      const z = sz * (d / 2);
      const i0 = b.vert(-sz * (w / 2), y, z, 0, 0, sz);
      const i1 = b.vert(sz * (w / 2), y, z, 0, 0, sz);
      const i2 = b.vert(0, y + pitchH, z, 0, 0, sz);
      b.tri(i0, i1, i2);
    }
  }
  b.reset();
}

function barrelRoof(b, w, d, y, color) {
  // half cylinder with axis along local z (spanning the depth)
  b.pattern(PAT.METAL, 0).color(color);
  const r = w / 2 + 0.25;
  const segs = 14;
  const hz = d / 2 + 0.3;
  const rise = Math.min(r, 1.8);
  let prev = null;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    const x = Math.cos(a) * r;
    const yy = y + Math.sin(a) * rise;
    const nx = Math.cos(a) / r;
    const ny = Math.sin(a) / rise;
    const i0 = b.vert(x, yy, hz, nx, ny, 0, i, 0);
    const i1 = b.vert(x, yy, -hz, nx, ny, 0, i, 1);
    if (prev) {
      b.tri(prev[0], i1, i0);
      b.tri(prev[0], prev[1], i1);
    }
    prev = [i0, i1];
  }
  // end caps
  b.pattern(PAT.PLAIN).color(0xe8e4dc);
  for (const sz of [-1, 1]) {
    const c = b.vert(0, y, sz * (d / 2), 0, 0, sz);
    const ids = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI;
      ids.push(b.vert(Math.cos(a) * (w / 2), y + Math.sin(a) * rise * (w / 2) / r, sz * (d / 2), 0, 0, sz));
    }
    for (let i = 0; i < segs; i++) {
      if (sz > 0) b.tri(c, ids[i], ids[i + 1]);
      else b.tri(c, ids[i + 1], ids[i]);
    }
  }
  b.reset();
}

function railing(b, x0, x1, y, z, color, glass = false) {
  // along local x at depth z
  const len = Math.abs(x1 - x0);
  if (glass) {
    b.pattern(PAT.GLASS, 0.1).color(0xbfe3ee);
    b.box((x0 + x1) / 2, y + 0.5, z, len, 0.9, 0.05);
    b.reset().color(0xf4f4f4);
    b.box((x0 + x1) / 2, y + 0.98, z, len + 0.05, 0.07, 0.1);
    return;
  }
  b.color(color);
  const n = Math.max(2, Math.round(len / 1.1));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    b.box(x, y + 0.5, z, 0.06, 1.0, 0.06, { skip: 'nyp' });
  }
  b.box((x0 + x1) / 2, y + 0.98, z, len, 0.06, 0.08);
  b.box((x0 + x1) / 2, y + 0.5, z, len, 0.04, 0.05);
}

/**
 * Terrace house. `h` is the planned house record, `b` a MeshBuilder.
 * Returns the collider box height.
 */
export function buildHouse(b, h) {
  const R = rng(h.seed);
  const sg = h.si === 0 ? -1 : 1;
  const W = h.sB - h.sA;
  const D = h.xB - h.xF;
  const sMid = (h.sA + h.sB) / 2;
  const xMid = (h.xF + h.xB) / 2;
  b.placeMatrix(placementMatrix(sMid, sg * xMid, h.base, frontYaw(h.si)));
  b.identity().reset();
  // local: x along -s*sg... width axis is x (W), depth axis z (D), front at +z
  const floors = h.floors;
  const bodyH = floors * FLOOR_H + 0.25;
  const wall = h.town ? R.pick(P.TOWN_WALLS) : R.pick(P.WALLS);
  const trim = R.pick(P.TRIM);
  const roofC = R.pick(P.ROOFS);
  const seed = R();

  // plinth
  b.color(P.STONE).pattern(PAT.STONE, 0.3);
  b.box(0, -0.45, 0, W + 0.25, 1.1, D + 0.25);
  // body
  b.reset().ao(1);
  b.pattern(PAT.FACADE, seed).color(wall);
  b.bevelBox(0, 0.1 + bodyH / 2, 0, W, bodyH, D, 0.25, { uv: 'facade', cell: 2.5 + R() * 0.6, vOff: -0.1, topPattern: PAT.PLAIN, topColor: 0xcfc8bb });
  b.reset();
  const top = 0.1 + bodyH;

  // cornice band
  b.color(trim).box(0, top - 0.08, 0, W + 0.12, 0.16, D + 0.12);

  // roof
  const roofType = h.town ? R.weighted([[0, 0.6], [1, 0.3], [3, 0.1]]) : R.weighted([[0, 0.3], [1, 0.35], [2, 0.12], [3, 0.13], [4, 0.1]]);
  let roofTop = top;
  if (roofType === 0) {
    // flat with parapet and roof garden
    b.color(wall);
    b.box(0, top + 0.3, D / 2 - 0.1, W, 0.6, 0.2);
    b.box(0, top + 0.3, -D / 2 + 0.1, W, 0.6, 0.2);
    b.box(W / 2 - 0.1, top + 0.3, 0, 0.2, 0.6, D - 0.4);
    b.box(-W / 2 + 0.1, top + 0.3, 0, 0.2, 0.6, D - 0.4);
    roofGarden(b, R, W, D, top);
    if (R() < 0.35) {
      // pergola
      b.color(P.WOOD_LIGHT);
      const px = R.range(-W / 4, W / 4);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(px + sx * 1.2, top + 1.1, sz * 1.1, 0.12, 2.2, 0.12);
      for (let i = -2; i <= 2; i++) b.box(px + i * 0.55, top + 2.25, 0, 0.08, 0.1, 2.6);
    }
    roofTop = top + 0.6;
  } else if (roofType === 1) {
    gableRoof(b, W, D, top, 1.4 + R() * 0.8, 0.35, roofC, true);
    roofTop = top + 2;
  } else if (roofType === 2) {
    gableRoof(b, W, D, top, 1.6, 0.35, roofC, false);
    roofTop = top + 1.6;
  } else if (roofType === 3) {
    barrelRoof(b, W, D, top, R.pick([0x6f9e8a, 0x7d8b99, 0xc9d3d8, 0x5f7a8c]));
    roofTop = top + 1.8;
  } else {
    // shed roof sloping to the front
    b.pattern(PAT.ROOF, 0).color(roofC);
    const rise = 1.2;
    const o = 0.4;
    b.quadFace(-W / 2 - o, top, D / 2 + o, W / 2 + o, top, D / 2 + o, W / 2 + o, top + rise, -D / 2 - o, -W / 2 - o, top + rise, -D / 2 - o, [0, 0, W, D]);
    b.reset().color(wall);
    for (const sx of [-1, 1]) {
      const x = sx * W / 2;
      const i0 = b.vert(x, top, sx * D / 2, sx, 0, 0);
      const i1 = b.vert(x, top, -sx * D / 2, sx, 0, 0);
      const i2 = b.vert(x, top + rise * 0.95, -D / 2, sx, 0, 0);
      b.tri(i0, i1, i2);
    }
    b.color(wall).box(0, top + rise / 2, -D / 2 + 0.05, W, rise, 0.1);
    roofTop = top + rise;
  }

  // door with canopy and lamp
  const doorX = R.range(-W / 2 + 1.2, W / 2 - 1.2);
  b.reset().color(R.pick(P.DOORS)).pattern(PAT.WOOD, 0.5);
  b.box(doorX, 0.1 + 1.05, D / 2 + 0.04, 1.05, 2.1, 0.1);
  b.reset().color(trim);
  b.box(doorX, 2.35, D / 2 + 0.35, 1.6, 0.1, 0.7);
  b.pattern(PAT.LAMP, 0).color(0xfff1c9);
  b.box(doorX + 0.85, 2.0, D / 2 + 0.08, 0.16, 0.24, 0.12);
  b.reset();
  // step
  b.color(P.STONE).box(doorX, 0.05, D / 2 + 0.45, 1.5, 0.22, 0.7);

  // balcony
  if (floors >= 2 && R() < 0.6) {
    const bw = Math.min(W - 1.2, R.range(2.4, 4.4));
    const bx = R.range(-W / 2 + bw / 2 + 0.3, W / 2 - bw / 2 - 0.3);
    const y = 0.1 + FLOOR_H;
    b.color(trim).box(bx, y, D / 2 + 0.55, bw, 0.16, 1.1);
    railing(b, bx - bw / 2, bx + bw / 2, y + 0.08, D / 2 + 1.05, trim === 0xffffff ? 0x5b6b73 : trim, R() < 0.4);
    if (R() < 0.7) {
      // flower box
      const fc = R.pick(P.FLOWERS);
      b.color(P.WOOD).box(bx, y + 0.95, D / 2 + 1.15, bw * 0.8, 0.22, 0.25);
      b.color(fc).pattern(PAT.LEAF, 0.2).sway(0.1);
      for (let i = 0; i < 4; i++) b.sphere(bx - bw * 0.35 + (i * bw * 0.7) / 3, y + 1.12, D / 2 + 1.15, 0.2, 0.14, 0.14, 0);
      b.reset();
    }
  }
  // awning over a ground floor window
  if (R() < 0.35) {
    const aw = R.range(1.6, 2.6);
    let ax = R.range(-W / 2 + aw / 2 + 0.2, W / 2 - aw / 2 - 0.2);
    if (Math.abs(ax - doorX) < (aw + 1.2) / 2) ax = doorX > 0 ? doorX - (aw + 1.4) / 2 : doorX + (aw + 1.4) / 2;
    if (Math.abs(ax) + aw / 2 < W / 2) {
      b.pattern(PAT.STRIPES, R()).color(R.pick(P.AWNINGS));
      b.quadFace(ax - aw / 2, 2.4, D / 2 + 0.02, ax + aw / 2, 2.4, D / 2 + 0.02, ax + aw / 2, 1.95, D / 2 + 1.0, ax - aw / 2, 1.95, D / 2 + 1.0);
      b.quadFace(ax + aw / 2, 2.4, D / 2 + 0.02, ax - aw / 2, 2.4, D / 2 + 0.02, ax - aw / 2, 1.95, D / 2 + 1.0, ax + aw / 2, 1.95, D / 2 + 1.0);
      b.reset();
    }
  }
  // front garden / pots
  if (R() < 0.8) {
    const n = R.int(1, 3);
    for (let i = 0; i < n; i++) {
      const px = R.range(-W / 2 + 0.4, W / 2 - 0.4);
      if (Math.abs(px - doorX) < 1.0) continue;
      b.color(R.pick([0xc9674a, 0xd98a5a, 0xe8e0d0])).cylinder(px, 0.1, D / 2 + 0.5, 0.28, 0.22, 0.45, 8);
      b.pattern(PAT.LEAF, R()).color(R.pick(P.FOLIAGE)).sway(0.2);
      b.sphere(px, 0.85, D / 2 + 0.5, 0.42, 0.45, 0.42, 1);
      b.reset();
    }
  }
  return roofTop;
}

/** Town mid-rise with shopfront arcade. */
export function buildMidrise(b, m) {
  const R = rng(m.seed);
  const sg = m.si === 0 ? -1 : 1;
  const W = m.sB - m.sA;
  const D = m.xB - m.xF;
  const sMid = (m.sA + m.sB) / 2;
  const xMid = (m.xF + m.xB) / 2;
  b.placeMatrix(placementMatrix(sMid, sg * xMid, m.base, frontYaw(m.si)));
  b.identity().reset();
  const wall = R.pick(P.TOWN_WALLS);
  const trim = R.pick([0xffffff, 0xf2eadb, 0x6b7780]);
  const gH = 3.6;
  const upperFloors = m.floors - 1;
  const upperH = upperFloors * FLOOR_H;
  // plinth
  b.color(P.STONE).pattern(PAT.STONE, 0.2).box(0, -0.5, 0, W + 0.3, 1.2, D + 0.3);
  b.reset();
  // ground floor: recessed shopfront + piers
  b.pattern(PAT.GLASS, R()).color(0x8fb8c8);
  b.box(0, 0.1 + gH / 2, -0.6, W - 0.4, gH, D - 1.2);
  b.reset().color(wall);
  const piers = Math.max(2, Math.round(W / 3.2));
  for (let i = 0; i <= piers; i++) {
    const x = -W / 2 + 0.3 + ((W - 0.6) * i) / piers;
    b.bevelBox(x, 0.1 + gH / 2, D / 2 - 0.5, 0.6, gH, 0.9, 0.12);
  }
  // shop signs / awnings
  const nA = piers;
  for (let i = 0; i < nA; i++) {
    const x = -W / 2 + 0.3 + ((W - 0.6) * (i + 0.5)) / piers;
    const aw = (W - 0.6) / piers - 0.7;
    if (R() < 0.6) {
      b.pattern(PAT.STRIPES, R()).color(R.pick(P.AWNINGS));
      b.quadFace(x - aw / 2, gH - 0.2, D / 2 - 0.05, x + aw / 2, gH - 0.2, D / 2 - 0.05, x + aw / 2, gH - 0.8, D / 2 + 1.2, x - aw / 2, gH - 0.8, D / 2 + 1.2);
      b.quadFace(x + aw / 2, gH - 0.2, D / 2 - 0.05, x - aw / 2, gH - 0.2, D / 2 - 0.05, x - aw / 2, gH - 0.8, D / 2 + 1.2, x + aw / 2, gH - 0.8, D / 2 + 1.2);
      b.reset();
    } else {
      b.pattern(PAT.GLOW, 0).color(R.pick([0xffd27a, 0xff8f70, 0x8fd6ff, 0xb7f08a]));
      b.box(x, gH - 0.35, D / 2 + 0.02, aw * 0.8, 0.4, 0.08);
      b.reset();
    }
  }
  // upper floors
  b.pattern(PAT.FACADE, R()).color(wall);
  b.bevelBox(0, 0.1 + gH + upperH / 2, 0, W, upperH, D, 0.3, { uv: 'facade', cell: 2.4, vOff: 0, topPattern: PAT.PLAIN, topColor: 0xcfc8bb });
  b.reset();
  const top = 0.1 + gH + upperH;
  b.color(trim).box(0, 0.1 + gH, 0, W + 0.2, 0.25, D + 0.2);
  b.color(trim).box(0, top, 0, W + 0.35, 0.3, D + 0.35);
  // parapet + rooftop kit
  b.color(wall);
  b.box(0, top + 0.45, D / 2 - 0.1, W, 0.6, 0.2);
  b.box(0, top + 0.45, -D / 2 + 0.1, W, 0.6, 0.2);
  b.box(W / 2 - 0.1, top + 0.45, 0, 0.2, 0.6, D - 0.4);
  b.box(-W / 2 + 0.1, top + 0.45, 0, 0.2, 0.6, D - 0.4);
  if (R() < 0.6) {
    b.color(P.METAL).cylinder(R.range(-W / 4, W / 4), top + 0.15, R.range(-1, 1), 0.9, 0.9, 1.8, 12);
  }
  roofGarden(b, R, W, D, top + 0.15);
  // balconies on upper floors
  for (let f = 1; f < m.floors; f++) {
    if (R() < 0.45) continue;
    const y = 0.1 + gH + (f - 1) * FLOOR_H;
    const bw = W * 0.8;
    b.color(trim).box(0, y, D / 2 + 0.45, bw, 0.14, 0.9);
    railing(b, -bw / 2, bw / 2, y + 0.07, D / 2 + 0.85, 0x4a545c, R() < 0.5);
  }
  return top + 0.8;
}
