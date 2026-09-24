import { PAT } from './builder.js';
import { rng, noise3 } from '../core/math.js';
import { placementMatrix } from '../core/ring.js';
import * as P from './palette.js';
import { SPECIES } from './trees.js';

// Street furniture and small structures. Local frame: +y up, +z faces the
// river / viewer (see placement yaw in plan.js), origin on the ground.

function bench(b, R) {
  const wood = R.pick([P.WOOD, P.WOOD_LIGHT, 0x6f8f6a]);
  b.color(P.METAL_DARK);
  for (const x of [-0.7, 0.7]) {
    b.box(x, 0.22, 0.05, 0.07, 0.44, 0.5);
    b.box(x, 0.7, -0.22, 0.07, 0.6, 0.07);
  }
  b.color(wood).pattern(PAT.WOOD, 0.3);
  for (let i = 0; i < 3; i++) b.box(0, 0.47, -0.12 + i * 0.16, 1.7, 0.05, 0.13);
  b.push().translate(0, 0.78, -0.25).rotateX(-0.2);
  b.box(0, 0, 0, 1.7, 0.12, 0.05);
  b.box(0, 0.18, 0, 1.7, 0.12, 0.05);
  b.pop();
  b.reset();
}

export function lamp(b, kind = 'post', R = null) {
  if (kind === 'short') {
    b.color(P.METAL_DARK).cylinder(0, 0, 0, 0.12, 0.1, 0.9, 8);
    b.pattern(PAT.LAMP, 0).color(0xfff1c9).cylinder(0, 0.9, 0, 0.11, 0.11, 0.18, 8);
    b.reset().color(P.METAL_DARK).cylinder(0, 1.08, 0, 0.14, 0.02, 0.1, 8);
    return;
  }
  const style = R ? R.int(0, 1) : 0;
  b.color(P.METAL_DARK);
  b.cylinder(0, 0, 0, 0.14, 0.12, 0.4, 8);
  b.cylinder(0, 0.4, 0, 0.065, 0.05, 3.6, 8, { caps: 'none' });
  if (style === 0) {
    // shepherd's crook with hanging lantern
    b.tube(0, 3.95, 0, 0.35, 4.25, 0, 0.045, 0.04, 6);
    b.tube(0.35, 4.25, 0, 0.62, 4.1, 0, 0.04, 0.035, 6);
    b.cylinder(0.62, 3.72, 0, 0.18, 0.05, 0.38, 8);
    b.pattern(PAT.LAMP, 0).color(0xfff1c9);
    b.sphere(0.62, 3.62, 0, 0.16, 0.16, 0.16, 1);
    b.reset();
  } else {
    // globe
    b.pattern(PAT.LAMP, 0).color(0xfff1c9);
    b.sphere(0, 4.22, 0, 0.26, 0.26, 0.26, 2);
    b.reset().color(P.METAL_DARK);
    b.cylinder(0, 4.45, 0, 0.12, 0.02, 0.12, 8);
  }
}

function kiosk(b, R) {
  const wall = R.pick(P.WALLS);
  b.color(P.STONE).pattern(PAT.STONE, 0.4);
  b.bevelBox(0, 0.1, 0, 3.2, 0.4, 3.2, 0.6);
  b.reset().color(wall);
  b.bevelBox(0, 1.3, 0, 2.8, 2.4, 2.8, 0.55);
  b.pattern(PAT.GLASS, R()).color(0x9fc6d8).box(0, 1.5, 1.37, 1.6, 1.0, 0.1);
  b.reset().color(0xf7f1e6).box(0, 1.0, 1.55, 2.0, 0.08, 0.4);
  b.pattern(PAT.STRIPES, R()).color(R.pick(P.AWNINGS));
  b.quadFace(-1.2, 2.4, 1.4, 1.2, 2.4, 1.4, 1.2, 2.1, 2.2, -1.2, 2.1, 2.2);
  b.quadFace(1.2, 2.4, 1.4, -1.2, 2.4, 1.4, -1.2, 2.1, 2.2, 1.2, 2.1, 2.2);
  b.reset().color(R.pick(P.ROOFS));
  b.lathe(0, 2.5, 0, [[0.001, 0.75], [1.2, 0.4], [1.9, 0.0], [1.85, -0.08]].reverse(), 8, { angle0: Math.PI / 8 });
  b.color(P.METAL_DARK).cylinder(0, 3.2, 0, 0.05, 0.02, 0.6, 6);
}

function cafe(b, R) {
  const wall = R.pick(P.WALLS);
  b.color(P.STONE).pattern(PAT.STONE, 0.4).box(0, -0.2, 0, 5.4, 0.8, 4.6);
  b.reset().pattern(PAT.FACADE, R()).color(wall);
  b.bevelBox(0, 1.8, 0, 5.0, 3.2, 4.2, 0.2, { uv: 'facade', cell: 2.5, vOff: -0.2, topPattern: PAT.PLAIN, topColor: 0xcfc8bb });
  b.reset().pattern(PAT.GLASS, R()).color(0x9fc6d8).box(0, 1.35, 2.12, 3.6, 1.9, 0.1);
  b.reset().color(0xffffff).box(0, 3.45, 0, 5.3, 0.15, 4.5);
  b.pattern(PAT.STRIPES, R()).color(R.pick(P.AWNINGS));
  b.quadFace(-2.4, 2.9, 2.1, 2.4, 2.9, 2.1, 2.4, 2.35, 3.4, -2.4, 2.35, 3.4);
  b.quadFace(2.4, 2.9, 2.1, -2.4, 2.9, 2.1, -2.4, 2.35, 3.4, 2.4, 2.35, 3.4);
  b.reset().pattern(PAT.GLOW, 0).color(R.pick([0xffd27a, 0xff8f70, 0x8fd6ff])).box(0, 3.05, 2.14, 2.0, 0.3, 0.06);
  b.reset();
  b.color(P.METAL).box(1.8, 3.9, -1.0, 0.8, 0.7, 0.8);
}

function parasol(b, R) {
  b.color(P.METAL_DARK).cylinder(0, 0, 0, 0.3, 0.08, 0.05, 8);
  b.cylinder(0, 0, 0, 0.035, 0.035, 2.5, 6, { caps: 'none' });
  b.color(0xf4f1ea).cylinder(0, 0.72, 0, 0.45, 0.45, 0.04, 12);
  b.color(P.METAL_DARK).cylinder(0, 0, 0, 0.05, 0.05, 0.72, 6, { caps: 'none' });
  const cc = R.pick([0x4f7fa8, 0x5c8f7b, 0xa84a3c, 0xf1dd9a]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + R() * 0.5;
    const x = Math.cos(a) * 0.85;
    const z = Math.sin(a) * 0.85;
    b.color(cc).box(x, 0.45, z, 0.42, 0.06, 0.42);
    b.push().translate(x, 0, z).rotateY(-a);
    b.box(0.2, 0.7, 0, 0.05, 0.5, 0.4);
    b.color(P.METAL_DARK);
    b.box(0, 0.22, 0.17, 0.4, 0.44, 0.04);
    b.box(0, 0.22, -0.17, 0.4, 0.44, 0.04);
    b.pop();
  }
  b.pattern(PAT.STRIPES, R()).color(R.pick(P.AWNINGS));
  const prof = [[1.45, -0.28], [1.5, -0.2], [0.001, 0.35]];
  b.lathe(0, 2.3, 0, prof, 8, { angle0: R() });
  // underside
  b.color(0xefe6d8).pattern(PAT.PLAIN);
  b.lathe(0, 2.28, 0, [[0.001, 0.33], [1.45, -0.28]], 8);
  b.reset();
}

function pavilion(b, R) {
  const n = R.pick([6, 8]);
  const r = 2.6;
  b.color(P.STONE).pattern(PAT.PAVING, 0.3);
  b.cylinder(0, -0.4, 0, r + 0.5, r + 0.4, 0.7, n * 2, { angle0: Math.PI / n });
  b.reset().color(0xf7f1e6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    b.cylinder(Math.cos(a) * r, 0.3, Math.sin(a) * r, 0.14, 0.12, 2.8, 8);
  }
  b.cylinder(0, 3.0, 0, r + 0.25, r + 0.25, 0.3, n * 2, { angle0: Math.PI / n });
  const rc = R.pick([0x6f9e8a, 0x5f7a8c, 0xc9674a, 0xf4f1ea]);
  b.color(rc).pattern(PAT.ROOF, 0.4);
  b.lathe(0, 3.3, 0, [[r + 0.7, -0.15], [r * 0.6, 0.9], [0.4, 1.7], [0.001, 1.9]], n * 2);
  b.reset().color(0xe9e2d4).lathe(0, 3.28, 0, [[0.001, 0.02], [r + 0.7, -0.17]], n * 2);
  b.color(P.METAL_DARK).cylinder(0, 5.1, 0, 0.06, 0.02, 0.6, 6);
  // bench ring
  b.color(P.WOOD).pattern(PAT.WOOD, 0.3);
  for (let i = 0; i < n; i++) {
    if (i === 0) continue;
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const rr = r - 0.35;
    b.push().translate(Math.cos(am) * rr, 0, Math.sin(am) * rr).rotateY(-am + Math.PI / 2);
    b.box(0, 0.75, 0, 2 * rr * Math.sin(Math.PI / n) - 0.3, 0.07, 0.4);
    b.pop();
  }
  b.reset();
}

function playground(b, R) {
  // swing set
  const c1 = R.pick([0xe0533d, 0x3f86c6, 0xe8b230, 0x3f9e7a]);
  b.color(c1);
  for (const x of [-1.5, 1.5]) {
    b.tube(x, 0, -0.9, x, 2.3, 0, 0.06, 0.06, 6);
    b.tube(x, 0, 0.9, x, 2.3, 0, 0.06, 0.06, 6);
  }
  b.tube(-1.6, 2.3, 0, 1.6, 2.3, 0, 0.07, 0.07, 6);
  b.color(P.METAL_DARK);
  for (const x of [-0.7, 0.7]) {
    b.box(x - 0.2, 1.6, 0, 0.02, 1.4, 0.02);
    b.box(x + 0.2, 1.6, 0, 0.02, 1.4, 0.02);
    b.color(R.pick(P.AWNINGS)).box(x, 0.88, 0, 0.5, 0.05, 0.22);
    b.color(P.METAL_DARK);
  }
  // slide
  b.push().translate(3.2, 0, 0);
  const c2 = R.pick([0xe0533d, 0x3f86c6, 0xe8b230]);
  b.color(P.WOOD_LIGHT);
  for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) b.box(x, 0.9, z - 1.2, 0.1, 1.8, 0.1);
  b.box(0, 1.5, -1.2, 1.0, 0.1, 1.0);
  b.color(c2);
  b.quadFace(-0.35, 1.55, -0.7, 0.35, 1.55, -0.7, 0.35, 0.2, 1.5, -0.35, 0.2, 1.5);
  b.quadFace(0.35, 1.5, -0.7, -0.35, 1.5, -0.7, -0.35, 0.15, 1.5, 0.35, 0.15, 1.5);
  b.box(-0.37, 0.95, 0.4, 0.05, 0.3, 2.5);
  b.box(0.37, 0.95, 0.4, 0.05, 0.3, 2.5);
  b.pop();
  // sandbox
  b.color(P.WOOD).box(-3.2, 0.1, 0, 2.2, 0.3, 0.15);
  b.box(-3.2, 0.1, 1.0, 2.2, 0.3, 0.15);
  b.box(-4.25, 0.1, 0.5, 0.15, 0.3, 1.0);
  b.box(-2.15, 0.1, 0.5, 0.15, 0.3, 1.0);
  b.color(0xe8d6a0).box(-3.2, 0.1, 0.5, 2.0, 0.22, 0.9);
}

function sculpture(b, R) {
  b.color(P.STONE).pattern(PAT.STONE, 0.5).box(0, 0.4, 0, 1.6, 0.8, 1.6);
  b.reset();
  const kind = R.int(0, 3);
  const col = R.pick([0xd9a441, 0xc0c8cc, 0xb4533c, 0x3f86c6, 0xf4f1ea]);
  b.color(col).pattern(PAT.METAL, 0.2);
  if (kind === 0) {
    // ring
    const segs = 28;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      b.tube(Math.cos(a0) * 1.3, 2.3 + Math.sin(a0) * 1.3, 0, Math.cos(a1) * 1.3, 2.3 + Math.sin(a1) * 1.3, 0, 0.18, 0.18, 8);
    }
    b.sphere(0, 2.3, 0, 0.35, 0.35, 0.35, 2);
  } else if (kind === 1) {
    let y = 0.8;
    for (let i = 0; i < 4; i++) {
      const r = 0.55 - i * 0.08;
      b.sphere(R.range(-0.15, 0.15), y + r, R.range(-0.15, 0.15), r, r * 0.9, r, 2);
      y += r * 1.8;
    }
  } else if (kind === 2) {
    let y = 0.8;
    for (let i = 0; i < 6; i++) {
      b.push().translate(0, y + 0.2, 0).rotateY(i * 0.35);
      b.box(0, 0, 0, 1.0 - i * 0.08, 0.4, 0.3);
      b.pop();
      y += 0.42;
    }
  } else {
    // armillary: three rings
    for (let k = 0; k < 3; k++) {
      b.push().translate(0, 2.2, 0).rotateY(k * 1.05).rotateX(0.5 + k * 0.4);
      const segs = 24;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        b.tube(Math.cos(a0) * 1.1, Math.sin(a0) * 1.1, 0, Math.cos(a1) * 1.1, Math.sin(a1) * 1.1, 0, 0.06, 0.06, 5);
      }
      b.pop();
    }
    b.tube(0, 0.8, 0, 0, 2.2, 0, 0.08, 0.08, 6);
  }
  b.reset();
}

function fountain(b, R) {
  // Basin
  b.color(P.STONE).pattern(PAT.STONE, 0.6);
  const prof = [[3.2, -0.3], [3.45, 0.0], [3.45, 0.75], [3.1, 0.85], [2.95, 0.6], [2.95, 0.2]];
  b.lathe(0, 0, 0, prof, 32);
  b.cylinder(0, -0.3, 0, 3.0, 3.0, 0.5, 32, { caps: 'top' });
  // central tiers
  const tiers = R.int(2, 3);
  let y = 0.2;
  for (let i = 0; i < tiers; i++) {
    const r = 1.5 - i * 0.45;
    b.cylinder(0, y, 0, 0.35 - i * 0.07, 0.25 - i * 0.05, 0.9, 12);
    y += 0.9;
    b.lathe(0, y, 0, [[0.2, -0.1], [r, 0.05], [r, 0.25], [r - 0.12, 0.25], [0.3, 0.1]], 24);
    y += 0.2;
  }
  b.sphere(0, y + 0.2, 0, 0.25, 0.25, 0.25, 1);
  b.reset();
  return y;
}

function flowerbed(b, R) {
  const w = R.range(2.0, 3.2);
  const d = R.range(1.0, 1.6);
  b.color(P.STONE).pattern(PAT.STONE, 0.4).bevelBox(0, 0.05, 0, w, 0.5, d, 0.3);
  b.reset().color(0x6b4a33).box(0, 0.31, 0, w - 0.3, 0.04, d - 0.3);
  const cols = [R.pick(P.FLOWERS), R.pick(P.FLOWERS)];
  for (let i = 0; i < 14; i++) {
    const x = R.range(-w / 2 + 0.3, w / 2 - 0.3);
    const z = R.range(-d / 2 + 0.3, d / 2 - 0.3);
    b.pattern(PAT.LEAF, R()).color(R.pick(P.FOLIAGE)).sway(0.3);
    b.sphere(x, 0.45, z, 0.2, 0.16, 0.2, 0);
    b.reset().color(R.pick(cols)).sway(0.4);
    b.sphere(x, 0.62, z, 0.12, 0.1, 0.12, 0);
  }
  b.reset();
}

function plot(b, R) {
  b.color(P.WOOD).pattern(PAT.WOOD, 0.5);
  b.box(0, 0.15, -0.6, 2.4, 0.3, 0.1);
  b.box(0, 0.15, 0.6, 2.4, 0.3, 0.1);
  b.box(-1.2, 0.15, 0, 0.1, 0.3, 1.3);
  b.box(1.2, 0.15, 0, 0.1, 0.3, 1.3);
  b.reset().color(0x5d4230).box(0, 0.24, 0, 2.3, 0.08, 1.1);
  const veg = R.pick([0x6cb04f, 0x8fc45c, 0x4f944a]);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 6; j++) {
      b.pattern(PAT.LEAF, R()).color(veg).sway(0.2);
      b.sphere(-0.95 + j * 0.38, 0.38, -0.35 + i * 0.35, 0.14, 0.12, 0.14, 0);
    }
  }
  if (R() < 0.5) {
    b.reset().color(R.pick([0xe8452c, 0xf29b2c]));
    for (let j = 0; j < 5; j++) b.sphere(-0.8 + j * 0.4, 0.5, 0.35, 0.07, 0.07, 0.07, 0);
  }
  b.reset();
}

function boathouse(b, R) {
  b.color(P.WOOD).pattern(PAT.WOOD, 0.6);
  b.box(0, 1.5, 0, 4.8, 3.0, 4.0);
  b.reset();
  b.color(0xf4f1ea).box(0, 1.3, 2.02, 2.2, 2.4, 0.06);
  b.color(0x4f7fa8).box(0, 1.3, 2.05, 1.9, 2.2, 0.05);
  b.pattern(PAT.ROOF, 0.2).color(R.pick([0x5f7a8c, 0x8a6f60, 0x6f9e8a]));
  b.quadFace(-2.7, 3.0, 2.3, 2.7, 3.0, 2.3, 2.7, 4.4, 0, -2.7, 4.4, 0);
  b.quadFace(2.7, 3.0, -2.3, -2.7, 3.0, -2.3, -2.7, 4.4, 0, 2.7, 4.4, 0);
  b.reset().color(P.WOOD);
  for (const sx of [-1, 1]) {
    const x = sx * 2.4;
    const i0 = b.vert(x, 3.0, sx * 2.0, sx, 0, 0);
    const i1 = b.vert(x, 3.0, -sx * 2.0, sx, 0, 0);
    const i2 = b.vert(x, 4.4, 0, sx, 0, 0);
    b.tri(i0, i1, i2);
  }
  b.reset();
}

function jetty(b, R, len) {
  b.color(P.WOOD_LIGHT).pattern(PAT.WOOD, 0.2);
  b.box(0, 0.1, len / 2 - 0.5, 1.6, 0.12, len);
  b.reset().color(P.WOOD);
  for (let z = 0; z <= len - 0.5; z += 1.8) {
    for (const x of [-0.7, 0.7]) b.cylinder(x, -1.8, z, 0.09, 0.09, 2.2, 6);
  }
  b.cylinder(0.75, 0, len - 0.7, 0.1, 0.1, 0.7, 6);
}

function rowboat(b, R) {
  const col = R.pick([0xf4f1ea, 0xd9534f, 0x4f86c6, 0x3f9e7a, 0xe8b230]);
  b.color(col);
  b.push().translate(0, 0.1, 0).rotateX(Math.PI).scale(0.75, 0.55, 1.9);
  b.dome(0, 0, 0, 1, 1, 12, 4);
  b.pop();
  b.color(P.WOOD_LIGHT).pattern(PAT.WOOD, 0.1);
  b.box(0, 0.05, 0, 1.3, 0.06, 3.3);
  b.box(0, 0.25, -0.4, 1.2, 0.06, 0.3);
  b.box(0, 0.25, 0.7, 1.2, 0.06, 0.3);
  b.reset();
}

function barn(b, R) {
  const col = R.pick([0xb4533c, 0xa84a3c, 0x8a5a44, 0xd6c7a8]);
  b.color(P.STONE).pattern(PAT.STONE, 0.3).box(0, -0.3, 0, 7.4, 0.8, 6.0);
  b.reset().color(col).pattern(PAT.WOOD, 0.7);
  b.box(0, 1.9, 0, 7.0, 3.6, 5.6);
  b.reset().color(0xf4f1ea);
  b.box(0, 1.5, 2.82, 2.6, 3.0, 0.06);
  b.color(col).box(0, 1.45, 2.85, 2.3, 2.8, 0.05);
  b.color(0xf4f1ea);
  b.box(0, 1.45, 2.88, 0.12, 2.8, 0.03);
  const i0 = b.vert(-3.5, 3.7, 2.8, 0, 0, 1);
  const i1 = b.vert(3.5, 3.7, 2.8, 0, 0, 1);
  const i2 = b.vert(0, 6.0, 2.8, 0, 0, 1);
  b.color(col).tri(i0, i1, i2);
  const j0 = b.vert(3.5, 3.7, -2.8, 0, 0, -1);
  const j1 = b.vert(-3.5, 3.7, -2.8, 0, 0, -1);
  const j2 = b.vert(0, 6.0, -2.8, 0, 0, -1);
  b.tri(j0, j1, j2);
  b.pattern(PAT.ROOF, 0.5).color(R.pick([0x5f6a70, 0x7d8b99, 0x8a6f60]));
  b.quadFace(3.8, 3.5, 3.1, 3.8, 3.5, -3.1, 0, 6.1, -3.1, 0, 6.1, 3.1);
  b.quadFace(-3.8, 3.5, -3.1, -3.8, 3.5, 3.1, 0, 6.1, 3.1, 0, 6.1, -3.1);
  b.reset().color(0xb8ab98);
  b.quadFace(3.8, 3.45, -3.1, 3.8, 3.45, 3.1, 0, 6.05, 3.1, 0, 6.05, -3.1);
  b.quadFace(-3.8, 3.45, 3.1, -3.8, 3.45, -3.1, 0, 6.05, -3.1, 0, 6.05, 3.1);
  // silo
  b.color(0xc9d3d8).pattern(PAT.METAL, 0.3);
  b.cylinder(4.6, 0, -1.5, 1.3, 1.3, 7.0, 16, { caps: 'none' });
  b.dome(4.6, 7.0, -1.5, 1.35, 0.9, 16, 4);
  b.reset();
}

function greenhouse(b, R, len, wid) {
  // Barrel vault along local z (which follows +s for yaw 0)
  const segs = 10;
  const r = wid / 2;
  const rise = Math.min(2.8, r * 1.1);
  const hz = len / 2;
  b.color(P.STONE).box(0, 0.1, 0, wid + 0.2, 0.3, len + 0.2);
  b.pattern(PAT.GREENHOUSE, R()).color(0xcfe9ef);
  let prev = null;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    const x = Math.cos(a) * r;
    const y = 0.25 + Math.sin(a) * rise;
    const i0 = b.vert(x, y, hz, Math.cos(a) / r, Math.sin(a) / rise, 0, (i / segs) * Math.PI * r, 0);
    const i1 = b.vert(x, y, -hz, Math.cos(a) / r, Math.sin(a) / rise, 0, (i / segs) * Math.PI * r, len);
    if (prev) {
      b.tri(prev[0], i1, i0);
      b.tri(prev[0], prev[1], i1);
    }
    prev = [i0, i1];
  }
  for (const sz of [-1, 1]) {
    const c = b.vert(0, 0.25, sz * hz, 0, 0, sz, 0, 0);
    const ids = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI;
      ids.push(b.vert(Math.cos(a) * r, 0.25 + Math.sin(a) * rise, sz * hz, 0, 0, sz, Math.cos(a) * r, Math.sin(a) * rise));
    }
    for (let i = 0; i < segs; i++) {
      if (sz > 0) b.tri(c, ids[i], ids[i + 1]);
      else b.tri(c, ids[i + 1], ids[i]);
    }
  }
  b.reset().color(0xf4f4f4);
  // ribs
  for (let z = -hz; z <= hz + 0.01; z += len / Math.max(2, Math.round(len / 2.4))) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI;
      const a1 = ((i + 1) / segs) * Math.PI;
      b.tube(Math.cos(a0) * (r + 0.03), 0.25 + Math.sin(a0) * (rise + 0.03), z, Math.cos(a1) * (r + 0.03), 0.25 + Math.sin(a1) * (rise + 0.03), z, 0.05, 0.05, 4);
    }
  }
  // plants inside (visible through the "glass" pattern tint)
  b.pattern(PAT.LEAF, R()).color(R.pick([0x6cb04f, 0x8fc45c])).sway(0.1);
  for (let z = -hz + 1; z < hz - 0.5; z += 1.3) {
    for (const x of [-r * 0.5, r * 0.5]) b.sphere(x, 0.6, z, 0.4, 0.35, 0.5, 0);
  }
  b.reset();
}

function shed(b, R) {
  const col = R.pick([P.WOOD, 0x6f8f6a, 0x8a6f60, 0xb4533c]);
  b.color(col).pattern(PAT.WOOD, 0.5).box(0, 1.1, 0, 3.6, 2.4, 2.8);
  b.reset().color(0x5f6a70).pattern(PAT.ROOF, 0.2);
  b.quadFace(-2.0, 2.3, 1.7, 2.0, 2.3, 1.7, 2.0, 2.9, -1.7, -2.0, 2.9, -1.7);
  b.reset().color(0x3f4a58).box(0.6, 1.0, 1.42, 1.0, 1.9, 0.05);
}

function haybale(b) {
  b.color(0xe8c870).pattern(PAT.WOOD, 0.95);
  b.push().translate(0, 0.62, 0).rotateZ(Math.PI / 2);
  b.cylinder(0, -0.7, 0, 0.62, 0.62, 1.4, 14);
  b.pop();
  b.reset();
}

function rock(b, R, scale = 1) {
  const seed = R() * 100;
  b.color(R.pick([0xa7a197, 0x9a948a, 0xb3aca0, 0x8f8a80])).pattern(PAT.STONE, 0.9);
  b.sphere(0, 0.25 * scale, 0, 0.9 * scale, 0.6 * scale, 0.75 * scale, 1, (x, y, z) => 1 + 0.28 * noise3(x * 1.3 + seed, y * 1.3, z * 1.3));
  b.reset();
}

function lookout(b, R) {
  b.color(P.WOOD).pattern(PAT.WOOD, 0.4);
  const H = 6.5;
  for (const x of [-1.1, 1.1]) for (const z of [-1.1, 1.1]) b.tube(x * 1.2, 0, z * 1.2, x, H, z, 0.12, 0.1, 6);
  b.box(0, H, 0, 3.0, 0.2, 3.0);
  for (const [x, z, w, d] of [[0, 1.45, 3, 0.08], [0, -1.45, 3, 0.08], [1.45, 0, 0.08, 3], [-1.45, 0, 0.08, 3]]) b.box(x, H + 0.55, z, w, 0.9, d);
  for (const x of [-1.4, 1.4]) for (const z of [-1.4, 1.4]) b.box(x, H + 1.3, z, 0.1, 2.4, 0.1);
  b.pattern(PAT.ROOF, 0.2).color(0x6f5a4a);
  b.lathe(0, H + 2.5, 0, [[2.3, -0.1], [0.001, 1.3]], 4, { angle0: Math.PI / 4 });
  b.reset();
  // ladder
  b.color(P.WOOD_LIGHT);
  b.tube(-0.3, 0, 2.2, -0.3, H, 1.4, 0.05, 0.05, 4);
  b.tube(0.3, 0, 2.2, 0.3, H, 1.4, 0.05, 0.05, 4);
  for (let y = 0.4; y < H; y += 0.45) b.box(0, y, 2.2 - (y / H) * 0.8, 0.6, 0.05, 0.06);
}

function teahouse(b, R) {
  b.color(P.STONE_DARK).pattern(PAT.STONE, 0.7).box(0, 0.2, 0, 5.4, 0.8, 5.4);
  b.reset().color(0x8a5a44).pattern(PAT.WOOD, 0.3);
  for (const x of [-2.2, 2.2]) for (const z of [-2.2, 2.2]) b.box(x, 1.8, z, 0.22, 2.6, 0.22);
  b.reset().color(0xf4efe4);
  b.box(0, 1.7, -2.15, 4.2, 2.2, 0.08);
  b.box(-2.15, 1.7, 0, 0.08, 2.2, 4.2);
  b.box(2.15, 1.7, 0, 0.08, 2.2, 4.2);
  b.color(0x8a5a44);
  for (let x = -1.8; x <= 1.9; x += 0.6) b.box(x, 1.7, -2.1, 0.05, 2.2, 0.08);
  b.pattern(PAT.ROOF, 0.6).color(0x4f5a60);
  b.lathe(0, 3.1, 0, [[4.2, 0.25], [3.6, 0.05], [2.4, 0.7], [0.8, 1.6], [0.001, 1.8]], 4, { angle0: Math.PI / 4 });
  b.reset().color(0x3f3a36).lathe(0, 3.08, 0, [[0.001, 0.02], [4.2, 0.23]], 4, { angle0: Math.PI / 4 });
  b.pattern(PAT.LAMP, 0).color(0xffb37a);
  b.sphere(2.6, 2.6, 2.6, 0.22, 0.3, 0.22, 1);
  b.sphere(-2.6, 2.6, 2.6, 0.22, 0.3, 0.22, 1);
  b.reset();
}

function stoneLantern(b) {
  b.color(0xa7a197).pattern(PAT.STONE, 0.8);
  b.box(0, 0.08, 0, 0.6, 0.16, 0.6);
  b.cylinder(0, 0.16, 0, 0.12, 0.12, 0.65, 6);
  b.box(0, 0.86, 0, 0.5, 0.1, 0.5);
  b.pattern(PAT.LAMP, 0).color(0xffc98a).box(0, 1.06, 0, 0.34, 0.3, 0.34);
  b.reset().color(0xa7a197).pattern(PAT.STONE, 0.8);
  b.lathe(0, 1.21, 0, [[0.45, 0.0], [0.001, 0.28]], 4, { angle0: Math.PI / 4 });
  b.reset();
}

function beehive(b, R) {
  b.color(P.WOOD).box(0, 0.2, 0, 0.6, 0.4, 0.6);
  const c = R.pick([0xf4f1ea, 0xf1dd9a, 0xb9d7e6]);
  b.color(c).pattern(PAT.WOOD, 0.1);
  for (let i = 0; i < 3; i++) b.box(0, 0.55 + i * 0.3, 0, 0.55, 0.27, 0.5);
  b.reset().color(0x7d8b99).box(0, 1.37, 0, 0.7, 0.08, 0.65);
}

function picnic(b, R) {
  const col = R.pick([P.WOOD, P.WOOD_LIGHT]);
  b.color(col).pattern(PAT.WOOD, 0.2);
  b.box(0, 0.75, 0, 1.9, 0.06, 0.8);
  for (const z of [-0.65, 0.65]) b.box(0, 0.45, z, 1.9, 0.05, 0.28);
  b.reset().color(P.WOOD);
  for (const x of [-0.7, 0.7]) {
    b.box(x, 0.37, 0, 0.08, 0.08, 1.6);
    b.tube(x, 0, -0.6, x, 0.74, 0, 0.04, 0.04, 4);
    b.tube(x, 0, 0.6, x, 0.74, 0, 0.04, 0.04, 4);
  }
}

function wildflowers(b, R, spread) {
  for (let i = 0; i < 70; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * spread;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d * 1.6;
    b.color(R.pick(P.FLOWERS)).sway(0.4);
    b.sphere(x, 0.35 + R() * 0.2, z, 0.09, 0.07, 0.09, 0);
  }
  b.reset();
}

function reeds(b, R) {
  for (let i = 0; i < 16; i++) {
    const x = R.range(-1.5, 1.5);
    const z = R.range(-1.5, 1.5);
    const h = R.range(1.0, 1.9);
    b.color(R.pick([0x7fa24a, 0x8fb257, 0x6c9444])).sway(0.7);
    b.tube(x, -0.2, z, x + R.range(-0.15, 0.15), h, z + R.range(-0.15, 0.15), 0.035, 0.012, 3);
    if (R() < 0.4) {
      b.color(0x6b4a33);
      b.cylinder(x, h - 0.45, z, 0.06, 0.06, 0.3, 5);
    }
  }
  b.reset();
}

function stall(b, R) {
  const col = R.pick(P.AWNINGS);
  b.color(P.WOOD_LIGHT).pattern(PAT.WOOD, 0.3);
  b.box(0, 0.5, 0.4, 2.4, 1.0, 0.8);
  b.reset().color(P.WOOD);
  for (const x of [-1.2, 1.2]) for (const z of [-0.6, 0.8]) b.box(x, 1.2, z, 0.08, 2.4, 0.08);
  b.pattern(PAT.STRIPES, R()).color(col);
  b.quadFace(-1.35, 2.5, -0.8, 1.35, 2.5, -0.8, 1.35, 2.1, 1.3, -1.35, 2.1, 1.3);
  b.quadFace(1.35, 2.5, -0.8, -1.35, 2.5, -0.8, -1.35, 2.1, 1.3, 1.35, 2.1, 1.3);
  b.reset();
  // produce crates
  for (let i = 0; i < 4; i++) {
    const x = -0.9 + i * 0.6;
    b.color(P.WOOD).box(x, 1.08, 0.45, 0.5, 0.16, 0.5);
    b.color(R.pick([...P.FRUIT, 0x6cb04f, 0xf1dd9a, 0x9b7bd8]));
    for (let j = 0; j < 4; j++) b.sphere(x - 0.12 + (j % 2) * 0.24, 1.22, 0.33 + Math.floor(j / 2) * 0.24, 0.1, 0.09, 0.1, 0);
  }
  b.reset();
}

function planterTree(b, R) {
  b.color(P.STONE).pattern(PAT.STONE, 0.3);
  b.lathe(0, 0, 0, [[1.1, 0.0], [1.2, 0.6], [1.0, 0.65]], 16);
  b.reset().color(0x5d4230).cylinder(0, 0.45, 0, 1.0, 1.0, 0.15, 16, { caps: 'top' });
  b.push();
  SPECIES.round(b, R, 0.7, true);
  b.pop();
  b.reset();
}

/** Build a planned prop. Returns an optional collider top height. */
export function buildProp(b, p, lod = true) {
  const R = rng(Math.floor((p.seed || 0.5) * 4294967295));
  b.placeMatrix(placementMatrix(p.s, p.u, p.h, p.yaw || 0));
  b.identity().reset();
  switch (p.kind) {
    case 'bench': bench(b, R); break;
    case 'kiosk': kiosk(b, R); break;
    case 'cafe': cafe(b, R); break;
    case 'parasol': parasol(b, R); break;
    case 'pavilion': pavilion(b, R); break;
    case 'playground': playground(b, R); break;
    case 'sculpture': sculpture(b, R); break;
    case 'fountain': fountain(b, R); break;
    case 'flowerbed': flowerbed(b, R); break;
    case 'plot': plot(b, R); break;
    case 'boathouse': boathouse(b, R); break;
    case 'jetty': jetty(b, R, p.len || 6); break;
    case 'rowboat': rowboat(b, R); break;
    case 'barn': barn(b, R); break;
    case 'greenhouse': greenhouse(b, R, p.len || 9, p.wid || 5); break;
    case 'shed': shed(b, R); break;
    case 'haybale': haybale(b, R); break;
    case 'rock': rock(b, R, p.scale || 1); break;
    case 'lookout': lookout(b, R); break;
    case 'bamboo': SPECIES.bamboo(b, R, 1, lod); break;
    case 'teahouse': teahouse(b, R); break;
    case 'lantern': stoneLantern(b, R); break;
    case 'beehive': beehive(b, R); break;
    case 'picnic': picnic(b, R); break;
    case 'wildflowers': wildflowers(b, R, p.spread || 3); break;
    case 'reeds': reeds(b, R); break;
    case 'stall': stall(b, R); break;
    case 'planterTree': planterTree(b, R); break;
    default: break;
  }
  b.reset();
}
