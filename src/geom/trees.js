import { PAT, icosphere } from './builder.js';
import { rng, noise3 } from '../core/math.js';
import { placementMatrix } from '../core/ring.js';
import * as P from './palette.js';

// Procedural trees. Foliage is built from displaced ellipsoid "puffs" whose
// normals are bent towards a common canopy centre, which gives the soft,
// cloud-like banding typical of cel-shaded foliage.

function puff(b, cx, cy, cz, r, detail, R, center, squash = 0.85, bend = 0.55) {
  const seed = Math.floor(R() * 1000);
  const ico = detailCache(detail);
  const base = b.vertexCount;
  const v = ico.v;
  const [ox, oy, oz] = center;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i];
    const y = v[i + 1];
    const z = v[i + 2];
    const k = 1 + 0.16 * noise3(x * 1.7 + seed, y * 1.7, z * 1.7, 3) + 0.06 * noise3(x * 4.1, y * 4.1 + seed, z * 4.1, 5);
    const px = cx + x * r * k;
    const py = cy + y * r * squash * k;
    const pz = cz + z * r * k;
    // bent normal
    let dx = px - ox;
    let dy = (py - oy) * 1.2;
    let dz = pz - oz;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    const nx = x * (1 - bend) + dx * bend;
    const ny = y * (1 - bend) + dy * bend + 0.1;
    const nz = z * (1 - bend) + dz * bend;
    // sway weight grows with height above the trunk base (set later via aux)
    b.vert(px, py, pz, nx, ny, nz, x, y);
  }
  const idx = ico.i;
  for (let i = 0; i < idx.length; i += 3) b.tri(base + idx[i], base + idx[i + 1], base + idx[i + 2]);
}

const detailCache = (d) => icosphere(d);

function trunk(b, R, h, r0, color, segs) {
  b.reset().color(color).pattern(PAT.WOOD, 0.9);
  b.cylinder(0, -0.3, 0, r0 * 1.25, r0 * 0.6, h + 0.3, segs, { caps: 'none' });
  b.reset();
}

function branch(b, x0, y0, z0, x1, y1, z1, r0, r1, color) {
  b.reset().color(color).pattern(PAT.WOOD, 0.9);
  b.tube(x0, y0, z0, x1, y1, z1, r0, r1, 6, 'none');
  b.reset();
}

/** Broad-leaf tree with a clustered crown. */
function roundTree(b, R, s, lod, opts = {}) {
  const H = R.range(5.5, 8.5) * s;
  const trunkH = H * R.range(0.38, 0.5);
  const tr = 0.18 * s + 0.05;
  const tc = R.pick(P.TRUNK);
  trunk(b, R, trunkH + 0.6, tr, tc, lod ? 7 : 5);
  const crownR = R.range(2.0, 2.8) * s;
  const cy = trunkH + crownR * 0.75;
  const center = [0, cy, 0];
  const col = opts.colors ? R.pick(opts.colors) : R.pick(P.FOLIAGE);
  if (lod) {
    for (let i = 0; i < 3; i++) {
      const a = R() * Math.PI * 2;
      const len = crownR * R.range(0.5, 0.8);
      branch(b, 0, trunkH * 0.8, 0, Math.cos(a) * len * 0.6, cy + R.range(-0.2, 0.6), Math.sin(a) * len * 0.6, tr * 0.6, tr * 0.25, tc);
    }
  }
  b.pattern(PAT.LEAF, R());
  // central mass + leafy clumps on its surface
  b.color(col).sway(0.55);
  puff(b, 0, cy, 0, crownR * 0.82, lod ? 2 : 1, R, center, 0.84);
  const n = lod ? R.int(9, 13) : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * 2.618 + R() * 0.6;
    const e = lod ? R.range(-0.35, 1.1) : R.range(0.0, 0.7);
    const d = crownR * 0.74;
    const rr = crownR * R.range(0.36, 0.52) * (lod ? 1 : 1.25);
    const shade = R.range(-0.05, 0.05);
    const bc = [((col >> 16) & 255) / 255 + shade, ((col >> 8) & 255) / 255 + shade, (col & 255) / 255 + shade * 0.5];
    b.color(bc).sway(0.7);
    puff(b, Math.cos(a) * Math.cos(e) * d, cy + Math.sin(e) * d * 0.8, Math.sin(a) * Math.cos(e) * d, rr, 1, R, center, 0.9, 0.45);
  }
  if (opts.fruit && lod) {
    b.reset().color(R.pick(P.FRUIT)).sway(0.55);
    for (let i = 0; i < 12; i++) {
      const a = R() * Math.PI * 2;
      const e = R.range(-0.2, 0.8);
      const rr = crownR * 0.98;
      b.sphere(Math.cos(a) * Math.cos(e) * rr, cy + Math.sin(e) * rr * 0.8, Math.sin(a) * Math.cos(e) * rr, 0.13, 0.13, 0.13, 0);
    }
  }
  if (opts.blossom && lod) {
    b.reset().color(0xffffff).sway(0.6);
    for (let i = 0; i < 16; i++) {
      const a = R() * Math.PI * 2;
      const e = R.range(-0.1, 1.0);
      const rr = crownR * 1.0;
      b.sphere(Math.cos(a) * Math.cos(e) * rr, cy + Math.sin(e) * rr * 0.8, Math.sin(a) * Math.cos(e) * rr, 0.16, 0.12, 0.16, 0);
    }
  }
  b.reset();
  return { h: cy + crownR, r: crownR };
}

function conifer(b, R, s, lod) {
  const H = R.range(8, 13) * s;
  const tc = R.pick(P.TRUNK);
  trunk(b, R, H * 0.35, 0.2 * s + 0.05, tc, lod ? 7 : 5);
  const tiers = lod ? R.int(4, 5) : 3;
  const col = R.pick(P.FOLIAGE_DARK);
  b.pattern(PAT.LEAF, R()).color(col);
  let y = H * 0.18;
  const baseR = H * R.range(0.23, 0.28);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = baseR * (1 - t * 0.72);
    const th = (H - y) * (i === tiers - 1 ? 1 : 0.5);
    const segs = lod ? 14 : 8;
    const prof = [
      [0.001, -0.05],
      [r * 0.75, 0.0],
      [r, th * 0.12],
      [r * 0.82, th * 0.22],
      [r * 0.35, th * 0.62],
      [0.001, th],
    ];
    const shade = (i % 2) * 0.03;
    const bc = [((col >> 16) & 255) / 255 + shade, ((col >> 8) & 255) / 255 + shade, (col & 255) / 255 + shade];
    b.color(bc).sway(0.35 + t * 0.4);
    b.lathe(0, y, 0, prof, segs, { angle0: R() * 6.28 });
    y += th * 0.48;
  }
  b.reset();
  return { h: H, r: baseR };
}

function cypress(b, R, s, lod) {
  const H = R.range(7, 11) * s;
  trunk(b, R, 1.2, 0.14 * s + 0.05, R.pick(P.TRUNK), 5);
  const col = R.pick([0x3f7f4f, 0x4a8a50, 0x356f48]);
  b.pattern(PAT.LEAF, R()).color(col).sway(0.5);
  const r = H * 0.14;
  puff(b, 0, 0.8 + H * 0.5, 0, r, lod ? 2 : 1, R, [0, 0.8 + H * 0.5, 0], (H * 0.5) / r, 0.3);
  b.reset();
  return { h: H, r };
}

function birch(b, R, s, lod) {
  const H = R.range(6, 9) * s;
  b.reset().color(0xece6dc).pattern(PAT.PLAIN);
  b.cylinder(0, -0.3, 0, 0.16 * s, 0.09 * s, H * 0.8, lod ? 7 : 5, { caps: 'none' });
  if (lod) {
    b.color(0x3a3a3a);
    for (let i = 0; i < 5; i++) {
      const y = R.range(0.4, H * 0.7);
      const a = R() * 6.28;
      b.box(Math.cos(a) * 0.13 * s, y, Math.sin(a) * 0.13 * s, 0.06, 0.05, 0.06);
    }
  }
  const col = R.pick([0x9cc85a, 0x8fc45c, 0xa8d06a]);
  b.pattern(PAT.LEAF, R());
  const center = [0, H * 0.72, 0];
  const n = lod ? 4 : 2;
  for (let i = 0; i < n; i++) {
    b.color(col).sway(0.7);
    puff(b, R.range(-0.6, 0.6) * s, H * (0.55 + i * 0.1), R.range(-0.6, 0.6) * s, R.range(1.1, 1.5) * s, lod ? 2 : 1, R, center, 1.05);
  }
  b.reset();
  return { h: H, r: 1.5 * s };
}

function willow(b, R, s, lod) {
  const H = R.range(6, 8) * s;
  const tc = R.pick(P.TRUNK);
  trunk(b, R, H * 0.6, 0.28 * s, tc, lod ? 8 : 5);
  const r = H * 0.5;
  const col = R.pick([0x7fa956, 0x86b060, 0x75a052]);
  const top = H * 0.66;
  const center = [0, top, 0];
  b.pattern(PAT.LEAF, R()).color(col).sway(0.6);
  puff(b, 0, top + r * 0.15, 0, r * 0.72, lod ? 2 : 1, R, center, 0.6);
  const nc = lod ? 7 : 2;
  for (let i = 0; i < nc; i++) {
    const a = (i / nc) * Math.PI * 2 + R() * 0.5;
    puff(b, Math.cos(a) * r * 0.55, top + r * R.range(0.1, 0.4), Math.sin(a) * r * 0.55, r * R.range(0.32, 0.42), 1, R, center, 0.8, 0.45);
  }
  // drooping fronds hanging from the rim of the crown
  const nf = lod ? R.int(14, 18) : 6;
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * Math.PI * 2 + R() * 0.3;
    const rr = r * R.range(0.78, 0.95);
    const len = H * R.range(0.28, 0.42);
    const shade = R.range(-0.06, 0.04);
    b.pattern(PAT.STRANDS, R()).color([((col >> 16) & 255) / 255 * 0.92 + shade, ((col >> 8) & 255) / 255 * 0.95 + shade, (col & 255) / 255 * 0.88 + shade]).sway(0.95);
    puff(b, Math.cos(a) * rr, top - len * 0.35, Math.sin(a) * rr, 0.62 * s, 1, R, [0, top - len * 0.4, 0], len / (0.62 * s) / 1.1, 0.35);
  }
  b.reset();
  return { h: top + r, r };
}

function bush(b, R, s, lod, colors = P.FOLIAGE) {
  const col = R.pick(colors);
  b.pattern(PAT.LEAF, R()).color(col).sway(0.25);
  const center = [0, 0.6 * s, 0];
  puff(b, 0, 0.5 * s, 0, 0.85 * s, 1, R, center, 0.75);
  const n = lod ? R.int(3, 5) : 1;
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    puff(b, Math.cos(a) * 0.55 * s, R.range(0.5, 0.9) * s, Math.sin(a) * 0.55 * s, R.range(0.4, 0.6) * s, 1, R, center, 0.85, 0.45);
  }
  if (lod && R() < 0.4) {
    b.reset().color(R.pick(P.FLOWERS));
    for (let i = 0; i < 6; i++) {
      const a = R() * 6.28;
      b.sphere(Math.cos(a) * 0.8 * s, 0.7 * s + R() * 0.4 * s, Math.sin(a) * 0.8 * s, 0.1, 0.1, 0.1, 0);
    }
  }
  b.reset();
  return { h: 1.2 * s, r: s };
}

function bamboo(b, R, s, lod) {
  const n = lod ? R.int(7, 12) : 4;
  for (let i = 0; i < n; i++) {
    const x = R.range(-1.2, 1.2);
    const z = R.range(-1.2, 1.2);
    const H = R.range(5, 8) * s;
    b.reset().color(R.pick([0x8fbf4f, 0x7fb04a, 0x9cc85a])).sway(0.3);
    const lean = R.range(-0.3, 0.3);
    b.tube(x, -0.2, z, x + lean, H, z + lean * 0.5, 0.06, 0.05, 5);
    b.pattern(PAT.LEAF, R()).color(R.pick([0x6caa48, 0x5f9f40])).sway(0.8);
    puff(b, x + lean, H - 0.3, z + lean * 0.5, 0.8, lod ? 1 : 0, R, [x + lean, H - 0.8, z], 1.2);
  }
  b.reset();
  return { h: 7 * s, r: 1.5 };
}

export const SPECIES = {
  round: (b, R, s, lod) => roundTree(b, R, s, lod),
  fruit: (b, R, s, lod) => roundTree(b, R, s * 0.72, lod, { fruit: true, colors: [0x5f9f4a, 0x6cb04f] }),
  cherry: (b, R, s, lod) => roundTree(b, R, s * 0.85, lod, { blossom: true, colors: P.BLOSSOM }),
  autumn: (b, R, s, lod) => roundTree(b, R, s, lod, { colors: P.FOLIAGE_AUTUMN }),
  conifer,
  cypress,
  birch,
  willow,
  bush: (b, R, s, lod) => bush(b, R, s, lod),
  hedgeBush: (b, R, s, lod) => bush(b, R, s, lod, P.FOLIAGE_DARK),
  bamboo,
};

/** Build a tree at (s, u, h). Returns size info for colliders. */
export function buildTree(b, t, lod) {
  const R = rng(Math.floor(t.seed * 4294967295));
  b.placeMatrix(placementMatrix(t.s, t.u, t.h, R() * Math.PI * 2));
  b.identity().reset();
  const fn = SPECIES[t.species] || SPECIES.round;
  return fn(b, R, t.scale || 1, lod);
}
