import * as THREE from 'three';
import { CELL, ROAD, SIDEWALK } from './config.js';

const HASH_GLSL = /* glsl */ `
float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

// Inyecta posición y normal en mundo en el vertex shader de un material estándar.
function injectWorldVaryings(shader) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;'
    )
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 wpp = vec4(transformed, 1.0);
      vec3 wnn = objectNormal;
      #ifdef USE_INSTANCING
        wpp = instanceMatrix * wpp;
        wnn = mat3(instanceMatrix) * wnn;
      #endif
      wpp = modelMatrix * wpp;
      vWPos = wpp.xyz;
      vWNrm = normalize(mat3(modelMatrix) * wnn);`
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n' + HASH_GLSL
  );
}

/**
 * Material de edificio con ventanas procedurales (sin texturas).
 * El color de cada instancia tiñe la fachada y sirve de semilla para el patrón de luces.
 */
export function makeBuildingMaterial(opts = {}) {
  const o = Object.assign(
    {
      cw: 2.6, ch: 3.3,           // tamaño de la retícula de ventanas
      wx: [0.2, 0.8], wy: [0.25, 0.8],
      lit: 0.38,                  // probabilidad de ventana encendida
      shop: true,                 // planta baja con escaparates
      glass: [0.035, 0.05, 0.075],
      roughness: 0.85,
    },
    opts
  );
  const uniforms = { uLit: { value: o.lit }, uGlow: { value: 1.0 } };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: o.roughness,
    metalness: 0.05,
    envMapIntensity: 0.55,
  });
  const f = (v) => v.toFixed(4);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLit;\nuniform float uGlow;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wallCol = diffuseColor.rgb;
        #ifdef USE_INSTANCING_COLOR
          float seed = dot(vColor, vec3(17.13, 31.71, 13.37));
        #else
          float seed = 0.0;
        #endif
        float side = 1.0 - step(0.6, abs(vWNrm.y));
        float faceSign = (abs(vWNrm.x) > 0.5) ? sign(vWNrm.x) : sign(vWNrm.z) * 2.0;
        float fx = (abs(vWNrm.x) > 0.5) ? vWPos.z : vWPos.x;
        vec2 g = vec2(fx, vWPos.y) / vec2(${f(o.cw)}, ${f(o.ch)});
        vec2 wid = floor(g);
        vec2 wf = fract(g);
        float isShop = ${o.shop ? '1.0' : '0.0'} * (1.0 - step(1.0, wid.y));
        vec2 wx = mix(vec2(${f(o.wx[0])}, ${f(o.wx[1])}), vec2(0.06, 0.94), isShop);
        vec2 wy = mix(vec2(${f(o.wy[0])}, ${f(o.wy[1])}), vec2(0.08, 0.78), isShop);
        float win = step(wx.x, wf.x) * step(wf.x, wx.y) * step(wy.x, wf.y) * step(wf.y, wy.y) * side;
        float rnd = h21(wid + vec2(seed * 3.1 + faceSign * 7.7, seed));
        float litChance = mix(uLit, 0.75, isShop);
        float lit = step(1.0 - litChance, rnd) * win;
        float tone = h21(wid * 1.71 + seed);
        vec3 warm = vec3(1.0, 0.68, 0.36);
        vec3 cool = vec3(0.72, 0.85, 1.0);
        vec3 winEmit = lit * mix(warm, cool, step(0.78, tone)) * (0.55 + 0.9 * h21(wid + 3.1 + seed));
        vec3 glassCol = vec3(${f(o.glass[0])}, ${f(o.glass[1])}, ${f(o.glass[2])});
        diffuseColor.rgb = mix(wallCol, glassCol, win);
        // líneas de forjado entre plantas
        float ledge = (1.0 - step(0.07, wf.y)) * side * (1.0 - win);
        diffuseColor.rgb *= 1.0 - ledge * 0.28;
        // tejado más oscuro
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(wallCol * 0.6, vec3(0.36, 0.35, 0.34), 0.55), 1.0 - side);
        // un poco de suciedad vertical
        diffuseColor.rgb *= 0.9 + 0.1 * h21(vec2(floor(fx * 0.7), seed));
        float winMask = win;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.22, winMask);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.55, winMask * (1.0 - lit));`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += winEmit * 0.72 * uGlow;`
      );
  };
  mat.customProgramCacheKey = () => 'bld' + JSON.stringify(o);
  mat.userData.uniforms = uniforms;
  return mat;
}

/** Suelo de la ciudad: calles, aceras, pasos de cebra y marcas viales, todo en shader. */
export function makeGroundMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const R = (ROAD / 2).toFixed(3);
  const SW = SIDEWALK.toFixed(3);
  const C = CELL.toFixed(3);
  mat.onBeforeCompile = (shader) => {
    injectWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float C = ${C}; float R = ${R}; float SW = ${SW};
        vec2 p = vWPos.xz;
        vec2 q = p - floor(p / C + 0.5) * C;
        vec2 a = abs(q);
        float roadV = 1.0 - step(R, a.x);
        float roadH = 1.0 - step(R, a.y);
        float road = max(roadV, roadH);
        float walk = max(1.0 - step(R + SW, a.x), 1.0 - step(R + SW, a.y)) * (1.0 - road);
        float n = h21(floor(p * 3.0)) * 0.06 + h21(floor(p * 0.5)) * 0.05;
        vec3 lotCol = vec3(0.23, 0.22, 0.22) + n;
        vec3 walkCol = vec3(0.40, 0.38, 0.37) + n * 0.6;
        vec3 asphalt = vec3(0.075, 0.078, 0.085) + n * 0.35;
        // juntas de las baldosas de la acera
        vec2 tile = fract(p / 1.5);
        float joint = (1.0 - step(0.05, tile.x)) + (1.0 - step(0.05, tile.y));
        walkCol *= 1.0 - clamp(joint, 0.0, 1.0) * 0.18;
        // bordillo
        float curb = max(
          step(R, a.x) * (1.0 - step(R + 0.25, a.x)) * step(R, a.y),
          step(R, a.y) * (1.0 - step(R + 0.25, a.y)) * step(R, a.x));
        vec3 col = mix(lotCol, walkCol, walk);
        col = mix(col, vec3(0.55, 0.53, 0.5), curb);
        col = mix(col, asphalt, road);
        // línea central discontinua
        float lineV = (1.0 - step(0.12, a.x)) * step(0.45, fract(p.y / 7.0)) * step(R + SW, a.y);
        float lineH = (1.0 - step(0.12, a.y)) * step(0.45, fract(p.x / 7.0)) * step(R + SW, a.x);
        // líneas de borde continuas
        float edgeV = step(R - 0.75, a.x) * (1.0 - step(R - 0.6, a.x)) * step(R + 0.0, a.y);
        float edgeH = step(R - 0.75, a.y) * (1.0 - step(R - 0.6, a.y)) * step(R + 0.0, a.x);
        // pasos de cebra
        float zebraV = (1.0 - step(R - 1.0, a.x)) * step(R + 0.6, a.y) * (1.0 - step(R + 3.6, a.y)) * step(0.5, fract(p.x / 1.2));
        float zebraH = (1.0 - step(R - 1.0, a.y)) * step(R + 0.6, a.x) * (1.0 - step(R + 3.6, a.x)) * step(0.5, fract(p.y / 1.2));
        float paint = clamp(lineV + lineH, 0.0, 1.0);
        float white = clamp(edgeV + edgeH + zebraV + zebraH, 0.0, 1.0);
        col = mix(col, vec3(0.85, 0.62, 0.18), paint * 0.9);
        col = mix(col, vec3(0.78, 0.78, 0.76), white * 0.85);
        diffuseColor.rgb = col;
      }`
    );
  };
  mat.customProgramCacheKey = () => 'ground';
  return mat;
}

/** Material de monedas/gemas que giran y flotan en el vertex shader (sin coste de CPU). */
export function makeSpinMaterial(params) {
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial(params);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float sph = 0.0;
        #ifdef USE_INSTANCING
          sph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
        #endif
        float sa = uTime * 2.6 + sph;
        mat2 srot = mat2(cos(sa), -sin(sa), sin(sa), cos(sa));
        objectNormal.xz = srot * objectNormal.xz;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.xz = srot * transformed.xz;
        transformed.y += sin(uTime * 3.0 + sph) * 0.18;`
      );
  };
  mat.customProgramCacheKey = () => 'spin' + mat.color.getHex();
  mat.userData.uniforms = uniforms;
  return mat;
}

/** Cielo de atardecer con sol y algunas estrellas. */
export function makeSkyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x0d1030) },
      uMid: { value: new THREE.Color(0x3d3f86) },
      uHor: { value: new THREE.Color(0xe5876f) },
      uLow: { value: new THREE.Color(0x6b4a5e) },
      uSunDir: { value: sunDir.clone().normalize() },
      uSunCol: { value: new THREE.Color(0xffc58a) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHor, uLow, uSunCol, uSunDir;
      varying vec3 vDir;
      ${HASH_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.28, h));
        col = mix(col, uTop, smoothstep(0.28, 0.85, h));
        col = mix(col, uLow, smoothstep(0.0, -0.25, h));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunCol * (pow(s, 1400.0) * 4.0 + pow(s, 80.0) * 0.35 + pow(s, 6.0) * 0.2);
        // estrellas en la parte alta
        vec2 sp = vec2(atan(d.z, d.x) * 120.0, h * 240.0);
        float st = step(0.996, h21(floor(sp))) * smoothstep(0.25, 0.7, h);
        col += st * 0.8;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
