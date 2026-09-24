import * as THREE from 'three';
import { COMMON, FRAG_COMMON, MRT_OUT } from './shaders.js';
import { U } from './materials.js';
import { MeshBuilder, PAT } from '../geom/builder.js';
import { R0, TUBE_HC, TUBE_R, TUBE_TOP, SPOKES, WINDOW_HALF_ANGLE } from '../core/config.js';

// ---------------------------------------------------------------------------
// Background: stars (rotating once a minute in the habitat frame), the Milky
// Way, and the daylight glow that fills the skylight during the day.

const SKY_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
${COMMON}
${MRT_OUT}
uniform mat4 uInvViewProj;
uniform vec2 uRes;
uniform float uDay;
uniform float uStarRot;
uniform vec3 uCamUp;
uniform vec3 uSunWorld;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;

vec3 starLayer(vec3 d, float scale, float density, float size, float bright) {
  vec3 p = d * scale;
  vec3 id = floor(p);
  float h = hash13(id);
  if (h > density) return vec3(0.0);
  vec3 sp = id + 0.2 + 0.6 * vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.3));
  vec3 sd = normalize(sp);
  float ang = length(sd - d) * scale;
  float b = max(0.0, 1.0 - ang / size);
  b *= b;
  float t = hash13(id + 9.1);
  vec3 c = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.86, 0.7), t);
  return c * b * bright * (0.4 + 1.6 * hash13(id + 7.7));
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec4 w = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w - cameraPosition);
  float a = uStarRot;
  vec3 d = vec3(cos(a) * dir.x - sin(a) * dir.y, sin(a) * dir.x + cos(a) * dir.y, dir.z);
  vec3 mwN = normalize(vec3(0.35, 0.75, 0.55));
  float band = exp(-pow(dot(d, mwN) / 0.2, 2.0));
  float n = noise3d(d * 6.0) * 0.5 + noise3d(d * 13.0) * 0.3 + noise3d(d * 29.0) * 0.2;
  vec3 space = vec3(0.004, 0.006, 0.014);
  space += vec3(0.16, 0.13, 0.24) * band * smoothstep(0.35, 0.9, n) * 0.5;
  space += vec3(0.05, 0.03, 0.08) * smoothstep(0.55, 0.9, noise3d(d * 3.0 + 4.0));
  space += starLayer(d, 90.0, 0.07, 0.16, 1.6);
  space += starLayer(d, 160.0, 0.03 + band * 0.12, 0.25, 0.9);
  space += starLayer(d, 36.0, 0.05, 0.08, 4.0);
  float t = dot(dir, uCamUp);
  vec3 day = mix(uSkyHorizon, uSkyZenith, smoothstep(-0.1, 0.8, t));
  float g = max(dot(dir, uSunWorld), 0.0);
  day += uSunColor * (pow(g, 12.0) * 0.8 + pow(g, 3.0) * 0.15);
  vec3 col = mix(space, day, uDay);
  outColor = vec4(col, 1.0);
  outNormal = vec4(0.5, 0.5, 0.5, 0.0);
}
`;

export function createSky() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      ...U,
      uInvViewProj: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(1, 1) },
      uDay: { value: 1 },
      uStarRot: { value: 0 },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uSunWorld: { value: new THREE.Vector3(0, 1, 0) },
      uSkyZenith: { value: new THREE.Color(0.55, 0.78, 0.98) },
      uSkyHorizon: { value: new THREE.Color(0.85, 0.93, 1.0) },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

// ---------------------------------------------------------------------------
// Exterior: hub, spokes, mirror and the rest of the torus seen through the skylight.

const EXT_VERT = /* glsl */ `
${COMMON}
in vec4 color;
in vec4 aux;
out vec4 vColor;
out vec4 vAux;
out vec2 vUv;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vAux = aux;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const EXT_FRAG = /* glsl */ `
${COMMON}
${FRAG_COMMON}
${MRT_OUT}
in vec4 vColor;
in vec4 vAux;
in vec2 vUv;
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uExtSun;
uniform float uDay;
uniform vec3 uHaze;
uniform float uIsTorus;
uniform float uCamTheta;
uniform float uLoadRange;
uniform float uWindowHalf;

void main() {
  vec3 N = normalize(vNormal);
  vec3 base = srgb2lin(vColor.rgb);
  vec3 emit = vec3(0.0);
  float lineW = 0.6;
  if (uIsTorus > 0.5) {
    float th = vUv.x * 6.2831853;
    float dth = mod(th - uCamTheta + 3.14159265, 6.2831853) - 3.14159265;
    float phiTop = abs(vUv.y * 6.2831853 - 3.14159265);
    bool win = phiTop < uWindowHalf;
    if (win && abs(dth) < uLoadRange) discard;
    base = srgb2lin(vec3(0.78, 0.8, 0.82));
    vec2 q = vec2(th * 850.0 / 19.2, phiTop * 66.0 / 6.0);
    float line = max(gridLine(q.x, 0.03), gridLine(q.y, 0.04)) * patternFade(q);
    base *= 1.0 - 0.25 * line;
    if (win) {
      float bars = max(gridLine(q.x * 4.0, 0.08), gridLine(phiTop * 66.0 / 5.5, 0.1));
      vec3 dayWin = srgb2lin(vec3(0.82, 0.93, 1.0)) * 1.2;
      vec3 nightWin = vec3(0.5, 0.35, 0.18) * (0.3 + 0.7 * step(0.7, hash12(floor(q * vec2(2.0, 3.0)))));
      base = vec3(0.0);
      emit = mix(nightWin, dayWin, uDay) * (1.0 - 0.6 * bars);
    }
    // navigation lights
    float cellTh = th * 24.0 / 6.2831853;
    vec2 dm = vec2((fract(cellTh) - 0.5) * 6.2831853 * 850.0 / 24.0, (phiTop - 1.25) * 66.0);
    float nav = 1.0 - smoothstep(2.0, 3.2, length(dm));
    float blink = step(0.8, fract(uTime * 0.5 + floor(cellTh) * 0.37));
    emit += vec3(1.0, 0.3, 0.2) * nav * blink * 5.0;
  } else {
    int pat = int(vAux.x * 255.0 + 0.5);
    if (pat == 8 || pat == 15) emit = base * (0.6 + 3.0 * (1.0 - uDay));
    if (pat == 13) emit = base * 3.0 * step(0.5, fract(uTime * 0.7 + vAux.y * 7.0));
    if (pat == 9) emit = base * (0.1 + 1.4 * uDay);
    if (pat == 4) {
      vec2 q = vUv / vec2(4.0, 3.0);
      float line = max(gridLine(q.x, 0.02), gridLine(q.y, 0.03)) * patternFade(q);
      base *= 1.0 - 0.2 * line;
    }
  }
  float ndl = dot(N, uExtSun);
  float lit = smoothstep(0.0, 0.08, ndl);
  float hemi = 0.5 + 0.5 * dot(N, normalize(vec3(0.0, 0.0, 1.0)));
  vec3 amb = mix(vec3(0.03, 0.035, 0.05), vec3(0.08, 0.09, 0.12), hemi);
  vec3 col = base * (amb + vec3(1.0, 0.97, 0.92) * (lit * 1.05 + smoothstep(0.6, 0.66, ndl) * 0.15));
  col += emit;
  // seen through the bright skylight during the day, distant structure fades into haze
  float d = length(vWorld - cameraPosition);
  float haze = uDay * clamp(0.55 + d / 5000.0, 0.0, 0.85);
  col = mix(col, uHaze, haze);
  outColor = vec4(col, 1.0);
  outNormal = vec4(N * 0.5 + 0.5, lineW * (1.0 - haze));
}
`;

export function createExterior() {
  const group = new THREE.Group();
  const extUniforms = {
    uExtSun: { value: new THREE.Vector3(0.25, 0.35, 1).normalize() },
    uDay: { value: 1 },
    uHaze: { value: new THREE.Color(0.8, 0.9, 1.0) },
    uCamTheta: { value: 0 },
    uLoadRange: { value: 1 },
    uWindowHalf: { value: WINDOW_HALF_ANGLE },
  };
  const mk = (isTorus) =>
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: EXT_VERT,
      fragmentShader: EXT_FRAG,
      uniforms: { ...U, ...extUniforms, uIsTorus: { value: isTorus ? 1 : 0 } },
    });

  // Torus hull
  const tg = new THREE.TorusGeometry(R0 - TUBE_HC, TUBE_R + 0.6, 40, 480);
  const n = tg.getAttribute('position').count;
  tg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(1), 4));
  tg.setAttribute('aux', new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4));
  const torus = new THREE.Mesh(tg, mk(true));
  torus.frustumCulled = false;
  group.add(torus);

  // Hub, spokes, mirror
  const b = new MeshBuilder();
  b.identity().reset();
  const hubR = 42;
  b.color(0xdfe4e8).pattern(PAT.PANEL, 0.4);
  b.sphere(0, 0, 0, hubR, hubR, hubR * 0.9, 3);
  // axial cylinder (rotate so the builder's y axis maps to world z)
  b.push().rotateX(Math.PI / 2);
  b.color(0xcfd6db).cylinder(0, -120, 0, 20, 20, 240, 32);
  b.color(0xe9edf0).cylinder(0, -140, 0, 34, 30, 16, 32);
  b.cylinder(0, 124, 0, 30, 34, 16, 32);
  b.pattern(PAT.SKYLIGHT, 0.2).color(0xff5a4a);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.sphere(Math.cos(a) * 34.5, 132, Math.sin(a) * 34.5, 1.2, 1.2, 1.2, 1);
    b.sphere(Math.cos(a) * 34.5, -132, Math.sin(a) * 34.5, 1.2, 1.2, 1.2, 1);
  }
  b.reset().color(0xa9b3ba);
  // docking ring with antennas
  b.cylinder(0, -60, 0, 48, 48, 6, 48);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    b.tube(Math.cos(a) * 20, 100, Math.sin(a) * 20, Math.cos(a) * 28, 190, Math.sin(a) * 28, 1.2, 0.5, 6);
  }
  b.pop();
  // spokes
  const rOut = R0 - TUBE_TOP + 1;
  for (let k = 0; k < SPOKES; k++) {
    const th = (k / SPOKES) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    b.reset().color(0xd9e0e4).pattern(PAT.PANEL, 0.6);
    b.tube(c * (hubR - 4), s * (hubR - 4), 0, c * rOut, s * rOut, 0, 5.2, 5.2, 24, 'none');
    b.reset().color(0xf2f5f7);
    for (let r = hubR + 20; r < rOut - 10; r += 36) b.tube(c * r, s * r, 0, c * (r + 1.2), s * (r + 1.2), 0, 6.2, 6.2, 24, 'both');
    // cable stays
    b.color(0x9aa5ad);
    for (const dz of [-1, 1]) b.tube(c * (hubR + 10), s * (hubR + 10), dz * 60, c * (rOut - 30), s * (rOut - 30), dz * 4, 0.6, 0.6, 5);
    b.pattern(PAT.SKYLIGHT, k / 6).color(0xffffff);
    for (let r = hubR + 40; r < rOut; r += 72) b.sphere(c * r, s * r, 6.4, 0.9, 0.9, 0.9, 1);
  }
  // Primary mirror: a tilted disc floating above the hub along +Z
  b.reset();
  b.push().translate(0, 0, 980).rotateX(Math.PI / 4);
  b.color(0xbfd3e0).pattern(PAT.METAL, 0.9);
  b.cylinder(0, 0, 0, 520, 520, 6, 64);
  b.color(0x7d8b95);
  b.cylinder(0, -14, 0, 60, 60, 14, 24);
  b.pop();
  const ext = new THREE.Mesh(b.toGeometry(), mk(false));
  ext.frustumCulled = false;
  group.add(ext);
  return { group, uniforms: extUniforms };
}
