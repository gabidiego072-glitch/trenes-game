import * as THREE from 'three';
import { CELL_X, CELL_Z, AVENUE, STREET, SIDEWALK } from './config.js';

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
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
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
 * Estilos: ladrillo con escaleras de incendios, piedra de preguerra, muro cortina de cristal.
 */
export function makeBuildingMaterial(opts = {}) {
  const o = Object.assign(
    {
      cw: 2.6, ch: 3.3,           // tamaño de la retícula de ventanas
      wx: [0.2, 0.8], wy: [0.25, 0.8],
      lit: 0.45,                  // probabilidad de ventana encendida
      shop: true,                 // planta baja con escaparates
      fire: false,                // escaleras de incendios de hierro
      glass: [0.035, 0.05, 0.075],
      cool: 0.22,                 // proporción de luces frías (blancas/azuladas)
      roughness: 0.85,
      winRough: 0.22,
      winMetal: 0.55,
      env: 0.55,
      glow: 0.75,
    },
    opts
  );
  const uniforms = { uLit: { value: o.lit }, uGlow: { value: 1.0 } };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: o.roughness,
    metalness: 0.05,
    envMapIntensity: o.env,
  });
  const f = (v) => v.toFixed(4);
  const fireCode = o.fire
    ? `{
        // escaleras de incendios: grupos de 3 columnas con plataformas, barandilla y tramos en zigzag
        float cg = mod(wid.x, 7.0);
        float inCol = step(1.0, cg) * (1.0 - step(4.0, cg));
        float hasFE = step(0.3, h21(vec2(floor(wid.x / 7.0), seed + faceSign))) * inCol * side * step(1.0, wid.y);
        float lx = (cg - 1.0 + wf.x) / 3.0;
        float platform = 1.0 - step(0.08, wf.y);
        float rail = step(0.3, wf.y) * (1.0 - step(0.335, wf.y));
        float stairX = mod(wid.y, 2.0) > 0.5 ? lx : 1.0 - lx;
        float stair = 1.0 - step(0.03, abs(stairX - wf.y));
        float fe = hasFE * clamp(platform + rail + stair, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.035, 0.04), fe * 0.93);
        win *= 1.0 - fe;
        lit *= 1.0 - fe;
        winEmit *= 1.0 - fe;
      }`
    : '';
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
        float litChance = mix(uLit, 0.8, isShop);
        float lit = step(1.0 - litChance, rnd) * win;
        float tone = h21(wid * 1.71 + seed);
        vec3 warm = vec3(1.0, 0.68, 0.36);
        vec3 cool = vec3(0.72, 0.85, 1.0);
        vec3 winEmit = lit * mix(warm, cool, step(1.0 - ${f(o.cool)}, tone)) * (0.55 + 0.9 * h21(wid + 3.1 + seed));
        vec3 glassCol = vec3(${f(o.glass[0])}, ${f(o.glass[1])}, ${f(o.glass[2])});
        diffuseColor.rgb = mix(wallCol, glassCol, win);
        float ledge = (1.0 - step(0.07, wf.y)) * side * (1.0 - win);
        diffuseColor.rgb *= 1.0 - ledge * 0.28;
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(wallCol * 0.6, vec3(0.36, 0.35, 0.34), 0.55), 1.0 - side);
        diffuseColor.rgb *= 0.9 + 0.1 * h21(vec2(floor(fx * 0.7), seed));
        ${fireCode}
        float winMask = win;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, ${f(o.winRough)}, winMask);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, ${f(o.winMetal)}, winMask * (1.0 - lit));`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += winEmit * ${f(o.glow)} * uGlow;`
      );
  };
  mat.customProgramCacheKey = () => 'bld' + JSON.stringify(o);
  mat.userData.uniforms = uniforms;
  return mat;
}

/** Suelo: avenidas con carriles, calles, aceras con baldosas, pasos de cebra; todo en shader. */
export function makeGroundMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const k = (v) => v.toFixed(3);
  mat.onBeforeCompile = (shader) => {
    injectWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float gRoad = 0.0;
        {
          float CX = ${k(CELL_X)}; float CZ = ${k(CELL_Z)};
          float A2 = ${k(AVENUE / 2)}; float S2 = ${k(STREET / 2)}; float SW = ${k(SIDEWALK)};
          vec2 p = vWPos.xz;
          float qx = p.x - floor(p.x / CX + 0.5) * CX;
          float qz = p.y - floor(p.y / CZ + 0.5) * CZ;
          float ax = abs(qx), az = abs(qz);
          float onAve = 1.0 - step(A2, ax);
          float onSt = 1.0 - step(S2, az);
          float road = max(onAve, onSt);
          gRoad = road;
          float walk = max(1.0 - step(A2 + SW, ax), 1.0 - step(S2 + SW, az)) * (1.0 - road);
          float n = h21(floor(p * 3.0)) * 0.05 + h21(floor(p * 0.4)) * 0.05;
          vec3 lotCol = vec3(0.21, 0.2, 0.2) + n;
          vec3 walkCol = vec3(0.4, 0.38, 0.37) + n * 0.6;
          vec3 asphalt = vec3(0.07, 0.072, 0.08) + n * 0.3;
          vec2 tile = fract(p / 1.5);
          float joint = (1.0 - step(0.05, tile.x)) + (1.0 - step(0.05, tile.y));
          walkCol *= 1.0 - clamp(joint, 0.0, 1.0) * 0.18;
          float curb = max(
            step(A2, ax) * (1.0 - step(A2 + 0.3, ax)) * step(S2, az),
            step(S2, az) * (1.0 - step(S2 + 0.3, az)) * step(A2, ax));
          vec3 col = mix(lotCol, walkCol, walk);
          col = mix(col, vec3(0.55, 0.53, 0.5), curb);
          col = mix(col, asphalt, road);
          // avenidas de sentido único: líneas de carril blancas discontinuas
          float laneA = (1.0 - step(0.1, abs(ax - 4.0))) + (1.0 - step(0.1, ax));
          laneA *= step(0.5, fract(p.y / 6.0)) * onAve * step(S2 + SW, az);
          // calles: línea central amarilla
          float laneS = (1.0 - step(0.1, az)) * step(0.45, fract(p.x / 7.0)) * onSt * step(A2 + SW, ax);
          float edgeA = step(A2 - 0.8, ax) * (1.0 - step(A2 - 0.65, ax)) * step(S2, az);
          float edgeS = step(S2 - 0.8, az) * (1.0 - step(S2 - 0.65, az)) * step(A2, ax);
          float zebraA = (1.0 - step(A2 - 0.8, ax)) * step(S2 + 0.6, az) * (1.0 - step(S2 + 3.6, az)) * step(0.5, fract(p.x / 1.2));
          float zebraS = (1.0 - step(S2 - 0.8, az)) * step(A2 + 0.6, ax) * (1.0 - step(A2 + 3.6, ax)) * step(0.5, fract(p.y / 1.2));
          // tapas de alcantarilla
          vec2 mh = vec2(mod(p.x + 9.0, 23.0) - 11.5, mod(p.y + 5.0, 17.0) - 8.5);
          float manhole = (1.0 - step(0.55, length(mh))) * road;
          col = mix(col, vec3(0.13, 0.12, 0.11), manhole * 0.8);
          col = mix(col, vec3(0.86, 0.66, 0.2), laneS * 0.9);
          col = mix(col, vec3(0.8, 0.8, 0.78), clamp(laneA + edgeA + edgeS + zebraA + zebraS, 0.0, 1.0) * 0.85);
          diffuseColor.rgb = col;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.48, gRoad); // asfalto algo húmedo: refleja las luces`
      );
  };
  mat.customProgramCacheKey = () => 'ground-ny';
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

/** Luces sin sombreado (coronas de rascacielos, bombillas): el color de instancia puede pasar de 1 para el resplandor. */
export function makeGlowMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0xffffff });
}

// ---------- Carteles de neón ----------

const ADS = [
  ['VÍA LIBRE', 'construye tu vía', '#ff2e88', '#3a0a5e'],
  ['TAXI', '24 horas', '#ffd400', '#1b1b1b'],
  ['PIZZA', 'porción $1', '#ff5a1f', '#2a0d00'],
  ['BROADWAY', 'esta noche', '#ffffff', '#b0001e'],
  ['I ♥ NY', '', '#ff2a2a', '#f4f4f4'],
  ['JAZZ', 'club · live', '#3df2ff', '#06203a'],
  ['HOTEL', 'vacantes', '#ff4d6d', '#14061c'],
  ['NEWS', 'última hora', '#ffffff', '#0047ff'],
  ['CINE', 'estreno', '#ffe14d', '#550000'],
  ['RAMEN', 'abierto', '#ffffff', '#d62828'],
  ['SALE', '-70%', '#111111', '#ffe600'],
  ['MUSEO', 'arte moderno', '#ffffff', '#111111'],
  ['COFFEE', 'café de NY', '#f6d7a7', '#3b2314'],
  ['TRENES', 'próxima salida', '#7cff6b', '#08240a'],
  ['METRO', 'línea 7', '#ffffff', '#7a1fa2'],
  ['SODA', 'bien fría', '#00e1ff', '#ff1f6b'],
];

export function makeBillboardAtlas() {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W * 4;
  cv.height = H * 4;
  const g = cv.getContext('2d');
  ADS.forEach(([title, sub, fg, bg], i) => {
    const x = (i % 4) * W, y = Math.floor(i / 4) * H;
    g.save();
    g.beginPath();
    g.rect(x, y, W, H);
    g.clip();
    const grad = g.createLinearGradient(x, y, x + W, y + H);
    grad.addColorStop(0, bg);
    grad.addColorStop(1, shade(bg, -0.35));
    g.fillStyle = grad;
    g.fillRect(x, y, W, H);
    // rayas sutiles
    g.globalAlpha = 0.08;
    g.fillStyle = '#ffffff';
    for (let k = 0; k < W; k += 18) g.fillRect(x + k, y, 6, H);
    g.globalAlpha = 1;
    // marco de neón
    g.strokeStyle = fg;
    g.lineWidth = 10;
    g.shadowColor = fg;
    g.shadowBlur = 24;
    g.strokeRect(x + 14, y + 14, W - 28, H - 28);
    // texto
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 130;
    g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
    while (g.measureText(title).width > W - 70 && size > 40) {
      size -= 6;
      g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
    }
    g.fillText(title, x + W / 2, y + H / 2 - (sub ? 20 : 0));
    if (sub) {
      g.shadowBlur = 10;
      g.font = `700 36px 'Arial', sans-serif`;
      g.fillText(sub.toUpperCase(), x + W / 2, y + H - 52);
    }
    g.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return '#' + c.getHexString();
}

export const BILLBOARD_TILES = ADS.length;

/** Carteles: una sola malla instanciada; cada instancia elige su anuncio del atlas y parpadea un poco. */
export function makeBillboardMaterial(tex) {
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.7, 1.7, 1.7) });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTile;\nvarying float vTile;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vMapUv = (vMapUv + vec2(mod(aTile, 4.0), 3.0 - floor(aTile / 4.0))) * 0.25;
        vTile = aTile;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vTile;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb *= 0.8 + 0.2 * step(-0.6, sin(uTime * (1.3 + mod(vTile, 3.0)) + vTile * 2.3));`
      );
  };
  mat.customProgramCacheKey = () => 'billboard';
  mat.userData.uniforms = uniforms;
  return mat;
}

/** Charco de luz de farola sobre la acera (decal aditivo). */
export function makeLightPoolMaterial() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  return new THREE.MeshBasicMaterial({
    map: tex, color: 0xffa860, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

// ---------- Cielo ----------

export const SKY = {
  top: 0x070a22,
  mid: 0x26306c,
  glow: 0xff9358,   // franja del atardecer
  hor: 0xc07a7c,    // horizonte = color de la niebla
  low: 0x3a2c40,
  city: 0x262a44,   // silueta del skyline lejano
  sun: 0xffb46e,
};

/** Cielo del atardecer con sol, estrellas y un skyline infinito en el horizonte. */
export function makeSkyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(SKY.top) },
      uMid: { value: new THREE.Color(SKY.mid) },
      uGlowC: { value: new THREE.Color(SKY.glow) },
      uHor: { value: new THREE.Color(SKY.hor) },
      uLow: { value: new THREE.Color(SKY.low) },
      uCity: { value: new THREE.Color(SKY.city) },
      uSunDir: { value: sunDir.clone().normalize() },
      uSunCol: { value: new THREE.Color(SKY.sun) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uGlowC, uHor, uLow, uCity, uSunCol, uSunDir;
      varying vec3 vDir;
      ${HASH_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        // la franja cálida es más intensa hacia el sol
        vec3 band = mix(uGlowC * 0.75, uGlowC, pow(s, 3.0));
        vec3 col = mix(uHor, band, smoothstep(0.0, 0.05, h));
        col = mix(col, uMid, smoothstep(0.05, 0.32, h));
        col = mix(col, uTop, smoothstep(0.32, 0.9, h));
        col = mix(col, uLow, smoothstep(0.0, -0.2, h));
        col += uSunCol * (pow(s, 1400.0) * 4.0 + pow(s, 80.0) * 0.35 + pow(s, 6.0) * 0.18);
        vec2 sp = vec2(atan(d.z, d.x) * 120.0, h * 240.0);
        col += step(0.996, h21(floor(sp))) * smoothstep(0.25, 0.7, h) * 0.8;

        // skyline lejano: columnas de edificios con ventanas y alguna aguja
        float az = atan(d.z, d.x);
        float u = az * 95.0;
        float id = floor(u);
        float bh = 0.01 + 0.035 * pow(h21(vec2(id, 1.0)), 2.0);
        float cluster = h21(vec2(floor(u / 13.0), 7.0));
        bh += step(0.55, cluster) * 0.075 * pow(h21(vec2(id, 3.0)), 2.5);
        float fu = fract(u);
        float spire = step(0.93, h21(vec2(id, 9.0))) * (1.0 - step(0.05, abs(fu - 0.5)))
          * step(bh, h) * (1.0 - step(bh + 0.03, h));
        float inB = (1.0 - step(bh, h)) * step(-0.02, h);
        float b = max(inB, spire);
        vec2 wg = vec2(u * 7.0, h * 950.0);
        float wlit = step(0.7, h21(floor(wg))) * step(0.35, fract(wg.x)) * step(0.4, fract(wg.y)) * inB;
        float haze = 0.4 + 0.6 * (1.0 - smoothstep(0.0, 0.025, h));
        vec3 cityCol = mix(uCity, uHor, haze) + wlit * vec3(1.0, 0.72, 0.42) * 0.55 * (1.0 - haze * 0.6);
        col = mix(col, cityCol, b);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
