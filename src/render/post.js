import * as THREE from 'three';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

// Post-processing: ink outlines from depth + normals, bloom, tone mapping.

const FS_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
void main() {
  vec3 c = vec3(0.0);
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(max(c.r, c.g), c.b);
  float k = smoothstep(uThreshold, uThreshold + 0.6, l);
  fragColor = vec4(min(c * k, vec3(24.0)), 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  fragColor = vec4(c / 8.0, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tSrc;
uniform sampler2D tAdd;
uniform vec2 uTexel;
void main() {
  vec3 c = vec3(0.0);
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
  c += texture(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
  c += texture(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  fragColor = vec4(c / 12.0 + texture(tAdd, vUv).rgb, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uFogDensity;
uniform float uExposure;
uniform float uBloom;
uniform float uOutline;
uniform float uLineScale;
uniform float uSaturation;
uniform vec3 uInk;
uniform float uTime;

float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 lin2srgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 col = texture(tColor, vUv).rgb;
  float dRaw = texture(tDepth, vUv).r;
  vec4 nw = texture(tNormal, vUv);
  float edge = 0.0;
  if (dRaw < 1.0 && uOutline > 0.0) {
    vec2 o = uTexel * uLineScale;
    float d0 = linDepth(dRaw);
    float iz0 = 1.0 / d0;
    float izL = 1.0 / linDepth(texture(tDepth, vUv - vec2(o.x, 0.0)).r);
    float izR = 1.0 / linDepth(texture(tDepth, vUv + vec2(o.x, 0.0)).r);
    float izD = 1.0 / linDepth(texture(tDepth, vUv - vec2(0.0, o.y)).r);
    float izU = 1.0 / linDepth(texture(tDepth, vUv + vec2(0.0, o.y)).r);
    float lap = max(2.0 * iz0 - izL - izR, 2.0 * iz0 - izD - izU) / iz0;
    float depthEdge = smoothstep(0.012, 0.03, lap);
    vec3 n0 = nw.xyz * 2.0 - 1.0;
    vec4 aL = texture(tNormal, vUv - vec2(o.x, 0.0));
    vec4 aR = texture(tNormal, vUv + vec2(o.x, 0.0));
    vec4 aD = texture(tNormal, vUv - vec2(0.0, o.y));
    vec4 aU = texture(tNormal, vUv + vec2(0.0, o.y));
    float nd = 0.0;
    nd = max(nd, (1.0 - dot(n0, aL.xyz * 2.0 - 1.0)) * aL.a);
    nd = max(nd, (1.0 - dot(n0, aR.xyz * 2.0 - 1.0)) * aR.a);
    nd = max(nd, (1.0 - dot(n0, aD.xyz * 2.0 - 1.0)) * aD.a);
    nd = max(nd, (1.0 - dot(n0, aU.xyz * 2.0 - 1.0)) * aU.a);
    float normalEdge = smoothstep(0.22, 0.4, nd);
    float fog = 1.0 - exp(-d0 * uFogDensity);
    float fade = (1.0 - smoothstep(0.25, 0.6, fog)) * (1.0 - smoothstep(180.0, 700.0, d0) * 0.6);
    edge = max(depthEdge, normalEdge) * nw.a * fade * uOutline;
  }
  col = mix(col, col * 0.28 + uInk * 0.02, clamp(edge, 0.0, 1.0));
  col += texture(tBloom, vUv).rgb * uBloom;
  col *= uExposure;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSaturation), 0.0);
  // vignette
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.35;
  col = lin2srgb(col);
  // dither
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
`;

function fsMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FS_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

export class Post {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.msaa = opts.msaa ?? 4;
    this.useFXAA = this.msaa === 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene();
    this.qscene.add(this.quad);
    this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.bright = fsMaterial(BRIGHT_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 } });
    this.down = fsMaterial(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = fsMaterial(UP_FRAG, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.composite = fsMaterial(COMPOSITE_FRAG, {
      tColor: { value: null },
      tNormal: { value: null },
      tDepth: { value: null },
      tBloom: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 3000 },
      uFogDensity: { value: 1 / 1100 },
      uExposure: { value: 1.0 },
      uBloom: { value: 0.35 },
      uOutline: { value: 1.0 },
      uLineScale: { value: 1.0 },
      uSaturation: { value: 1.08 },
      uInk: { value: new THREE.Color(0.1, 0.08, 0.14) },
      uTime: { value: 0 },
    });
    this.fxaa = new THREE.ShaderMaterial({
      ...FXAAShader,
      vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      depthTest: false,
      depthWrite: false,
    });
    this.width = 1;
    this.height = 1;
    this.bloomLevels = [];
    this.createTargets(1, 1);
  }

  createTargets(w, h) {
    this.disposeTargets();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    this.scene = new THREE.WebGLRenderTarget(w, h, {
      count: 2,
      type: THREE.HalfFloatType,
      samples: this.msaa,
      depthTexture,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.scene.textures[1].minFilter = THREE.NearestFilter;
    this.scene.textures[1].magFilter = THREE.NearestFilter;
    this.bloomLevels = [];
    let bw = Math.max(1, Math.floor(w / 2));
    let bh = Math.max(1, Math.floor(h / 2));
    for (let i = 0; i < 5; i++) {
      const down = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      const up = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      this.bloomLevels.push({ down, up, w: bw, h: bh });
      bw = Math.max(1, Math.floor(bw / 2));
      bh = Math.max(1, Math.floor(bh / 2));
    }
    this.ldr = this.useFXAA ? new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }) : null;
  }

  disposeTargets() {
    if (this.scene) {
      this.scene.depthTexture?.dispose();
      this.scene.dispose();
    }
    for (const l of this.bloomLevels) {
      l.down.dispose();
      l.up.dispose();
    }
    if (this.ldr) this.ldr.dispose();
  }

  setSize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.createTargets(w, h);
  }

  setMSAA(samples) {
    this.msaa = samples;
    this.useFXAA = samples === 0;
    this.createTargets(this.width, this.height);
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qscene, this.qcam);
  }

  render(camera, params = {}) {
    const r = this.renderer;
    const color = this.scene.textures[0];
    // Bloom chain
    const L = this.bloomLevels;
    if ((params.bloom ?? 0.35) > 0) {
      this.bright.uniforms.tSrc.value = color;
      this.bright.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      this.bright.uniforms.uThreshold.value = params.threshold ?? 1.0;
      this.pass(this.bright, L[0].down);
      for (let i = 1; i < L.length; i++) {
        this.down.uniforms.tSrc.value = L[i - 1].down.texture;
        this.down.uniforms.uTexel.value.set(1 / L[i - 1].w, 1 / L[i - 1].h);
        this.pass(this.down, L[i].down);
      }
      let src = L[L.length - 1].down.texture;
      for (let i = L.length - 2; i >= 0; i--) {
        this.up.uniforms.tSrc.value = src;
        this.up.uniforms.tAdd.value = L[i].down.texture;
        this.up.uniforms.uTexel.value.set(1 / L[i + 1].w, 1 / L[i + 1].h);
        this.pass(this.up, L[i].up);
        src = L[i].up.texture;
      }
      this.composite.uniforms.tBloom.value = L[0].up.texture;
    }
    const cu = this.composite.uniforms;
    cu.tColor.value = color;
    cu.tNormal.value = this.scene.textures[1];
    cu.tDepth.value = this.scene.depthTexture;
    cu.uTexel.value.set(1 / this.width, 1 / this.height);
    cu.uNear.value = camera.near;
    cu.uFar.value = camera.far;
    cu.uFogDensity.value = params.fogDensity ?? cu.uFogDensity.value;
    cu.uExposure.value = params.exposure ?? 1;
    cu.uBloom.value = params.bloom ?? 0.35;
    cu.uOutline.value = params.outline ?? 1;
    cu.uLineScale.value = params.lineScale ?? 1;
    if (this.useFXAA) {
      this.pass(this.composite, this.ldr);
      this.fxaa.uniforms.tDiffuse.value = this.ldr.texture;
      this.fxaa.uniforms.resolution.value.set(1 / this.width, 1 / this.height);
      this.pass(this.fxaa, null);
    } else {
      this.pass(this.composite, null);
    }
    r.setRenderTarget(null);
  }
}
