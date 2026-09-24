import * as THREE from 'three';
import { R0, SECTORS, SECTOR_LEN, OMEGA, CIRC } from './core/config.js';
import { frameAt, ringToWorld } from './core/ring.js';
import { wrapS } from './core/math.js';
import { createMaterials, U } from './render/materials.js';
import { createSky, createExterior } from './render/sky.js';
import { Post } from './render/post.js';
import { Shadows } from './render/shadows.js';
import { Environment } from './render/environment.js';
import { SectorManager } from './world/manager.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { Life } from './life/life.js';
import { Grass } from './life/grass.js';
import { AudioScape } from './audio.js';

const QUALITY = {
  low: { scale: 0.75, msaa: 0, shadow: 1024, load: 12, lod: 110, grass: 0.5 },
  medium: { scale: 1.0, msaa: 4, shadow: 2048, load: 15, lod: 150, grass: 0.8 },
  high: { scale: 1.5, msaa: 4, shadow: 2048, load: 17, lod: 200, grass: 1.0 },
};

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const scene = new THREE.Scene();
scene.matrixWorldAutoUpdate = true;
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 3200);

const mats = createMaterials();
const sky = createSky();
scene.add(sky);
const exterior = createExterior();
scene.add(exterior.group);

let quality = QUALITY[params.get('q')] ? params.get('q') : localPref('quality', 'medium');
let Q = QUALITY[quality];
const manager = new SectorManager(scene, mats, { loadRadius: Q.load, highLodDist: Q.lod });
const player = new Player(manager);
const env = new Environment();
const shadows = new Shadows(renderer, Q.shadow, 95);
const post = new Post(renderer, { msaa: Q.msaa });
const input = new Input(canvas);
const hud = new Hud();
const life = new Life(scene, mats, manager);
const grass = new Grass(scene, mats);
const audio = new AudioScape();

function localPref(key, def) {
  try {
    return localStorage.getItem('torus.' + key) ?? def;
  } catch {
    return def;
  }
}
function savePref(key, v) {
  try {
    localStorage.setItem('torus.' + key, v);
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------- start spot
const start = {
  s: params.has('s') ? parseFloat(params.get('s')) : 78,
  u: params.has('u') ? parseFloat(params.get('u')) : -7,
  yaw: params.has('yaw') ? parseFloat(params.get('yaw')) : Math.PI,
};
if (params.has('t')) env.time = parseFloat(params.get('t'));
player.s = wrapS(start.s);
player.u = start.u;
player.yaw = start.yaw;
player.pitch = params.has('pitch') ? parseFloat(params.get('pitch')) : 0.08;

// ---------------------------------------------------------------- sizing
// Dynamic resolution: scale the render size to hold the frame rate.
let dynScale = 1;
let perfTime = 0;
let perfFrames = 0;
function adaptResolution(dt) {
  if (params.has('capture')) return;
  perfTime += dt;
  perfFrames++;
  if (perfTime < 2.5) return;
  const fps = perfFrames / perfTime;
  perfTime = 0;
  perfFrames = 0;
  const prev = dynScale;
  if (fps < 42) dynScale = Math.max(0.55, dynScale * 0.87);
  else if (fps > 57 && dynScale < 1) dynScale = Math.min(1, dynScale * 1.08);
  if (Math.abs(prev - dynScale) > 0.01) resize();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, Q.scale) * dynScale;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(buf.x, buf.y);
  sky.material.uniforms.uRes.value.set(buf.x, buf.y);
}
window.addEventListener('resize', resize);
resize();

function applyQuality(name) {
  quality = name;
  Q = QUALITY[name];
  savePref('quality', name);
  manager.loadRadius = Q.load;
  manager.unloadRadius = Q.load + 2;
  manager.highLodDist = Q.lod;
  shadows.setSize(Q.shadow);
  post.setMSAA(Q.msaa);
  grass.density = Q.grass;
  resize();
}
grass.density = Q.grass;

// ---------------------------------------------------------------- UI wiring
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');
const loadFill = document.getElementById('load-fill');
const loadText = document.getElementById('load-text');
const loading = document.getElementById('loading');
const resumeHint = document.getElementById('resume-hint');
const qualitySel = document.getElementById('quality');
const fovInput = document.getElementById('fov');
const dayLen = document.getElementById('daylen');
const invert = document.getElementById('invert');
qualitySel.value = quality;
fovInput.value = localPref('fov', '75');
camera.fov = parseFloat(fovInput.value);
invert.checked = localPref('invert', '0') === '1';
input.invertY = invert.checked;
dayLen.value = localPref('daylen', '48');
function applyDayLen() {
  const m = parseFloat(dayLen.value);
  if (m === 0) {
    env.paused = true;
  } else {
    env.paused = false;
    env.speed = 24 / (m * 60);
  }
}
applyDayLen();
qualitySel.addEventListener('change', () => applyQuality(qualitySel.value));
fovInput.addEventListener('input', () => {
  camera.fov = parseFloat(fovInput.value);
  camera.updateProjectionMatrix();
  savePref('fov', fovInput.value);
});
dayLen.addEventListener('change', () => {
  applyDayLen();
  savePref('daylen', dayLen.value);
});
invert.addEventListener('change', () => {
  input.invertY = invert.checked;
  savePref('invert', invert.checked ? '1' : '0');
});
for (const el of [qualitySel, fovInput, dayLen, invert]) el.addEventListener('click', (e) => e.stopPropagation());
document.querySelector('.panel').addEventListener('click', (e) => {
  if (e.target === startBtn) return;
  e.stopPropagation();
});

let ready = false;
let playing = false;

function enter() {
  if (!ready) return;
  playing = true;
  overlay.classList.add('hidden');
  hud.show(true);
  input.enabled = true;
  input.requestLock();
  audio.start();
}
startBtn.addEventListener('click', enter);
overlay.addEventListener('click', () => {
  if (ready && startBtn.classList.contains('hidden')) enter();
});
input.onLockChange = (locked) => {
  if (!locked && playing && !input.lockFailed) {
    playing = false;
    input.enabled = false;
    overlay.classList.remove('hidden');
    startBtn.classList.add('hidden');
    resumeHint.classList.remove('hidden');
  }
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && playing && input.lockFailed) {
    playing = false;
    input.enabled = false;
    overlay.classList.remove('hidden');
    startBtn.classList.add('hidden');
    resumeHint.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------- loop
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _sun = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _vp = new THREE.Matrix4();
let last = performance.now();
let elapsed = 0;
let placed = false;
let fpsAcc = 0;
let fpsN = 0;
window.__torus = { player, env, manager, camera, renderer, scene, input, life, stats: { fps: 0 } };

function handleKeys() {
  if (input.wasPressed('BracketRight')) {
    env.time = (env.time + 1) % 24;
    hud.toast(`Time ${env.clock}`);
  }
  if (input.wasPressed('BracketLeft')) {
    env.time = (env.time + 23) % 24;
    hud.toast(`Time ${env.clock}`);
  }
  if (input.wasPressed('KeyT')) {
    env.paused = !env.paused;
    hud.toast(env.paused ? 'Time paused' : 'Time running');
  }
  if (input.wasPressed('KeyH')) {
    hud.visible = !hud.visible;
    hud.show(hud.visible);
  }
  if (input.wasPressed('KeyM')) hud.toast(audio.toggleMute() ? 'Sound off' : 'Sound on');
  if (input.wasPressed('KeyF')) hud.toast(player.flying ? 'Walking' : 'Flying — Space/C for up/down');
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 1) {
    window.__torus.stats.fps = fpsN / fpsAcc;
    fpsAcc = 0;
    fpsN = 0;
  }

  if (!ready) {
    const done = manager.update(player.s, 40);
    const need = 2 * manager.loadRadius + 1;
    loadFill.style.width = `${Math.min(100, (manager.loadedCount / need) * 100)}%`;
    loadText.textContent = `Generating sector ${manager.loadedCount} of ${need}…`;
    if (done) {
      ready = true;
      loading.classList.add('hidden');
      startBtn.classList.remove('hidden');
      if (!placed) {
        player.place(player.s, player.u, player.yaw);
        placed = true;
      }
    }
  } else {
    if (playing) {
      handleKeys();
      const wasFlying = player.flying;
      player.update(dt, input, input.consumeLook());
      if (wasFlying !== player.flying) hud.toast(player.flying ? 'Flying — Space / C to rise and sink' : 'Walking');
    }
    manager.update(player.s, 5);
  }

  env.advance(dt);
  const envOut = env.apply(sky, exterior, post);
  U.uTime.value = elapsed;
  player.applyCamera(camera);

  frameAt(player.s, _up, _fwd, _lat);
  env.sunWorld(_up, _fwd, _lat, _sun);
  const su = sky.material.uniforms;
  _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  su.uInvViewProj.value.copy(_vp).invert();
  su.uCamUp.value.copy(_up);
  su.uSunWorld.value.copy(_sun);
  su.uStarRot.value = OMEGA * elapsed;
  exterior.uniforms.uCamTheta.value = player.s / R0;
  exterior.uniforms.uLoadRange.value = ((manager.loadRadius - 0.6) * SECTOR_LEN) / R0;

  if (ready) {
    life.update(dt, elapsed, player, env);
    grass.update(player, dt);
    audio.update(dt, player, env, life);
  }

  // shadows centred a little ahead of the player
  ringToWorld(player.s + Math.cos(player.yaw) * 25, player.u + Math.sin(player.yaw) * 25, player.h, _pos);
  shadows.update(scene, _pos, _sun, _fwd);

  renderer.setRenderTarget(post.scene);
  renderer.render(scene, camera);
  window.__torus.stats.calls = renderer.info.render.calls;
  window.__torus.stats.tris = renderer.info.render.triangles;
  post.render(camera, { exposure: envOut.exposure, bloom: envOut.bloom, fogDensity: U.uFogDensity.value, lineScale: Math.max(1, renderer.getPixelRatio()) });

  if (playing) {
    hud.update(dt, player, env);
    adaptResolution(dt);
  }
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export { CIRC, SECTORS };
