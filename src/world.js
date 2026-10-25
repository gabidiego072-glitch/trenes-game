import * as THREE from 'three';
import { CELL_X, CELL_Z, AVENUE, STREET, SIDEWALK, VIEW_DIST } from './config.js';
import { mulberry32, hash2, lerp } from './utils.js';
import { Biomes } from './biomes.js';
import { Terrain } from './terrain.js';
import {
  makeBuildingMaterial, makeSpinMaterial, makeGlowMaterial,
  makeBillboardAtlas, makeBillboardMaterial, makeLightPoolMaterial, BILLBOARD_TILES,
} from './materials.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Malla instanciada con huecos reutilizables. Solo dibuja hasta la instancia más alta usada. */
class Pool {
  constructor(scene, geo, mat, cap, { cast = true, receive = true, color = true } = {}) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.castShadow = cast;
    this.mesh.receiveShadow = receive;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, ZERO);
    if (color) this.mesh.setColorAt(0, _c.set(0xffffff));
    this.free = [];
    for (let i = cap - 1; i >= 0; i--) this.free.push(i);
    this.dirty = true;
    this.hwm = 0;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  alloc(matrix, color) {
    const i = this.free.pop();
    if (i === undefined) return -1;
    if (i + 1 > this.hwm) {
      this.hwm = i + 1;
      this.mesh.count = this.hwm;
    }
    this.mesh.setMatrixAt(i, matrix);
    if (color && this.mesh.instanceColor) this.mesh.setColorAt(i, color);
    this.dirty = true;
    return i;
  }
  release(i) {
    if (i < 0) return;
    this.mesh.setMatrixAt(i, ZERO);
    this.free.push(i);
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const t = this.mesh.geometry.attributes.aTile;
    if (t) t.needsUpdate = true;
    this.dirty = false;
  }
}

// Paletas inspiradas en Nueva York
const BRICK = [0x8e3b2c, 0x9a4a35, 0x7a3326, 0xa65a3f, 0x6e2e24, 0x8b5a44, 0xb0705a];
const BROWNSTONE = [0x6b4535, 0x5c3a2d, 0x7a5040, 0x8a5f4a, 0x4f3328];
const STONE = [0xc9b89a, 0xbfae90, 0xd4c6aa, 0xb3a68e, 0xa8a196, 0xc2b9a8, 0x9e958a];
const MULLION = [0x8b96a3, 0x6d7885, 0xaab4bf, 0x4c5560, 0x9aa7b0];
const TOWER_GLASS = [0x3a4a5e, 0x2c3a4c, 0x45566a, 0x253242, 0x4f6175];
const TREE_GREENS = [0x3f6b35, 0x4d7a3a, 0x355f30, 0x5a8a40, 0x2f5a3a];
const PINE_GREENS = [0x1f3d26, 0x24452b, 0x2b4f30, 0x1a3522];
const BARN_REDS = [0x8a2a1f, 0x7a2419, 0x9c3426];

/** Prisma triangular (tejados a dos aguas), base en y = 0. */
function prismGeometry() {
  const v = [
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0, 1, -0.5],
    [-0.5, 0, 0.5], [0.5, 0, 0.5], [0, 1, 0.5],
  ];
  const tris = [[0, 2, 1], [3, 4, 5], [0, 3, 5], [0, 5, 2], [1, 2, 5], [1, 5, 4], [0, 1, 4], [0, 4, 3]];
  const pos = [];
  for (const t of tris) for (const i of t) pos.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Aspas de aerogenerador (tres palas y buje). */
function bladesGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.BoxGeometry(0.9, 15, 0.25);
    b.translate(0, 7.8, 0);
    b.rotateZ((i * Math.PI * 2) / 3);
    parts.push(b.toNonIndexed());
  }
  const hub = new THREE.SphereGeometry(0.9, 12, 8).toNonIndexed();
  hub.deleteAttribute('uv');
  for (const p of parts) p.deleteAttribute('uv');
  const all = parts.concat([hub]);
  // unir a mano (mismos atributos)
  let n = 0;
  for (const g of all) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of all) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
const CROWN_LIGHTS = [
  [2.4, 1.7, 0.8],  // dorado
  [2.4, 2.4, 2.6],  // blanco
  [0.9, 1.6, 2.8],  // azul
  [2.6, 0.7, 0.6],  // rojo
  [1.0, 2.4, 1.4],  // verde
];

function boxMatrix(b) {
  _p.set((b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2);
  _s.set(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  _q.identity();
  return _m.compose(_p, _q, _s);
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.seed = 1;
    this.cache = new Map();     // datos de celda (puros, sin mallas)
    this.loaded = new Map();    // celdas con mallas en escena
    this.collected = new Set(); // monedas ya recogidas
    this.biomes = new Biomes(1);
    this.spinners = [];         // aspas de aerogeneradores cargadas
    this.bladesGeo = bladesGeometry();
    this.bladesMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
    cyl.translate(0, 0.5, 0);
    const cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
    cyl8.translate(0, 0.5, 0);
    const cone = new THREE.ConeGeometry(1, 1, 12);
    cone.translate(0, 0.5, 0);
    const taper = new THREE.CylinderGeometry(0.42, 1, 1, 4, 1);
    taper.rotateY(Math.PI / 4);
    taper.translate(0, 0.5, 0);
    const crown = new THREE.IcosahedronGeometry(1, 0);
    const beaconGeo = new THREE.SphereGeometry(0.45, 8, 6);
    const coinGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 16);
    coinGeo.rotateX(Math.PI / 2);
    const gemGeo = new THREE.OctahedronGeometry(1.1, 0);
    gemGeo.scale(0.8, 1.25, 0.8);
    const billGeo = new THREE.PlaneGeometry(1, 1);
    const tiles = new Float32Array(1600);
    billGeo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 1).setUsage(THREE.DynamicDrawUsage));
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);

    this.brickMat = makeBuildingMaterial({ fire: true, cw: 2.4, ch: 3.2, wx: [0.24, 0.76], wy: [0.22, 0.8], lit: 0.5 });
    this.stoneMat = makeBuildingMaterial({ cw: 2.2, ch: 3.5, wx: [0.28, 0.72], wy: [0.2, 0.82], lit: 0.5, roughness: 0.8 });
    this.glassMat = makeBuildingMaterial({
      cw: 1.6, ch: 3.6, wx: [0.05, 0.95], wy: [0.08, 0.94], lit: 0.3, shop: false,
      glass: [0.05, 0.1, 0.17], cool: 0.6, roughness: 0.35, winRough: 0.06, winMetal: 0.9, env: 1.1, glow: 0.65,
    });
    this.beaconMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 4 });
    this.coinMat = makeSpinMaterial({
      color: 0xffc23a, emissive: 0xff9a00, emissiveIntensity: 0.9, metalness: 0.9, roughness: 0.25,
    });
    this.gemMat = makeSpinMaterial({
      color: 0x55e7ff, emissive: 0x1aa8ff, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.1, flatShading: true,
    });
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x1b3f52, roughness: 0.06, metalness: 0.7 });
    this.billMat = makeBillboardMaterial(makeBillboardAtlas());
    const std = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.9 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const glow = makeGlowMaterial();

    const noShadow = { cast: false, receive: false, color: false };
    this.pools = {
      brick: new Pool(scene, box, this.brickMat, 3500),
      stone: new Pool(scene, box, this.stoneMat, 3500),
      glass: new Pool(scene, box, this.glassMat, 3000),
      taper: new Pool(scene, taper, this.glassMat, 200),
      box: new Pool(scene, box, std, 6000),
      cyl: new Pool(scene, cyl, std, 9000),
      metal: new Pool(scene, cyl8, metal, 1500),
      metalCone: new Pool(scene, cone, metal, 400),
      pole: new Pool(scene, cyl8, std, 3500, { cast: false }),
      cone: new Pool(scene, cone, std, 9000),
      crown: new Pool(scene, crown, leaf, 5000),
      glow: new Pool(scene, box, glow, 5000, { cast: false, receive: false }),
      glowCyl: new Pool(scene, cyl8, glow, 800, { cast: false, receive: false }),
      lpool: new Pool(scene, poolGeo, makeLightPoolMaterial(), 3500, noShadow),
      bill: new Pool(scene, billGeo, this.billMat, 1600, noShadow),
      beacon: new Pool(scene, beaconGeo, this.beaconMat, 3000, noShadow),
      coin: new Pool(scene, coinGeo, this.coinMat, 3000, noShadow),
      gem: new Pool(scene, gemGeo, this.gemMat, 400, noShadow),
      water: new Pool(scene, box, this.waterMat, 400, { cast: false, color: false }),
      prism: new Pool(scene, prismGeometry(), std, 600),
      rock: new Pool(scene, crown, leaf, 1500),
    };
    this.pools.lpool.mesh.renderOrder = 1;

    // Suelo con relieve que sigue al tren (ciudad plana, campo y montañas).
    this.terrain = new Terrain(scene, () => this.biomes);
  }

  reset(seed) {
    for (const key of [...this.loaded.keys()]) this.unloadCell(key);
    this.cache.clear();
    this.collected.clear();
    this.seed = seed;
    this.biomes = new Biomes(seed);
    this.terrain.reset();
  }

  /** ¿Es ciudad la celda que contiene (x, z)? */
  isCity(x, z) {
    return this.cell(Math.floor(x / CELL_X), Math.floor(z / CELL_Z)).city;
  }

  /** Altura del terreno natural (sin edificios ni árboles). */
  groundAt(x, z) {
    return this.biomes.ground(x, z);
  }

  // ---------- Barrios ----------

  noise(x, z, salt) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const h = (a, b) => hash2(a, b, this.seed ^ salt) / 4294967296;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return lerp(lerp(h(xi, zi), h(xi + 1, zi), u), lerp(h(xi, zi + 1), h(xi + 1, zi + 1), u), v);
  }

  district(cx, cz) {
    const dist = Math.hypot((cx + 0.5) * CELL_X, (cz + 0.5) * CELL_Z);
    if (this.noise(cx * 0.21, cz * 0.3, 202) > 0.8 && dist > 120) return 'park';
    // un poco de Midtown cerca de la salida para que el skyline impresione desde el principio
    const n = this.noise(cx * 0.15, cz * 0.22, 101) + 0.2 * Math.exp(-dist / 450);
    if (n > 0.6) return 'midtown';
    if (n < 0.32) return 'village';
    return 'mixed';
  }

  // ---------- Generación de datos ----------

  cell(cx, cz) {
    const key = cx + ',' + cz;
    let c = this.cache.get(key);
    if (!c) {
      c = this.generate(cx, cz);
      this.cache.set(key, c);
    }
    return c;
  }

  generate(cx, cz) {
    const rng = mulberry32(hash2(cx, cz, this.seed));
    const r = () => rng();
    const rr = (a, b) => a + (b - a) * rng();
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const X0 = cx * CELL_X, Z0 = cz * CELL_Z;
    const dist = Math.hypot((cx + 0.5) * CELL_X, (cz + 0.5) * CELL_Z);
    const nearStart = dist < 110;
    const isCity = nearStart || this.biomes.city(X0 + CELL_X / 2, Z0 + CELL_Z / 2) > 0.58;
    if (!isCity) {
      const c = { cx, cz, key: cx + ',' + cz, type: 'plains', city: false, obstacles: [], parts: [], coins: [], vents: [], dyn: [] };
      this.genNature({ c, r, rr, pick, dist }, X0, Z0);
      return c;
    }
    let type = this.district(cx, cz);
    if (nearStart && type === 'park') type = 'mixed';
    const c = { cx, cz, key: cx + ',' + cz, type, city: true, obstacles: [], parts: [], coins: [], vents: [], dyn: [] };
    const ctx = { c, r, rr, pick, nearStart, dist, type };

    const lot = [
      X0 + AVENUE / 2 + SIDEWALK, Z0 + STREET / 2 + SIDEWALK,
      X0 + CELL_X - AVENUE / 2 - SIDEWALK, Z0 + CELL_Z - STREET / 2 - SIDEWALK,
    ];

    if (type === 'park') this.genPark(ctx, lot);
    else this.genBlock(ctx, lot);

    this.genStreet(ctx, X0, Z0, lot);
    return c;
  }

  /** Mobiliario urbano de la celda: farolas, alcantarillas con vapor, árboles y monedas en la calle. */
  genStreet(ctx, X0, Z0, lot) {
    const { c, r, rr, pick } = ctx;
    const lamp = (x, z, dx, dz) => {
      c.parts.push({ pool: 'pole', center: [x, 0, z], scale: [0.13, 6.6, 0.13], color: 0x1d2a24 });
      c.parts.push({ pool: 'glow', b: [x + dx * 0.9 - 0.32, 6.2, z + dz * 0.9 - 0.32, x + dx * 0.9 + 0.32, 6.5, z + dz * 0.9 + 0.32], color: [2.6, 1.8, 0.9] });
      c.parts.push({ pool: 'lpool', center: [x + dx * 2.2, 0.04, z + dz * 2.2], scale: [10, 1, 10] });
    };
    const ax = AVENUE / 2 + 1.0, sz = STREET / 2 + 1.0;
    // avenida del borde oeste de la celda (dentro de la celda solo la acera este)
    for (const u of [0.28, 0.72]) lamp(X0 + ax, Z0 + CELL_Z * u, -1, 0);
    // calle del borde sur (acera norte) y del borde norte (acera sur)
    for (const u of [0.3, 0.7]) lamp(X0 + CELL_X * u, Z0 + sz, 0, -1);
    for (const u of [0.5]) lamp(X0 + CELL_X * u, Z0 + CELL_Z - sz, 0, 1);

    // árboles en las aceras de los barrios residenciales
    if (ctx.type === 'village' || (ctx.type === 'mixed' && r() < 0.3)) {
      for (const zz of [Z0 + STREET / 2 + 1.6, Z0 + CELL_Z - STREET / 2 - 1.6]) {
        for (let x = lot[0] + 4; x < lot[2] - 3; x += rr(8, 11)) {
          if (Math.abs(x - (X0 + CELL_X * 0.3)) < 2 || Math.abs(x - (X0 + CELL_X * 0.7)) < 2 || Math.abs(x - (X0 + CELL_X * 0.5)) < 2) continue;
          this.tree(c, x, zz, rr(1.3, 1.8), rr(2.2, 3), pick(TREE_GREENS));
        }
      }
    }

    // vapor saliendo de la calzada, muy de Nueva York
    if (r() < 0.32) {
      const vx = X0 + rr(5.6, 6.6), vz = Z0 + rr(10, CELL_Z - 10); // junto al bordillo, dentro de esta celda
      c.parts.push({ pool: 'cyl', center: [vx, 0, vz], scale: [0.5, 1.1, 0.5], color: 0xff6a00 });
      c.parts.push({ pool: 'cyl', center: [vx, 1.1, vz], scale: [0.5, 0.45, 0.5], color: 0xf2f2f2 });
      c.parts.push({ pool: 'cyl', center: [vx, 1.55, vz], scale: [0.5, 0.45, 0.5], color: 0xff6a00 });
      c.vents.push({ x: vx, y: 2.1, z: vz });
      // la vía pasa por encima
      c.obstacles.push({ x0: vx - 0.5, x1: vx + 0.5, z0: vz - 0.5, z1: vz + 0.5, h: 2.0, tower: false });
    }

    // monedas en la calzada
    if (r() < 0.55) {
      if (r() < 0.5) {
        const lane = pick([-5.25, -1.75, 1.75, 5.25]);
        const start = rr(10, 18);
        for (let i = 0; i < 6; i++) c.coins.push({ x: X0 + lane, y: 1.9, z: Z0 + start + i * 4, gem: false });
      } else {
        const lane = (r() < 0.5 ? -1 : 1) * 2.4;
        const start = rr(12, 30);
        for (let i = 0; i < 6; i++) c.coins.push({ x: X0 + start + i * 4, y: 1.9, z: Z0 + lane, gem: false });
      }
    }
  }

  tree(c, x, z, cr, trunk, color, y = 0) {
    c.parts.push({ pool: 'cyl', center: [x, y - 0.5, z], scale: [0.2, trunk + cr * 0.5 + 0.5, 0.2], color: 0x4a3426 });
    c.parts.push({ pool: 'crown', center: [x, y + trunk + cr * 0.9, z], scale: [cr, cr * 1.2, cr], color });
    c.obstacles.push({ x0: x - cr * 0.8, x1: x + cr * 0.8, z0: z - cr * 0.8, z1: z + cr * 0.8, h: y + trunk + cr * 2, tower: false, soft: true });
  }

  pine(c, x, z, y, s, color) {
    c.parts.push({ pool: 'cyl', center: [x, y - 0.5, z], scale: [0.25 * s, 2.2 * s, 0.25 * s], color: 0x3d2a1e });
    c.parts.push({ pool: 'cone', center: [x, y + 1.2 * s, z], scale: [2.1 * s, 4.4 * s, 2.1 * s], color });
    c.parts.push({ pool: 'cone', center: [x, y + 3.6 * s, z], scale: [1.5 * s, 3.8 * s, 1.5 * s], color });
    c.obstacles.push({ x0: x - 1.4 * s, x1: x + 1.4 * s, z0: z - 1.4 * s, z1: z + 1.4 * s, h: y + 7.2 * s, tower: false, soft: true });
  }

  /** Celdas de naturaleza: llanuras con granjas y lagos, o montañas con pinares y nieve. */
  genNature(ctx, X0, Z0) {
    const { c, r, rr, pick } = ctx;
    const b = this.biomes;
    b.ground(X0 + CELL_X / 2, Z0 + CELL_Z / 2);
    const mountain = b.m > 0.45;
    c.type = mountain ? 'mountain' : 'plains';
    const M = 3; // margen dentro de la celda
    const rp = () => [rr(X0 + M, X0 + CELL_X - M), rr(Z0 + M, Z0 + CELL_Z - M)];
    const g = (x, z) => b.ground(x, z);
    // pendiente aproximada en un punto
    const flatEnough = (x, z, rad, tol) => {
      const h0 = g(x, z);
      for (const [dx, dz] of [[rad, 0], [-rad, 0], [0, rad], [0, -rad]]) if (Math.abs(g(x + dx, z + dz) - h0) > tol) return false;
      return !b.water;
    };

    if (mountain) {
      const n = 10 + Math.floor(r() * 16);
      for (let i = 0; i < n; i++) {
        const [x, z] = rp();
        const y = g(x, z);
        if (b.water || y > 64 + r() * 8) continue;
        this.pine(c, x, z, y, rr(0.8, 1.4), pick(PINE_GREENS));
      }
      const rocks = Math.floor(r() * 4);
      for (let i = 0; i < rocks; i++) {
        const [x, z] = rp();
        const y = g(x, z);
        const s = rr(0.8, 2.2);
        c.parts.push({ pool: 'rock', center: [x, y + s * 0.3, z], scale: [s * 1.3, s, s * 1.1], color: pick([0x6b6662, 0x7d7873, 0x5a5652]) });
        c.obstacles.push({ x0: x - s, x1: x + s, z0: z - s, z1: z + s, h: y + s * 1.2, tower: false });
      }
      if (r() < 0.07) {
        const [x, z] = rp();
        if (flatEnough(x, z, 4, 1.6)) this.cabin(c, x, z, g(x, z), rr, r);
      }
      // antenas en las cumbres: infranqueables, con baliza roja
      const [mx, mz] = [X0 + CELL_X / 2 + rr(-15, 15), Z0 + CELL_Z / 2 + rr(-8, 8)];
      const my = g(mx, mz);
      if (my > 55 && r() < 0.18) this.mast(c, mx, mz, my, rr);
    } else {
      // granja
      if (r() < 0.16) {
        const [x, z] = [X0 + CELL_X / 2 + rr(-12, 12), Z0 + CELL_Z / 2 + rr(-6, 6)];
        if (flatEnough(x, z, 7, 1.4)) this.farm(c, x, z, rr, r, pick, g);
      } else if (r() < 0.09) {
        const [x, z] = [X0 + CELL_X / 2 + rr(-20, 20), Z0 + CELL_Z / 2 + rr(-8, 8)];
        if (!b.water && g(x, z) > 2) this.turbine(c, x, z, g(x, z), rr);
      }
      // bosquecillos
      const groves = Math.floor(r() * 3);
      for (let k = 0; k < groves; k++) {
        const [gx, gz] = rp();
        const m = 3 + Math.floor(r() * 6);
        for (let i = 0; i < m; i++) {
          const x = Math.min(X0 + CELL_X - M, Math.max(X0 + M, gx + rr(-7, 7)));
          const z = Math.min(Z0 + CELL_Z - M, Math.max(Z0 + M, gz + rr(-6, 6)));
          const y = g(x, z);
          if (b.water) continue;
          this.tree(c, x, z, rr(1.6, 2.8), rr(2, 3.4), pick(TREE_GREENS), y);
        }
      }
    }
    // monedas en línea siguiendo el terreno
    if (r() < 0.6) {
      const a = r() * Math.PI * 2;
      let [x, z] = [X0 + CELL_X / 2 + rr(-15, 15), Z0 + CELL_Z / 2 + rr(-8, 8)];
      for (let i = 0; i < 6; i++) {
        const px = x + Math.cos(a) * (i - 2.5) * 4, pz = z + Math.sin(a) * (i - 2.5) * 4;
        c.coins.push({ x: px, y: g(px, pz) + 1.9, z: pz, gem: false });
      }
      if (r() < 0.15) c.coins.push({ x, y: g(x, z) + 2.6, z, gem: true });
    }
  }

  farm(c, x, z, rr, r, pick, g) {
    const w = rr(8, 11), d = rr(6.5, 8);
    const base = Math.min(g(x - w / 2, z - d / 2), g(x + w / 2, z - d / 2), g(x - w / 2, z + d / 2), g(x + w / 2, z + d / 2)) - 0.3;
    const h = rr(4.5, 6);
    const red = pick(BARN_REDS);
    c.parts.push({ pool: 'box', b: [x - w / 2, base, z - d / 2, x + w / 2, base + h, z + d / 2], color: red });
    c.parts.push({ pool: 'prism', center: [x, base + h, z], scale: [w + 0.6, rr(2.6, 3.4), d + 0.6], rotY: Math.PI / 2, color: 0x3a3330 });
    c.parts.push({ pool: 'box', b: [x - w / 2 - 0.05, base, z - 1.4, x - w / 2 + 0.05, base + 3.6, z + 1.4], color: 0xeeeeee });
    c.obstacles.push({ x0: x - w / 2 - 0.3, x1: x + w / 2 + 0.3, z0: z - d / 2 - 0.3, z1: z + d / 2 + 0.3, h: base + h + 3.4, tower: false });
    // silo
    const sx = x + w / 2 + 3.2, sz = z + rr(-1.5, 1.5);
    const sb = g(sx, sz) - 0.3;
    const sh = rr(10, 14);
    c.parts.push({ pool: 'cyl', center: [sx, sb, sz], scale: [2.1, sh, 2.1], color: 0xb9bcc0 });
    c.parts.push({ pool: 'metalCone', center: [sx, sb + sh, sz], scale: [2.25, 1.8, 2.25], color: 0xd0d3d6 });
    c.obstacles.push({ x0: sx - 2.2, x1: sx + 2.2, z0: sz - 2.2, z1: sz + 2.2, h: sb + sh + 1.8, tower: false });
    // balas de heno
    const n = 2 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const hx = x + rr(-14, 14), hz = z + (r() < 0.5 ? -1 : 1) * rr(d / 2 + 3, d / 2 + 7);
      const hy = g(hx, hz);
      c.parts.push({ pool: 'cyl', center: [hx + 0.8, hy + 0.85, hz], scale: [0.85, 1.6, 0.85], rot: [0, r() * 3, Math.PI / 2], color: 0xc9a54a });
      c.obstacles.push({ x0: hx - 1, x1: hx + 1, z0: hz - 1, z1: hz + 1, h: hy + 1.7, tower: false, soft: true });
    }
  }

  cabin(c, x, z, y, rr, r) {
    const w = rr(5, 6.5), d = rr(4, 5), h = 3.2;
    c.parts.push({ pool: 'box', b: [x - w / 2, y - 0.4, z - d / 2, x + w / 2, y + h, z + d / 2], color: 0x5e3f28 });
    c.parts.push({ pool: 'prism', center: [x, y + h, z], scale: [w + 0.8, 2.2, d + 0.8], rotY: Math.PI / 2, color: 0x2e2a28 });
    c.parts.push({ pool: 'box', b: [x + w / 2 - 1.2, y + h, z - 0.4, x + w / 2 - 0.4, y + h + 2.6, z + 0.4], color: 0x5a5652 });
    c.parts.push({ pool: 'glow', b: [x - 0.5, y + 1, z + d / 2, x + 0.5, y + 2, z + d / 2 + 0.05], color: [2.2, 1.5, 0.7] });
    c.obstacles.push({ x0: x - w / 2 - 0.4, x1: x + w / 2 + 0.4, z0: z - d / 2 - 0.4, z1: z + d / 2 + 0.4, h: y + h + 2.6, tower: false });
  }

  mast(c, x, z, y, rr) {
    const h = rr(38, 55);
    c.parts.push({ pool: 'metal', center: [x, y - 1, z], scale: [0.7, h + 1, 0.7], color: 0xc4c8cc });
    for (let k = 1; k <= 3; k++) c.parts.push({ pool: 'metal', center: [x, y + (h * k) / 4, z], scale: [1.6, 0.3, 1.6], color: 0xc4c8cc });
    c.parts.push({ pool: 'beacon', center: [x, y + h + 0.5, z], scale: [1.4, 1.4, 1.4] });
    c.parts.push({ pool: 'beacon', center: [x, y + h * 0.5, z], scale: [1, 1, 1] });
    c.obstacles.push({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5, h: y + h, tower: true });
  }

  /** Aerogenerador: torre blanca con baliza roja (no se puede pasar por encima) y aspas que giran. */
  turbine(c, x, z, y, rr) {
    const h = rr(40, 50);
    c.parts.push({ pool: 'cyl', center: [x, y - 1, z], scale: [1.2, h + 1, 1.2], color: 0xf0f0f0 });
    const rot = rr(0, Math.PI * 2);
    const fx = Math.sin(rot), fz = Math.cos(rot);
    c.parts.push({ pool: 'box', center: [x, y + h, z], scale: [2.2, 2.2, 5.5], rotY: rot, color: 0xf4f4f4 });
    c.parts.push({ pool: 'beacon', center: [x - fx * 2, y + h + 2.6, z - fz * 2], scale: [1.1, 1.1, 1.1] });
    c.dyn.push({ type: 'blades', x: x + fx * 3, y: y + h + 1.1, z: z + fz * 3, rotY: rot, phase: rr(0, 6) });
    c.obstacles.push({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5, h: y + h + 16, tower: true });
  }

  genPark(ctx, lot) {
    const { c, r, rr } = ctx;
    const [x0, z0, x1, z1] = lot;
    c.parts.push({ pool: 'box', b: [x0 - 1.5, 0, z0 - 1.5, x1 + 1.5, 0.14, z1 + 1.5], color: 0x3c5e2e });
    // muro bajo de piedra alrededor del parque
    c.parts.push({ pool: 'box', b: [x0 - 1.5, 0, z0 - 1.5, x1 + 1.5, 0.7, z0 - 1.0], color: 0x8a8378 });
    c.parts.push({ pool: 'box', b: [x0 - 1.5, 0, z1 + 1.0, x1 + 1.5, 0.7, z1 + 1.5], color: 0x8a8378 });
    // caminos de grava
    const pz = rr(z0 + 6, z1 - 6);
    c.parts.push({ pool: 'box', b: [x0 - 1, 0, pz - 1.4, x1 + 1, 0.17, pz + 1.4], color: 0xa89a80 });
    const px = rr(x0 + 8, x1 - 8);
    c.parts.push({ pool: 'box', b: [px - 1.4, 0, z0 - 1, px + 1.4, 0.17, z1 + 1], color: 0xa89a80 });
    const pond = r() < 0.4;
    let pondB = null;
    if (pond) {
      const qx = px < (x0 + x1) / 2 ? [px + 4, x1 - 3] : [x0 + 3, px - 4];
      const qz = pz < (z0 + z1) / 2 ? [pz + 3.5, z1 - 2.5] : [z0 + 2.5, pz - 3.5];
      if (qx[1] - qx[0] > 8 && qz[1] - qz[0] > 5) {
        pondB = [qx[0], qz[0], qx[1], qz[1]];
        c.parts.push({ pool: 'box', b: [pondB[0] - 0.6, 0, pondB[1] - 0.6, pondB[2] + 0.6, 0.28, pondB[3] + 0.6], color: 0x6f6a62 });
        c.parts.push({ pool: 'water', b: [pondB[0], 0, pondB[1], pondB[2], 0.32, pondB[3]] });
        c.coins.push({ x: (pondB[0] + pondB[2]) / 2, y: 2.3, z: (pondB[1] + pondB[3]) / 2, gem: true });
      }
    }
    const n = 12 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      const tx = rr(x0 + 2, x1 - 2), tz = rr(z0 + 2, z1 - 2);
      if (Math.abs(tx - px) < 3 || Math.abs(tz - pz) < 3) continue;
      if (pondB && tx > pondB[0] - 2 && tx < pondB[2] + 2 && tz > pondB[1] - 2 && tz < pondB[3] + 2) continue;
      this.tree(c, tx, tz, rr(1.8, 3), rr(2, 3.4), TREE_GREENS[Math.floor(r() * TREE_GREENS.length)]);
    }
    // farolas del camino
    for (let i = 0; i < 3; i++) {
      const lx = x0 + 6 + i * (x1 - x0 - 12) / 2;
      c.parts.push({ pool: 'pole', center: [lx, 0, pz + 1.9], scale: [0.1, 4.2, 0.1], color: 0x1d2a24 });
      c.parts.push({ pool: 'glow', b: [lx - 0.25, 4.1, pz + 1.65, lx + 0.25, 4.5, pz + 2.15], color: [2.4, 1.8, 1.0] });
      c.parts.push({ pool: 'lpool', center: [lx, 0.2, pz + 1], scale: [8, 1, 8] });
    }
    for (let i = 0; i < 7; i++) {
      const u = (i + 0.5) / 7;
      c.coins.push({ x: x0 + 3 + u * (x1 - x0 - 6), y: 1.9, z: pz, gem: false });
    }
  }

  genBlock(ctx, lot) {
    const { r, rr, type, nearStart, dist } = ctx;
    const [x0, z0, x1, z1] = lot;
    const W = x1 - x0;
    const gap = 1.8;
    const lots = [];
    // probabilidad de rascacielos (infranqueables) según el barrio y la distancia a la salida
    const distF = Math.min(1, Math.max(0, (dist - 130) / 450));
    const towerP = nearStart ? 0 : distF * (type === 'midtown' ? 0.6 : type === 'mixed' ? 0.14 : 0.02);
    if (r() < towerP) {
      lots.push({ b: [x0, z0, x1, z1], tower: true });
    } else if (type === 'village') {
      // casas de piedra rojiza en hilera, a ambos lados de la manzana
      const zm = (z0 + z1) / 2;
      for (const [za, zb] of [[z0, zm - 0.8], [zm + 0.8, z1]]) {
        let x = x0;
        while (x < x1 - 5) {
          const w = Math.min(rr(6, 8.5), x1 - x);
          lots.push({ b: [x, za, x + w, zb], kind: 'brownstone' });
          x += w;
        }
      }
    } else {
      const layout = r();
      if (layout < 0.45) {
        // fila de 2 a 4 edificios a lo largo de la manzana
        const n = 2 + Math.floor(r() * 3);
        let x = x0;
        for (let i = 0; i < n; i++) {
          const w = i === n - 1 ? x1 - x : (W / n) * rr(0.75, 1.25);
          lots.push({ b: [x, z0, Math.min(x + w, x1), z1] });
          x += w + gap;
          if (x > x1 - 6) break;
        }
      } else if (layout < 0.8) {
        // cuadrícula 2-3 x 2
        const n = 2 + Math.floor(r() * 2);
        const zm = (z0 + z1) / 2;
        for (let i = 0; i < n; i++) {
          const xa = x0 + (W / n) * i + (i ? gap / 2 : 0);
          const xb = x0 + (W / n) * (i + 1) - (i < n - 1 ? gap / 2 : 0);
          lots.push({ b: [xa, z0, xb, zm - gap / 2] }, { b: [xa, zm + gap / 2, xb, z1] });
        }
      } else {
        lots.push({ b: [x0, z0, x1, z1] });
      }
    }
    for (const l of lots) {
      if (l.tower) this.genTower(ctx, l.b);
      else this.genBuilding(ctx, l.b, l.kind);
    }
  }

  genBuilding(ctx, lotB, kind) {
    const { c, r, rr, pick, type, nearStart } = ctx;
    const ins = kind === 'brownstone' ? () => 0 : () => rr(0.3, 1.2);
    const b = { x0: lotB[0] + ins(), z0: lotB[1] + ins(), x1: lotB[2] - ins(), z1: lotB[3] - ins() };
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    if (w < 4.5 || d < 4.5) return;
    if (!kind) {
      const t = r();
      if (type === 'midtown') kind = t < 0.45 ? 'glass' : t < 0.85 ? 'stone' : 'brick';
      else if (type === 'mixed') kind = t < 0.5 ? 'brick' : t < 0.85 ? 'stone' : 'glass';
      else kind = t < 0.7 ? 'brick' : 'stone';
      if (nearStart && kind === 'glass') kind = 'stone';
    }
    let h, pool, color;
    if (kind === 'brownstone') {
      h = rr(10, 14); pool = 'brick'; color = pick(BROWNSTONE);
    } else if (kind === 'brick') {
      h = nearStart ? rr(9, 16) : rr(11, 22); pool = 'brick'; color = pick(BRICK);
    } else if (kind === 'stone') {
      h = nearStart ? rr(12, 20) : rr(16, 27); pool = 'stone'; color = pick(STONE);
    } else {
      h = rr(18, 30); pool = 'glass'; color = pick(MULLION);
    }
    _c.set(color).offsetHSL(rr(-0.015, 0.015), rr(-0.04, 0.04), rr(-0.04, 0.04));
    const col = _c.getHex();
    c.parts.push({ pool, b: [b.x0, 0, b.z0, b.x1, h, b.z1], color: col });
    c.obstacles.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, h, tower: false });
    let topH = h;
    let tb = [b.x0, b.z0, b.x1, b.z1];

    if (kind === 'glass') {
      // remate de cristal con una línea de luz
      c.parts.push({ pool: 'glow', b: [b.x0 - 0.06, h - 0.9, b.z0 - 0.06, b.x1 + 0.06, h - 0.6, b.z1 + 0.06], color: [1.2, 1.6, 2.0] });
    } else {
      // cornisa: banda oscura bajo el tejado y otra sobre la planta baja
      const cc = kind === 'stone' ? 0x8d8270 : 0x3f3631;
      c.parts.push({ pool: 'box', b: [b.x0 - 0.3, h - 0.6, b.z0 - 0.3, b.x1 + 0.3, h, b.z1 + 0.3], color: cc });
      c.parts.push({ pool: 'box', b: [b.x0 - 0.12, 3.3, b.z0 - 0.12, b.x1 + 0.12, 3.7, b.z1 + 0.12], color: cc });
    }
    if (kind === 'brownstone') {
      // escalinata de entrada hacia la calle
      const front = (b.z0 + b.z1) / 2 < Math.floor(b.z0 / CELL_Z) * CELL_Z + CELL_Z / 2 ? -1 : 1;
      const fz = front < 0 ? b.z0 : b.z1;
      const sx = (b.x0 + b.x1) / 2;
      c.parts.push({ pool: 'box', b: [sx - 0.9, 0, Math.min(fz, fz + front * 2.2), sx + 0.9, 1.4, Math.max(fz, fz + front * 2.2)], color: 0x5a4034 });
      c.obstacles.push({ x0: sx - 0.9, x1: sx + 0.9, z0: Math.min(fz, fz + front * 2.2), z1: Math.max(fz, fz + front * 2.2), h: 1.4, tower: false });
    }
    // retranqueos estilo preguerra
    if (kind === 'stone' && h > 15 && w > 10 && d > 9 && r() < 0.6) {
      const s = rr(2, 3.2);
      const h2 = Math.min(33, h + rr(4, 7));
      tb = [b.x0 + s, b.z0 + s, b.x1 - s, b.z1 - s];
      c.parts.push({ pool: 'stone', b: [tb[0], h, tb[1], tb[2], h2, tb[3]], color: col });
      c.parts.push({ pool: 'box', b: [tb[0] - 0.2, h2 - 0.45, tb[1] - 0.2, tb[2] + 0.2, h2, tb[3] + 0.2], color: 0x8d8270 });
      c.obstacles.push({ x0: tb[0], x1: tb[2], z0: tb[1], z1: tb[3], h: h2, tower: false });
      topH = h2;
    }
    // depósitos de agua de madera sobre los tejados
    const tw = tb[2] - tb[0], td = tb[3] - tb[1];
    if (kind !== 'glass' && topH < 30 && tw > 6 && td > 6 && r() < (kind === 'brownstone' ? 0.12 : 0.5)) {
      this.waterTower(c, rr(tb[0] + 2.5, tb[2] - 2.5), rr(tb[1] + 2.5, tb[3] - 2.5), topH, rr);
    } else if (r() < 0.55) {
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const ax = rr(tb[0] + 1.5, tb[2] - 1.5), az = rr(tb[1] + 1.5, tb[3] - 1.5);
        c.parts.push({ pool: 'box', b: [ax - 0.7, topH, az - 0.5, ax + 0.7, topH + 0.9, az + 0.5], color: 0x8a8d90 });
        c.obstacles.push({ x0: ax - 0.7, x1: ax + 0.7, z0: az - 0.5, z1: az + 0.5, h: topH + 0.9, tower: false });
      }
    }
    // carteles luminosos (Times Square en Midtown)
    if ((type === 'midtown' && r() < 0.75) || (type === 'mixed' && r() < 0.12)) {
      this.billboards(ctx, b, Math.min(h, 24));
    }
    // monedas y gemas en el tejado: premian subir
    if (r() < 0.4 && tw > 4 && td > 4) {
      const alongX = tw > td;
      for (let i = 0; i < 4; i++) {
        const u = (i + 0.5) / 4;
        const px = alongX ? tb[0] + 1 + u * (tw - 2) : (tb[0] + tb[2]) / 2;
        const pz = alongX ? (tb[1] + tb[3]) / 2 : tb[1] + 1 + u * (td - 2);
        c.coins.push({ x: px, y: topH + 2.1, z: pz, gem: false });
      }
    }
    if (topH > 20 && r() < 0.3) {
      c.coins.push({ x: (tb[0] + tb[2]) / 2, y: topH + 2.6, z: (tb[1] + tb[3]) / 2, gem: true });
    }
  }

  waterTower(c, tx, tz, base, rr) {
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      c.parts.push({ pool: 'cyl', center: [tx + lx * 1.1, base, tz + lz * 1.1], scale: [0.12, 2.4, 0.12], color: 0x2b2b2b });
    }
    const r0 = rr(1.5, 1.9);
    c.parts.push({ pool: 'cyl', center: [tx, base + 2.4, tz], scale: [r0, 3.2, r0], color: 0x7b5a3c });
    c.parts.push({ pool: 'cyl', center: [tx, base + 3.0, tz], scale: [r0 + 0.04, 0.12, r0 + 0.04], color: 0x2b2b2b });
    c.parts.push({ pool: 'cyl', center: [tx, base + 4.4, tz], scale: [r0 + 0.04, 0.12, r0 + 0.04], color: 0x2b2b2b });
    c.parts.push({ pool: 'cone', center: [tx, base + 5.6, tz], scale: [r0 + 0.15, 1.3, r0 + 0.15], color: 0x4a3a2c });
    c.obstacles.push({ x0: tx - r0, x1: tx + r0, z0: tz - r0, z1: tz + r0, h: base + 6.9, tower: false });
  }

  billboards(ctx, b, hMax) {
    const { c, r, rr } = ctx;
    if (hMax < 9) return;
    const faces = [
      { n: [0, 1], u0: b.x0, u1: b.x1, k: b.z1, rot: 0 },
      { n: [0, -1], u0: b.x0, u1: b.x1, k: b.z0, rot: Math.PI },
      { n: [1, 0], u0: b.z0, u1: b.z1, k: b.x1, rot: Math.PI / 2 },
      { n: [-1, 0], u0: b.z0, u1: b.z1, k: b.x0, rot: -Math.PI / 2 },
    ];
    for (const f of faces) {
      if (r() > 0.55) continue;
      const L = f.u1 - f.u0;
      if (L < 7) continue;
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const w = rr(5, Math.min(14, L - 2));
        const hh = w * rr(0.42, 0.58);
        if (hh > hMax - 5) continue;
        const y = rr(4.4, hMax - hh - 0.8) + hh / 2;
        const u = rr(f.u0 + w / 2 + 0.5, f.u1 - w / 2 - 0.5);
        const off = 0.14 + i * 0.04;
        const x = f.n[0] ? f.k + f.n[0] * off : u;
        const z = f.n[1] ? f.k + f.n[1] * off : u;
        c.parts.push({ pool: 'bill', center: [x, y, z], scale: [w, hh, 1], rotY: f.rot, tile: Math.floor(r() * BILLBOARD_TILES) });
      }
    }
  }

  /** Rascacielos infranqueables, inspirados en los iconos de Manhattan. Llevan balizas rojas. */
  genTower(ctx, lotB) {
    const { c, r, rr, pick, type } = ctx;
    const ins = 1.2;
    const x0 = lotB[0] + ins, z0 = lotB[1] + ins, x1 = lotB[2] - ins, z1 = lotB[3] - ins;
    const w = x1 - x0, d = z1 - z0;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const t = r();
    const style = type === 'midtown'
      ? (t < 0.38 ? 'glass' : t < 0.62 ? 'deco' : t < 0.8 ? 'chrysler' : 'taper')
      : (t < 0.7 ? 'glass' : 'deco');
    const crownCol = pick(CROWN_LIGHTS);
    let top;
    const stoneCol = pick(STONE);

    if (style === 'glass') {
      const h = rr(85, 175);
      const col = pick(TOWER_GLASS);
      if (r() < 0.5) {
        // podio y torre
        const ph = rr(14, 22);
        c.parts.push({ pool: 'glass', b: [x0, 0, z0, x1, ph, z1], color: col });
        this.billboards(ctx, { x0, x1, z0, z1 }, ph);
        const sx = w * rr(0.12, 0.22), sz = d * rr(0.05, 0.12);
        c.parts.push({ pool: 'glass', b: [x0 + sx, ph, z0 + sz, x1 - sx, h, z1 - sz], color: col });
        c.parts.push({ pool: 'glow', b: [x0 + sx - 0.1, h - 3, z0 + sz - 0.1, x1 - sx + 0.1, h - 2.2, z1 - sz + 0.1], color: crownCol });
        c.parts.push({ pool: 'box', b: [x0 + sx + 2, h, z0 + sz + 2, x1 - sx - 2, h + 4, z1 - sz - 2], color: 0x30353c });
      } else {
        c.parts.push({ pool: 'glass', b: [x0, 0, z0, x1, h, z1], color: col });
        c.parts.push({ pool: 'glow', b: [x0 - 0.1, h - 3, z0 - 0.1, x1 + 0.1, h - 2.2, z1 + 0.1], color: crownCol });
        c.parts.push({ pool: 'box', b: [x0 + 3, h, z0 + 3, x1 - 3, h + 4, z1 - 3], color: 0x30353c });
      }
      c.parts.push({ pool: 'metal', center: [mx, h + 4, mz], scale: [0.25, rr(10, 22), 0.25], color: 0xb0b6bc });
      top = h + 4;
    } else if (style === 'deco') {
      // estilo Empire State: base ancha, fuste, retranqueos, corona iluminada y mástil
      const h = rr(150, 225);
      const hb = rr(22, 30);
      c.parts.push({ pool: 'stone', b: [x0, 0, z0, x1, hb, z1], color: stoneCol });
      this.billboards(ctx, { x0, x1, z0, z1 }, hb);
      const s1x = w * 0.2, s1z = d * 0.12;
      c.parts.push({ pool: 'stone', b: [x0 + s1x, hb, z0 + s1z, x1 - s1x, h * 0.72, z1 - s1z], color: stoneCol });
      const s2x = w * 0.27, s2z = d * 0.2;
      c.parts.push({ pool: 'stone', b: [x0 + s2x, h * 0.72, z0 + s2z, x1 - s2x, h * 0.8, z1 - s2z], color: stoneCol });
      const s3x = w * 0.33, s3z = d * 0.27;
      c.parts.push({ pool: 'stone', b: [x0 + s3x, h * 0.8, z0 + s3z, x1 - s3x, h * 0.86, z1 - s3z], color: stoneCol });
      const cr = Math.min(w - 2 * s3x, d - 2 * s3z) * 0.38;
      c.parts.push({ pool: 'glowCyl', center: [mx, h * 0.86, mz], scale: [cr, h * 0.05, cr], color: crownCol });
      c.parts.push({ pool: 'stone', b: [mx - cr * 0.7, h * 0.91, mz - cr * 0.7, mx + cr * 0.7, h * 0.93, mz + cr * 0.7], color: stoneCol });
      c.parts.push({ pool: 'metal', center: [mx, h * 0.93, mz], scale: [1.1, h * 0.05, 1.1], color: 0xc9ccd0 });
      c.parts.push({ pool: 'metal', center: [mx, h * 0.98, mz], scale: [0.35, h * 0.1, 0.35], color: 0xc9ccd0 });
      top = h * 1.08;
    } else if (style === 'chrysler') {
      // estilo Chrysler: fuste de piedra y corona escalonada de acero con anillos de luz
      const h = rr(140, 195);
      const hb = rr(24, 32);
      c.parts.push({ pool: 'stone', b: [x0, 0, z0, x1, hb, z1], color: stoneCol });
      this.billboards(ctx, { x0, x1, z0, z1 }, hb);
      const sq = Math.min(w * 0.55, d * 0.85);
      c.parts.push({ pool: 'stone', b: [mx - sq / 2, hb, mz - sq / 2, mx + sq / 2, h * 0.78, mz + sq / 2], color: 0xb8b4ac });
      let y = h * 0.78;
      for (let k = 0; k < 6; k++) {
        const rk = (sq / 2) * (0.78 - k * 0.12);
        const hk = h * 0.028;
        c.parts.push({ pool: 'metal', center: [mx, y, mz], scale: [rk, hk, rk], color: 0xd6d8dc });
        c.parts.push({ pool: 'glowCyl', center: [mx, y + hk * 0.15, mz], scale: [rk * 1.03, hk * 0.35, rk * 1.03], color: [2.6, 2.5, 2.2] });
        y += hk;
      }
      c.parts.push({ pool: 'metalCone', center: [mx, y, mz], scale: [1.4, h * 0.16, 1.4], color: 0xe2e4e8 });
      top = y + h * 0.16;
    } else {
      // estilo One World Trade Center: base cúbica, prisma que se estrecha y aguja
      const h = rr(170, 235);
      const s = Math.min(w, d);
      const hb = 24;
      c.parts.push({ pool: 'glass', b: [mx - s / 2, 0, mz - s / 2, mx + s / 2, hb, mz + s / 2], color: 0x2a3340 });
      const rad = s / Math.SQRT2;
      c.parts.push({ pool: 'taper', center: [mx, hb, mz], scale: [rad, h - hb, rad], color: 0x55687c, rotY: 0 });
      const ts = 0.42 * s;
      c.parts.push({ pool: 'glow', b: [mx - ts / 2 - 0.1, h - 0.4, mz - ts / 2 - 0.1, mx + ts / 2 + 0.1, h + 0.6, mz + ts / 2 + 0.1], color: [2.0, 2.2, 2.6] });
      c.parts.push({ pool: 'metal', center: [mx, h + 0.6, mz], scale: [0.7, h * 0.24, 0.7], color: 0xd0d4d8 });
      top = h + 0.6 + h * 0.24;
    }
    // balizas rojas: aviso de que no se puede pasar por encima
    c.parts.push({ pool: 'beacon', center: [mx, top + 0.4, mz], scale: [1.4, 1.4, 1.4] });
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      c.parts.push({ pool: 'beacon', center: [px, 10, pz], scale: [0.9, 0.9, 0.9] });
      c.parts.push({ pool: 'beacon', center: [px, 40, pz], scale: [1, 1, 1] });
    }
    c.obstacles.push({ x0, x1, z0, z1, h: top, tower: true });
  }

  // ---------- Consultas de altura ----------

  /**
   * Altura de la superficie en (x, z): terreno, edificios y objetos, con un margen r.
   * towers: incluir rascacielos. soft: incluir árboles y heno (los pilares de la vía los ignoran).
   */
  heightAt(x, z, r = 0, towers = false, soft = true) {
    const c = this.cell(Math.floor(x / CELL_X), Math.floor(z / CELL_Z));
    let h = c.city ? 0 : this.biomes.ground(x, z);
    const obs = c.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (!towers && o.tower) continue;
      if (!soft && o.soft) continue;
      if (x + r > o.x0 && x - r < o.x1 && z + r > o.z0 && z - r < o.z1 && o.h > h) h = o.h;
    }
    return h;
  }

  towerHit(x, z, r = 0) {
    const c = this.cell(Math.floor(x / CELL_X), Math.floor(z / CELL_Z));
    const obs = c.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.tower && x + r > o.x0 && x - r < o.x1 && z + r > o.z0 && z - r < o.z1) return true;
    }
    return false;
  }

  // ---------- Carga / descarga de mallas ----------

  update(pos, maxLoads = 10) {
    const ccx = Math.floor(pos.x / CELL_X);
    const ccz = Math.floor(pos.z / CELL_Z);
    const rx = Math.ceil(VIEW_DIST / CELL_X) + 1;
    const rz = Math.ceil(VIEW_DIST / CELL_Z) + 1;
    const missing = [];
    for (let dx = -rx; dx <= rx; dx++) {
      for (let dz = -rz; dz <= rz; dz++) {
        const cx = ccx + dx, cz = ccz + dz;
        const ex = (cx + 0.5) * CELL_X - pos.x, ez = (cz + 0.5) * CELL_Z - pos.z;
        const d2 = ex * ex + ez * ez;
        if (d2 > VIEW_DIST * VIEW_DIST) continue;
        if (!this.loaded.has(cx + ',' + cz)) missing.push([d2, cx, cz]);
      }
    }
    missing.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < missing.length && i < maxLoads; i++) this.loadCell(missing[i][1], missing[i][2]);
    const lim = (VIEW_DIST + 90) * (VIEW_DIST + 90);
    for (const [key, lc] of this.loaded) {
      const ex = (lc.cx + 0.5) * CELL_X - pos.x, ez = (lc.cz + 0.5) * CELL_Z - pos.z;
      if (ex * ex + ez * ez > lim) this.unloadCell(key);
    }
    if (this.cache.size > 5000) {
      for (const [key, c] of this.cache) {
        if (this.loaded.has(key)) continue;
        if (Math.abs(c.cx - ccx) > rx * 3 || Math.abs(c.cz - ccz) > rz * 3) this.cache.delete(key);
      }
    }
    this.terrain.update(pos);
    for (const k in this.pools) this.pools[k].flush();
  }

  loadCell(cx, cz) {
    const c = this.cell(cx, cz);
    const slots = [];
    for (const part of c.parts) {
      const pool = this.pools[part.pool];
      let m;
      if (part.b) {
        m = boxMatrix(part.b);
      } else {
        _p.set(part.center[0], part.center[1], part.center[2]);
        _s.set(part.scale[0], part.scale[1], part.scale[2]);
        const rot = part.rotY !== undefined ? part.rotY : part.pool === 'crown' ? (part.center[0] * 7.31 + part.center[2]) % 6.28 : 0;
        if (part.rot) _q.setFromEuler(_e.set(part.rot[0], part.rot[1], part.rot[2]));
        else _q.setFromAxisAngle(Y_AXIS, rot);
        m = _m.compose(_p, _q, _s);
      }
      let col = null;
      if (part.color !== undefined) col = Array.isArray(part.color) ? _c.setRGB(part.color[0], part.color[1], part.color[2]) : _c.set(part.color);
      const slot = pool.alloc(m, col);
      if (slot < 0) continue;
      if (part.tile !== undefined) pool.mesh.geometry.attributes.aTile.setX(slot, part.tile);
      slots.push([pool, slot]);
    }
    const coins = [];
    c.coins.forEach((coin, i) => {
      const id = c.key + ':' + i;
      if (this.collected.has(id)) return;
      const pool = coin.gem ? this.pools.gem : this.pools.coin;
      _p.set(coin.x, coin.y, coin.z);
      _q.identity();
      _s.set(1, 1, 1);
      const slot = pool.alloc(_m.compose(_p, _q, _s));
      if (slot >= 0) coins.push({ id, x: coin.x, y: coin.y, z: coin.z, gem: coin.gem, pool, slot });
    });
    const dyn = [];
    for (const d of c.dyn) {
      if (d.type === 'blades') {
        const g = new THREE.Group();
        g.position.set(d.x, d.y, d.z);
        g.rotation.y = d.rotY;
        const m = new THREE.Mesh(this.bladesGeo, this.bladesMat);
        m.castShadow = true;
        m.userData.p0 = d.phase;
        g.add(m);
        this.scene.add(g);
        this.spinners.push(m);
        dyn.push(g);
      }
    }
    this.loaded.set(c.key, { cx, cz, slots, coins, vents: c.vents, dyn });
  }

  unloadCell(key) {
    const lc = this.loaded.get(key);
    if (!lc) return;
    for (const [pool, slot] of lc.slots) pool.release(slot);
    for (const coin of lc.coins) coin.pool.release(coin.slot);
    for (const g of lc.dyn) {
      this.scene.remove(g);
      const i = this.spinners.indexOf(g.children[0]);
      if (i >= 0) this.spinners.splice(i, 1);
    }
    this.loaded.delete(key);
  }

  /** Recoge las monedas cercanas a p. Devuelve una lista de monedas recogidas. */
  collect(p, radius) {
    const out = [];
    const ccx = Math.floor(p.x / CELL_X), ccz = Math.floor(p.z / CELL_Z);
    const r2 = radius * radius;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const lc = this.loaded.get(ccx + dx + ',' + (ccz + dz));
        if (!lc) continue;
        for (let i = lc.coins.length - 1; i >= 0; i--) {
          const coin = lc.coins[i];
          const ex = coin.x - p.x, ey = coin.y - p.y, ez = coin.z - p.z;
          if (ex * ex + ey * ey + ez * ez < r2) {
            coin.pool.release(coin.slot);
            this.collected.add(coin.id);
            lc.coins.splice(i, 1);
            out.push(coin);
          }
        }
      }
    }
    return out;
  }

  tick(time) {
    this.coinMat.userData.uniforms.uTime.value = time;
    this.gemMat.userData.uniforms.uTime.value = time;
    this.billMat.userData.uniforms.uTime.value = time;
    this.beaconMat.emissiveIntensity = Math.sin(time * 4.2) > 0.1 ? 5 : 0.4;
    for (const s of this.spinners) s.rotation.z = time * 1.4 + s.userData.p0;
  }
}
