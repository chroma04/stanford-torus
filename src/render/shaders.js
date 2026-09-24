// GLSL shared by all habitat materials. Every material is GLSL3 and writes two
// render targets: colour (HDR) and normal + outline weight for the ink pass.

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;          // light direction in local (lat, up, fwd) coordinates
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform float uNight;       // 0 = day, 1 = night
uniform vec3 uLampColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uSway;
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform vec2 uShadowTexel;

vec3 localUp(vec3 wp) { return -normalize(vec3(wp.xy, 0.0)); }
vec3 localFwd(vec3 up) { return vec3(up.y, -up.x, 0.0); }

vec3 sunDir(vec3 wp) {
  vec3 up = localUp(wp);
  vec3 fwd = localFwd(up);
  return normalize(uSun.x * vec3(0.0, 0.0, 1.0) + uSun.y * up + uSun.z * fwd);
}

vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float noise3d(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0));
  float n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1));
  float n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1));
  float n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
`;

export const FRAG_COMMON = /* glsl */ `
// Anti-aliased line mask for a fractional coordinate f in [0,1) (lines at integers).
float gridLine(float coord, float width) {
  float fw = max(fwidth(coord), 1e-5);
  float d = abs(fract(coord - 0.5) - 0.5);
  return 1.0 - smoothstep(width - fw, width + fw, d);
}
// Fade factor for patterns that would alias at a distance.
float patternFade(vec2 coord) {
  vec2 fw = fwidth(coord);
  return 1.0 - smoothstep(0.25, 0.6, max(fw.x, fw.y));
}

float shadowAt(vec3 wp, vec3 N) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 L = sunDir(wp);
  float ndl = dot(N, L);
  vec4 sc = uShadowMatrix * vec4(wp + N * 0.06 + L * 0.04, 1.0);
  vec3 p = sc.xyz;
  if (p.x <= 0.0 || p.y <= 0.0 || p.x >= 1.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float bias = 0.0006 + 0.0012 * (1.0 - clamp(ndl, 0.0, 1.0));
  float sum = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      sum += texture(uShadowMap, vec3(p.xy + vec2(float(x), float(y)) * uShadowTexel * 1.25, p.z - bias));
    }
  }
  sum /= 9.0;
  vec2 e = min(p.xy, 1.0 - p.xy);
  float fade = smoothstep(0.0, 0.1, min(e.x, e.y));
  return mix(1.0, smoothstep(0.3, 0.7, sum), fade);
}

float lampBand(float l) {
  return smoothstep(0.1, 0.14, l) * 0.45 + smoothstep(0.42, 0.47, l) * 0.55;
}

// Banded cel lighting.
vec3 toonShade(vec3 albedo, vec3 N, vec3 wp, float shadow, float ao, float softness) {
  vec3 up = localUp(wp);
  vec3 L = sunDir(wp);
  float ndl = dot(N, L);
  float w = mix(0.05, 0.35, softness);
  float lit = smoothstep(0.0, w, ndl + softness * 0.15) * shadow;
  float hi = smoothstep(0.62, 0.62 + w, ndl) * shadow;
  float hemi = dot(N, up) * 0.5 + 0.5;
  vec3 amb = mix(uGroundAmb, uSkyAmb, hemi) * ao;
  vec3 V = normalize(cameraPosition - wp);
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0) * 0.25 * (0.3 + 0.7 * lit);
  return albedo * (amb + uSunColor * (lit * 0.82 + hi * 0.1)) + uSunColor * rim * albedo;
}

vec3 applyFog(vec3 col, vec3 wp) {
  float d = length(wp - cameraPosition);
  float f = 1.0 - exp(-d * uFogDensity);
  return mix(col, uFogColor, f * 0.92);
}
`;

// Material patterns painted in the fragment shader (must match PAT in builder.js).
export const PATTERNS = /* glsl */ `
vec3 stonePattern(vec3 base, vec2 p, float seed) {
  vec2 q = p / vec2(1.1, 0.46);
  float row = floor(q.y);
  q.x += fract(row * 0.5) * 1.0 + hash12(vec2(row, seed)) * 0.3;
  vec2 id = floor(q);
  float h = hash12(id + seed * 17.0);
  vec3 c = base * (0.9 + 0.18 * h);
  float fade = patternFade(q);
  float line = max(gridLine(q.x, 0.035), gridLine(q.y, 0.07)) * fade;
  return mix(c, base * 0.62, line);
}

vec3 pavingPattern(vec3 base, vec2 p) {
  vec2 q = p / 0.9;
  vec2 id = floor(q);
  float h = hash12(id);
  vec3 c = base * (0.93 + 0.1 * h);
  float fade = patternFade(q);
  float line = max(gridLine(q.x, 0.04), gridLine(q.y, 0.04)) * fade;
  return mix(c, base * 0.72, line);
}

vec3 woodPattern(vec3 base, vec2 p) {
  float q = p.y / 0.19;
  float id = floor(q);
  float h = hash12(vec2(id, 3.1));
  vec3 c = base * (0.9 + 0.16 * h);
  float fade = patternFade(vec2(q));
  return mix(c, base * 0.66, gridLine(q, 0.05) * fade);
}

vec3 roofPattern(vec3 base, vec2 p) {
  float qy = p.y / 0.32;
  float row = floor(qy);
  float qx = p.x / 0.42 + fract(row * 0.5);
  float fy = fract(qy);
  float h = hash12(vec2(floor(qx), row));
  vec3 c = base * (0.88 + 0.16 * h) * (0.86 + 0.18 * fy);
  float fade = patternFade(vec2(qx, qy));
  float line = max(gridLine(qy, 0.05), gridLine(qx, 0.03)) * fade;
  return mix(c, base * 0.6, line);
}

vec3 panelPattern(vec3 base, vec2 p, out float glow) {
  vec2 q = p / vec2(4.8, 3.3);
  vec2 id = floor(q);
  float h = hash12(id);
  vec3 c = base * (0.95 + 0.07 * h);
  float fade = patternFade(q);
  float line = max(gridLine(q.x, 0.012), gridLine(q.y, 0.016)) * fade;
  c = mix(c, base * 0.72, line);
  // small service lights on some panels
  vec2 f = fract(q) - 0.5;
  float light = step(0.86, h) * (1.0 - smoothstep(0.035, 0.05, length(f * vec2(4.8, 3.3) / 3.0)));
  glow = light;
  return c;
}

// Facade: uv.x in window cells, uv.y in metres from ground.
vec3 facadePattern(vec3 base, vec2 p, float seed, vec3 N, vec3 up, out vec3 emit) {
  emit = vec3(0.0);
  float floorH = 3.1;
  float fy = p.y / floorH;
  float fl = floor(fy);
  vec2 cell = vec2(floor(p.x), fl);
  vec2 f = vec2(fract(p.x), fract(fy) * floorH);
  // skip plinth / roof area
  if (p.y < 0.35) return base;
  float style = floor(seed * 4.0);
  float ww = style == 0.0 ? 0.36 : style == 1.0 ? 0.46 : style == 2.0 ? 0.3 : 0.52;
  float wh = style == 2.0 ? 1.9 : 1.45;
  float sill = style == 2.0 ? 0.55 : 0.85;
  float fwx = fwidth(p.x) * 1.2;
  float fwy = fwidth(p.y) * 1.2;
  float ax = abs(f.x - 0.5);
  float win = (1.0 - smoothstep(-fwx, fwx, ax - ww * 0.5))
    * smoothstep(sill - fwy, sill + fwy, f.y) * (1.0 - smoothstep(sill + wh - fwy, sill + wh + fwy, f.y));
  float glassM = (1.0 - smoothstep(-fwx, fwx, ax - ww * 0.5 + 0.03))
    * smoothstep(sill + 0.07 - fwy, sill + 0.07 + fwy, f.y) * (1.0 - smoothstep(sill + wh - 0.07 - fwy, sill + wh - 0.07 + fwy, f.y));
  if (style == 3.0) glassM *= smoothstep(0.012 - fwx, 0.012 + fwx, ax);
  float frame = clamp(win - glassM, 0.0, 1.0);
  // floor band
  vec3 c = base;
  float band = 1.0 - smoothstep(0.0, fwy + 0.06, abs(f.y - 0.02));
  c = mix(c, base * 0.86, band * 0.6);
  // shutters (styles 0 and 2)
  if (style == 0.0 || style == 2.0) {
    float sx = ax - ww * 0.5;
    float sh = step(0.02, sx) * (1.0 - step(ww * 0.45, sx))
      * step(sill, f.y) * (1.0 - step(sill + wh, f.y));
    float shIdx = floor(hash12(vec2(seed * 91.0, 2.0)) * 6.0);
    vec3 shc = shIdx < 1.0 ? vec3(0.36, 0.56, 0.48) : shIdx < 2.0 ? vec3(0.31, 0.5, 0.66) : shIdx < 3.0 ? vec3(0.66, 0.29, 0.24) : shIdx < 4.0 ? vec3(0.49, 0.6, 0.3) : shIdx < 5.0 ? vec3(0.18, 0.37, 0.48) : vec3(0.79, 0.55, 0.24);
    c = mix(c, srgb2lin(shc), sh * patternFade(p));
  }
  float lit = step(0.45, hash12(cell + seed * 37.0));
  float refl = 0.55 + 0.45 * clamp(dot(N, up) + 0.3, 0.0, 1.0);
  vec3 glass = mix(srgb2lin(vec3(0.33, 0.45, 0.55)), srgb2lin(vec3(0.62, 0.77, 0.86)), refl * (0.6 + 0.4 * f.y / 3.1));
  c = mix(c, vec3(0.95, 0.94, 0.9), frame * patternFade(p));
  c = mix(c, glass, glassM);
  float glassMask = glassM;
  float warm = hash12(cell + seed * 5.0);
  emit = glassMask * lit * uNight * mix(vec3(1.0, 0.72, 0.4), vec3(1.0, 0.86, 0.62), warm) * 1.6;
  return c;
}

vec3 stripesPattern(vec3 base, vec2 p) {
  float q = p.x / 0.32;
  float s = step(0.5, fract(q));
  return mix(base, vec3(0.95, 0.93, 0.88), s);
}
`;

export const MRT_OUT = /* glsl */ `
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outNormal;
`;

// ---------------------------------------------------------------------------
// Generic toon material for props, buildings, foliage, shell.

export const TOON_VERT = /* glsl */ `
${COMMON}
in vec4 color;
in vec4 aux;
out vec4 vColor;
out vec4 vAux;
out vec2 vUv;
out vec3 vWorld;
out vec3 vNormal;

void main() {
#ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
#else
  mat4 im = mat4(1.0);
#endif
  vec3 lp = position;
  if (aux.w > 0.0) {
    // wing flap for birds / butterflies (aux.w = flap weight)
    float ph = dot(im[3].xyz, vec3(0.131, 0.071, 0.113));
    float f = sin(uTime * (aux.w > 0.6 ? 26.0 : 13.0) + ph * 7.0);
    lp.y += f * abs(lp.x) * 0.9;
    lp.x *= 1.0 - 0.25 * abs(f);
  }
  vec4 wp = modelMatrix * im * vec4(lp, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * mat3(im) * normal);
  float sway = aux.z;
  if (sway > 0.0) {
    vec3 up = localUp(wp.xyz);
    vec3 fwd = localFwd(up);
    float ph = dot(wp.xyz, vec3(0.071, 0.053, 0.089));
    float t = uTime;
    float w = sin(t * 1.3 + ph) * 0.6 + sin(t * 2.7 + ph * 2.3) * 0.25;
    float w2 = cos(t * 1.1 + ph * 1.7) * 0.5;
    wp.xyz += (vec3(0.0, 0.0, 1.0) * w + fwd * w2) * sway * 0.13 * uSway;
  }
  vWorld = wp.xyz;
  vNormal = n;
  vColor = color;
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= instanceColor;
#endif
  vAux = aux;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const TOON_FRAG = /* glsl */ `
${COMMON}
${FRAG_COMMON}
${PATTERNS}
${MRT_OUT}
in vec4 vColor;
in vec4 vAux;
in vec2 vUv;
in vec3 vWorld;
in vec3 vNormal;
uniform float uLineWeight;

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 up = localUp(vWorld);
  vec3 base = srgb2lin(vColor.rgb);
  float ao = vColor.a;
  int pat = int(vAux.x * 255.0 + 0.5);
  float seed = vAux.y;
  vec3 emit = vec3(0.0);
  float soft = 0.0;
  float lineW = uLineWeight;
  vec3 albedo = base;
  if (pat == 1) albedo = stonePattern(base, vUv, seed);
  else if (pat == 2) albedo = facadePattern(base, vUv, seed, N, up, emit);
  else if (pat == 3) albedo = roofPattern(base, vUv);
  else if (pat == 4) {
    float g;
    albedo = panelPattern(base, vUv, g);
    emit += g * vec3(0.85, 0.95, 1.0) * (0.2 + 2.2 * uNight);
  } else if (pat == 5) albedo = woodPattern(base, vUv);
  else if (pat == 6) {
    // glazing with mullions and a transom; a diagonal sheen sells the reflection
    float refl = 0.5 + 0.5 * clamp(dot(N, up) + 0.4, 0.0, 1.0);
    vec2 q = vec2(vUv.x / 1.25, vUv.y / 2.3);
    float sheen = smoothstep(0.35, 0.5, fract((vUv.x + vUv.y) * 0.22)) * (1.0 - smoothstep(0.5, 0.65, fract((vUv.x + vUv.y) * 0.22)));
    albedo = mix(base * 0.5, base * 1.1, refl) + base * sheen * 0.25;
    float frame = max(gridLine(q.x, 0.03), gridLine(q.y, 0.025)) * patternFade(q);
    float lit = step(0.3, hash12(floor(vUv * 0.8) + seed * 13.0));
    emit = lit * uNight * vec3(1.0, 0.78, 0.5) * 1.3 * (1.0 - frame);
    albedo = mix(albedo, vec3(0.85, 0.86, 0.84), frame);
  } else if (pat == 7 || pat == 18) {
    // foliage: break the canopy into leafy clumps by perturbing the normal
    soft = 0.25;
    lineW *= 0.55;
    vec3 q = vWorld * 1.6 + seed * 13.0;
    vec3 nn = vec3(noise3d(q), noise3d(q + 17.1), noise3d(q + 31.7)) - 0.5;
    N = normalize(N + nn * 0.6);
    float n = noise3d(vWorld * 5.0);
    albedo = base * (0.9 + 0.2 * n);
    if (pat == 18) {
      float strand = fract(vUv.x * 2.2 + vnoise(vec2(vUv.x * 3.0, 0.0)) * 0.6);
      albedo *= 0.82 + 0.22 * smoothstep(0.2, 0.5, strand) * (1.0 - smoothstep(0.7, 0.95, strand));
    }
  } else if (pat == 8) {
    albedo = base;
    emit = mix(vec3(0.25, 0.22, 0.16), vec3(4.0, 3.0, 1.7), uNight);
  } else if (pat == 9) {
    float refl = clamp(dot(reflect(normalize(vWorld - cameraPosition), N), up), 0.0, 1.0);
    albedo = base * (0.85 + 0.35 * smoothstep(0.5, 0.8, refl));
  } else if (pat == 10) albedo = pavingPattern(base, vUv);
  else if (pat == 11) {
    vec2 q = vUv / vec2(1.2, 1.0);
    float line = max(gridLine(q.x, 0.03), gridLine(q.y, 0.03)) * patternFade(q);
    float refl = 0.5 + 0.5 * clamp(dot(N, up), 0.0, 1.0);
    albedo = mix(base * vec3(0.75, 0.9, 0.85), base, refl);
    albedo = mix(albedo, vec3(0.9), line);
    emit = uNight * vec3(0.9, 0.35, 1.0) * 0.55 * (1.0 - line);
  } else if (pat == 12) albedo = stripesPattern(base, vUv);
  else if (pat == 13) {
    albedo = base;
    emit = mix(vec3(0.3), vec3(2.2, 2.5, 2.8), uNight);
  } else if (pat == 14) {
    float band = step(0.35, fract(vUv.x / 1.6));
    albedo = mix(base, vec3(0.2, 0.3, 0.38), band);
    emit = band * uNight * vec3(1.0, 0.9, 0.7) * 1.5;
  } else if (pat == 15) {
    albedo = base;
    emit = base * (0.5 + 1.8 * uNight);
  } else if (pat == 16) {
    // grass blades: lit like the ground they grow from
    N = up;
    soft = 0.15;
    lineW = 0.0;
  } else if (pat == 17) {
    // fireflies
    albedo = base * 0.2;
    emit = base * 6.0 * uNight;
    lineW = 0.0;
  }
  float sh = shadowAt(vWorld, N);
  vec3 col = toonShade(albedo, N, vWorld, sh, ao, soft);
  col += emit;
  col = applyFog(col, vWorld);
  outColor = vec4(col, 1.0);
  outNormal = vec4(N * 0.5 + 0.5, lineW);
}
`;

// ---------------------------------------------------------------------------
// Terrain

export const TERRAIN_VERT = /* glsl */ `
${COMMON}
in vec4 color;
in vec4 surf0;
in vec4 surf1;
in vec2 suv;
out vec4 vColor;
out vec4 vSurf0;
out vec4 vSurf1;
out vec2 vSuv;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vSurf0 = surf0;
  vSurf1 = surf1;
  vSuv = suv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const TERRAIN_FRAG = /* glsl */ `
${COMMON}
${FRAG_COMMON}
${PATTERNS}
${MRT_OUT}
in vec4 vColor;
in vec4 vSurf0;
in vec4 vSurf1;
in vec2 vSuv;
in vec3 vWorld;
in vec3 vNormal;

void main() {
  vec3 N = normalize(vNormal);
  vec3 base = srgb2lin(vColor.rgb);
  float s = vSuv.x;
  float u = vWorld.z;
  float wall = step(0.5, vSurf1.x);
  vec3 albedo = base;
  float lineW = 1.0;
  if (wall > 0.5) {
    albedo = stonePattern(base, vec2(s, vSuv.y), 0.0);
  } else {
    // grass texture: soft two-scale mottling
    float m = vnoise(vec2(s, u) * 1.3) * 0.6 + vnoise(vec2(s, u) * 5.1) * 0.4;
    float big = vnoise(vec2(s, u) * 0.11);
    albedo *= (0.88 + 0.22 * m) * (0.92 + 0.14 * big);
    // farm rows
    if (vSurf1.y > 0.5) {
      float field = hash12(vec2(floor(s / 11.52), floor(u / 12.0)));
      vec3 crop = field < 0.25 ? vec3(0.28, 0.5, 0.17) : field < 0.5 ? vec3(0.62, 0.6, 0.22) : field < 0.72 ? vec3(0.78, 0.62, 0.2) : field < 0.86 ? vec3(0.22, 0.42, 0.2) : vec3(0.42, 0.3, 0.45);
      float q = u / 0.95;
      float fw = fwidth(q);
      float r = fract(q);
      float band = smoothstep(0.18 - fw, 0.18 + fw, r) * (1.0 - smoothstep(0.72 - fw, 0.72 + fw, r));
      float fade = patternFade(vec2(q));
      vec3 soil = base;
      vec3 cropC = crop * (0.85 + 0.3 * vnoise(vec2(s * 2.0, u * 2.0)));
      albedo = mix(mix(soil, cropC, 0.55), mix(soil, cropC, band), fade);
    }
    // paths
    float pd = vSurf0.x;
    float fw = max(fwidth(pd), 0.01);
    float inside = 1.0 - smoothstep(-fw, fw, pd);
    if (inside > 0.0) {
      vec3 pathCol;
      if (vSurf0.y > 0.5) pathCol = pavingPattern(srgb2lin(vec3(0.86, 0.82, 0.74)), vec2(s, u));
      else {
        float g = vnoise(vec2(s, u) * 4.0);
        pathCol = srgb2lin(vec3(0.84, 0.76, 0.6)) * (0.9 + 0.15 * g);
      }
      float border = (1.0 - smoothstep(0.0, fw * 2.0, abs(pd + 0.1))) * inside;
      albedo = mix(albedo, pathCol, inside);
      albedo *= 1.0 - 0.28 * border;
    }
  }
  float ao = vSurf0.w;
  float sh = shadowAt(vWorld, N);
  vec3 col = toonShade(albedo, N, vWorld, sh, ao, 0.0);
  float lamp = vSurf0.z;
  col += albedo * uLampColor * lampBand(lamp) * uNight;
  col = applyFog(col, vWorld);
  outColor = vec4(col, 1.0);
  outNormal = vec4(N * 0.5 + 0.5, lineW);
}
`;

// ---------------------------------------------------------------------------
// Water

export const WATER_VERT = /* glsl */ `
${COMMON}
in vec4 wat;
out vec4 vWat;
out vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float k = wat.w;
  if (k < 0.5) {
    // gentle swell
    wp.xyz += localUp(wp.xyz) * sin(uTime * 0.9 + wat.y * 0.35 + wat.z * 0.6) * 0.03;
  }
  vWorld = wp.xyz;
  vWat = wat;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const WATER_FRAG = /* glsl */ `
${COMMON}
${FRAG_COMMON}
${PATTERNS}
${MRT_OUT}
in vec4 vWat;
in vec3 vWorld;
uniform vec3 uSkyTint;

void main() {
  vec3 up = localUp(vWorld);
  float shore = vWat.x;
  float kind = vWat.w;
  vec2 p = vWat.yz; // (along, across)
  vec3 deep = srgb2lin(vec3(0.16, 0.48, 0.58));
  vec3 shallow = srgb2lin(vec3(0.42, 0.76, 0.74));
  float depthT = smoothstep(0.0, 4.5, shore);
  vec3 col = mix(shallow, deep, depthT);
  float t = uTime;
  vec2 flow = kind < 0.5 ? vec2(p.x - t * 0.7, p.y) : p;
  // stylised ripple streaks
  float n = vnoise(flow * vec2(0.22, 1.5)) * 0.6 + vnoise(flow * vec2(0.6, 2.8) + t * 0.15) * 0.4;
  float streak = smoothstep(0.7, 0.72, n) * (1.0 - smoothstep(0.74, 0.77, n)) * patternFade(flow * vec2(0.6, 2.8));
  // normal perturbation for glints
  vec3 N = normalize(up + vec3(0.0, 0.0, (n - 0.5) * 0.25) + localFwd(up) * (vnoise(flow * 2.3) - 0.5) * 0.25);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = sunDir(vWorld);
  float fres = pow(1.0 - clamp(dot(up, V), 0.0, 1.0), 3.0);
  col = mix(col, uSkyTint, fres * 0.55);
  float spec = pow(clamp(dot(reflect(-L, N), V), 0.0, 1.0), 60.0);
  float sh = shadowAt(vWorld, up);
  vec3 amb = mix(uGroundAmb, uSkyAmb, 0.85);
  col = col * (amb + uSunColor * 0.75 * sh);
  col += uSunColor * smoothstep(0.5, 0.55, spec) * 0.8 * sh;
  col += vec3(0.9, 0.97, 1.0) * streak * 0.25 * (1.0 - uNight * 0.7);
  // shore foam
  float fw = fwidth(shore) + 0.02;
  float foam = 1.0 - smoothstep(0.25 - fw, 0.25 + fw, shore + 0.12 * sin(p.x * 1.7 + t * 1.5));
  col = mix(col, vec3(0.92, 0.97, 1.0) * (amb + uSunColor * 0.7), foam * (kind < 0.5 ? 0.8 : 0.25));
  if (kind > 0.5 && kind < 1.5) {
    // rice paddy: still, muddy-green water with rows of young rice
    vec3 riceC = srgb2lin(vec3(0.42, 0.66, 0.28)) * (amb + uSunColor * 0.8 * sh);
    col = mix(col, riceC * 0.8, 0.3);
    vec2 q = vec2(p.x / 0.32, p.y / 0.3);
    vec2 f = fract(q) - 0.5;
    float sprout = 1.0 - smoothstep(0.1, 0.18, length(f * vec2(1.0, 0.6)));
    // near the viewer instanced rice plants take over from the painted rows
    float dist = length(vWorld - cameraPosition);
    float fade = patternFade(q) * smoothstep(18.0, 30.0, dist);
    col = mix(col, riceC, mix(0.28, sprout, fade));
  }
  if (kind > 1.5) {
    float ring = sin(length(p) * 6.0 - t * 4.0);
    col += vec3(0.5, 0.6, 0.65) * smoothstep(0.85, 0.95, ring) * 0.2;
  }
  col = applyFog(col, vWorld);
  outColor = vec4(col, 1.0);
  outNormal = vec4(up * 0.5 + 0.5, 0.35);
}
`;
