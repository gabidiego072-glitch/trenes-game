import * as THREE from 'three';
import { CELL, LOT_INSET, VIEW_CELLS } from './config.js';
import { mulberry32, hash2 } from './utils.js';
import { makeBuildingMaterial, makeGroundMaterial, makeSpinMaterial } from './materials.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Malla instanciada con huecos reutilizables. */
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
    this.hwm = 0; // solo se dibujan las instancias hasta la más alta usada
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
    this.dirty = false;
  }
}

const PALETTE = [
  0xb9a68f, 0xa8927a, 0x9c6b55, 0x8a5a48, 0xc4b8a8, 0x7f8a8c, 0x6f7f86,
  0xa3a7a0, 0xc9b28c, 0x8e7d72, 0x9a8f86, 0xb07d62, 0x758078, 0xd0c4b0,
];
const TOWER_PALETTE = [0x2a3a4e, 0x24303f, 0x30384a, 0x1f2c3a, 0x3a3f4f];
const TREE_GREENS = [0x3f6b35, 0x4d7a3a, 0x355f30, 0x5a8a40, 0x2f5a3a];

function boxMatrix(x0, y0, z0, x1, y1, z1) {
  _p.set((x0 + x1) / 2, y0, (z0 + z1) / 2);
  _s.set(x1 - x0, y1 - y0, z1 - z0);
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

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
    cyl.translate(0, 0.5, 0);
    const cone = new THREE.ConeGeometry(1, 1, 12);
    cone.translate(0, 0.5, 0);
    const crown = new THREE.IcosahedronGeometry(1, 0);
    const beaconGeo = new THREE.SphereGeometry(0.45, 8, 6);
    const coinGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 16);
    coinGeo.rotateX(Math.PI / 2);
    const gemGeo = new THREE.OctahedronGeometry(1.1, 0);
    gemGeo.scale(0.8, 1.25, 0.8);

    this.bldMat = makeBuildingMaterial();
    this.twrMat = makeBuildingMaterial({
      cw: 1.7, ch: 3.7, wx: [0.05, 0.95], wy: [0.18, 0.92], lit: 0.22,
      shop: false, glass: [0.03, 0.05, 0.08], roughness: 0.4,
    });
    this.beaconMat = new THREE.MeshStandardMaterial({
      color: 0x330000, emissive: 0xff2020, emissiveIntensity: 4,
    });
    this.coinMat = makeSpinMaterial({
      color: 0xffc23a, emissive: 0xff9a00, emissiveIntensity: 0.9, metalness: 0.9, roughness: 0.25,
    });
    this.gemMat = makeSpinMaterial({
      color: 0x55e7ff, emissive: 0x1aa8ff, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.1,
      flatShading: true,
    });
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x1b4a5c, roughness: 0.08, metalness: 0.6 });
    const std = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });

    this.pools = {
      bld: new Pool(scene, box, this.bldMat, 3000),
      twr: new Pool(scene, box, this.twrMat, 700),
      box: new Pool(scene, box, std, 3000),
      cyl: new Pool(scene, cyl, std, 1600),
      cone: new Pool(scene, cone, std, 400),
      crown: new Pool(scene, crown, leaf, 1200),
      beacon: new Pool(scene, beaconGeo, this.beaconMat, 2400, { cast: false, receive: false, color: false }),
      coin: new Pool(scene, coinGeo, this.coinMat, 3000, { cast: false, receive: false, color: false }),
      gem: new Pool(scene, gemGeo, this.gemMat, 400, { cast: false, receive: false, color: false }),
      water: new Pool(scene, box, this.waterMat, 300, { cast: false, color: false }),
    };

    // Suelo infinito: un plano grande que sigue al tren; el dibujo depende de la posición en mundo.
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), makeGroundMaterial());
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground);
  }

  reset(seed) {
    for (const key of [...this.loaded.keys()]) this.unloadCell(key);
    this.cache.clear();
    this.collected.clear();
    this.seed = seed;
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
    const c = {
      cx, cz, key: cx + ',' + cz,
      type: 'city',
      obstacles: [], // {x0,x1,z0,z1,h,tower}
      parts: [],     // piezas visuales {pool, x0,y0,z0,x1,y1,z1, color} o {pool, matrix...}
      coins: [],     // {x,y,z,gem}
    };
    const x0 = cx * CELL + LOT_INSET;
    const x1 = (cx + 1) * CELL - LOT_INSET;
    const z0 = cz * CELL + LOT_INSET;
    const z1 = (cz + 1) * CELL - LOT_INSET;
    const dist = Math.hypot((cx + 0.5) * CELL, (cz + 0.5) * CELL);
    const nearStart = dist < 90;

    const t = r();
    if (!nearStart && t < 0.1) c.type = 'park';
    else if (!nearStart && t < 0.15) c.type = 'lake';

    if (c.type === 'park') {
      c.parts.push({ pool: 'box', b: [x0 - 0.5, 0, z0 - 0.5, x1 + 0.5, 0.12, z1 + 0.5], color: 0x3e5f2f });
      const n = 7 + Math.floor(r() * 9);
      for (let i = 0; i < n; i++) {
        const tx = rr(x0 + 2.5, x1 - 2.5);
        const tz = rr(z0 + 2.5, z1 - 2.5);
        const trunk = rr(1.8, 3.2);
        const cr = rr(1.6, 2.7);
        c.parts.push({ pool: 'cyl', b: [tx - 0.22, 0, tz - 0.22, tx + 0.22, trunk + cr * 0.5, tz + 0.22], color: 0x5a3e2b });
        c.parts.push({ pool: 'crown', center: [tx, trunk + cr * 0.9, tz], scale: [cr, cr * 1.25, cr], color: pick(TREE_GREENS) });
        c.obstacles.push({ x0: tx - cr * 0.8, x1: tx + cr * 0.8, z0: tz - cr * 0.8, z1: tz + cr * 0.8, h: trunk + cr * 2.0, tower: false });
      }
      // arco de monedas por el parque
      const along = r() < 0.5;
      for (let i = 0; i < 6; i++) {
        const u = (i + 0.5) / 6;
        const px = along ? x0 + 4 + u * (x1 - x0 - 8) : (x0 + x1) / 2;
        const pz = along ? (z0 + z1) / 2 : z0 + 4 + u * (z1 - z0 - 8);
        c.coins.push({ x: px, y: 1.9, z: pz, gem: false, onRoof: false });
      }
    } else if (c.type === 'lake') {
      c.parts.push({ pool: 'box', b: [x0 - 0.5, 0, z0 - 0.5, x1 + 0.5, 0.25, z1 + 0.5], color: 0x6f6a62 });
      c.parts.push({ pool: 'water', b: [x0 + 0.6, 0, z0 + 0.6, x1 - 0.6, 0.3, z1 - 0.6] });
      // monedas sobre el agua y una gema en el centro
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        c.coins.push({ x: (x0 + x1) / 2 + Math.cos(a) * 9, y: 2.0, z: (z0 + z1) / 2 + Math.sin(a) * 9, gem: false });
      }
      if (r() < 0.5) c.coins.push({ x: (x0 + x1) / 2, y: 2.3, z: (z0 + z1) / 2, gem: true });
    } else {
      // manzana de ciudad: 1, 2 o 4 edificios
      const lots = [];
      const layout = r();
      const gap = 2.4;
      if (layout < 0.22) lots.push([x0, z0, x1, z1]);
      else if (layout < 0.47) {
        const s = rr(0.38, 0.62) * (x1 - x0) + x0;
        lots.push([x0, z0, s - gap / 2, z1], [s + gap / 2, z0, x1, z1]);
      } else if (layout < 0.72) {
        const s = rr(0.38, 0.62) * (z1 - z0) + z0;
        lots.push([x0, z0, x1, s - gap / 2], [x0, s + gap / 2, x1, z1]);
      } else {
        const sx = rr(0.4, 0.6) * (x1 - x0) + x0;
        const sz = rr(0.4, 0.6) * (z1 - z0) + z0;
        lots.push(
          [x0, z0, sx - gap / 2, sz - gap / 2], [sx + gap / 2, z0, x1, sz - gap / 2],
          [x0, sz + gap / 2, sx - gap / 2, z1], [sx + gap / 2, sz + gap / 2, x1, z1]
        );
      }
      const towerChance = dist < 160 ? 0 : Math.min(0.24, 0.05 + (dist - 160) / 3500);
      for (const lot of lots) this.genBuilding(c, lot, towerChance, nearStart, r, rr, pick);
    }

    // monedas sobre la calle (cada celda tiene la calle de su borde oeste y sur)
    if (r() < 0.55) {
      const alongZ = r() < 0.5;
      const lane = (r() < 0.5 ? -1 : 1) * 2.2;
      const startU = rr(8, 20);
      for (let i = 0; i < 6; i++) {
        const u = startU + i * 4;
        if (alongZ) c.coins.push({ x: cx * CELL + lane, y: 1.9, z: cz * CELL + u, gem: false });
        else c.coins.push({ x: cx * CELL + u, y: 1.9, z: cz * CELL + lane, gem: false });
      }
    }
    return c;
  }

  genBuilding(c, lot, towerChance, nearStart, r, rr, pick) {
    const ins = () => rr(0.4, 1.6);
    const bx0 = lot[0] + ins(), bz0 = lot[1] + ins(), bx1 = lot[2] - ins(), bz1 = lot[3] - ins();
    const w = bx1 - bx0, d = bz1 - bz0;
    if (w < 5 || d < 5) return;
    const isTower = !nearStart && w >= 9 && d >= 9 && r() < towerChance;
    if (isTower) {
      const h = rr(62, 115);
      const color = pick(TOWER_PALETTE);
      c.parts.push({ pool: 'twr', b: [bx0, 0, bz0, bx1, h, bz1], color });
      // corona superior escalonada
      const ix = Math.min(w, d) * 0.18;
      const h2 = h + rr(4, 9);
      c.parts.push({ pool: 'twr', b: [bx0 + ix, h, bz0 + ix, bx1 - ix, h2, bz1 - ix], color });
      // antena con baliza roja
      const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
      const ah = rr(8, 16);
      c.parts.push({ pool: 'cyl', b: [mx - 0.18, h2, mz - 0.18, mx + 0.18, h2 + ah, mz + 0.18], color: 0x888c90 });
      c.parts.push({ pool: 'beacon', center: [mx, h2 + ah + 0.3, mz], scale: [1.3, 1.3, 1.3] });
      // balizas en las esquinas y a media altura: estos edificios NO se pueden saltar
      for (const [px, pz] of [[bx0, bz0], [bx1, bz0], [bx0, bz1], [bx1, bz1]]) {
        c.parts.push({ pool: 'beacon', center: [px, h + 0.4, pz], scale: [1, 1, 1] });
        c.parts.push({ pool: 'beacon', center: [px, 9, pz], scale: [0.9, 0.9, 0.9] });
      }
      c.obstacles.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, h: h2, tower: true });
      return;
    }
    const cls = r();
    let h;
    if (nearStart) h = rr(4, 10);
    else if (cls < 0.32) h = rr(4.5, 11);
    else if (cls < 0.74) h = rr(11, 21);
    else h = rr(21, 29);
    const color = pick(PALETTE);
    _c.set(color).offsetHSL(rr(-0.02, 0.02), rr(-0.05, 0.05), rr(-0.04, 0.04));
    const col = _c.getHex();
    c.parts.push({ pool: 'bld', b: [bx0, 0, bz0, bx1, h, bz1], color: col });
    // cornisa: banda oscura justo bajo el tejado
    c.parts.push({ pool: 'box', b: [bx0 - 0.25, h - 0.55, bz0 - 0.25, bx1 + 0.25, h, bz1 + 0.25], color: 0x4a4440 });
    c.obstacles.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, h, tower: false });
    let topH = h;
    let tb = [bx0, bz0, bx1, bz1];
    // retranqueo superior en edificios altos
    if (h > 14 && w > 10 && d > 10 && r() < 0.45) {
      const s = rr(2, 3.5);
      const h2 = h + rr(3, 6);
      tb = [bx0 + s, bz0 + s, bx1 - s, bz1 - s];
      c.parts.push({ pool: 'bld', b: [tb[0], h, tb[1], tb[2], h2, tb[3]], color: col });
      c.parts.push({ pool: 'box', b: [tb[0] - 0.2, h2 - 0.45, tb[1] - 0.2, tb[2] + 0.2, h2, tb[3] + 0.2], color: 0x4a4440 });
      c.obstacles.push({ x0: tb[0], x1: tb[2], z0: tb[1], z1: tb[3], h: h2, tower: false });
      topH = h2;
    } else if (h < 22 && r() < 0.22) {
      // depósito de agua sobre el tejado
      const tx = rr(bx0 + 2.5, bx1 - 2.5), tz = rr(bz0 + 2.5, bz1 - 2.5);
      c.parts.push({ pool: 'cyl', b: [tx - 0.3, h, tz - 0.3, tx + 0.3, h + 2.2, tz + 0.3], color: 0x3a3a3a });
      c.parts.push({ pool: 'cyl', b: [tx - 1.5, h + 2.2, tz - 1.5, tx + 1.5, h + 5, tz + 1.5], color: 0x7a5a3c });
      c.parts.push({ pool: 'cone', b: [tx - 1.65, h + 5, tz - 1.65, tx + 1.65, h + 6.2, tz + 1.65], color: 0x4a3a2c });
      c.obstacles.push({ x0: tx - 1.6, x1: tx + 1.6, z0: tz - 1.6, z1: tz + 1.6, h: h + 6.2, tower: false });
    } else if (r() < 0.6) {
      // equipos de aire acondicionado (bajos, la vía pasa por encima)
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const ax = rr(tb[0] + 1.5, tb[2] - 1.5), az = rr(tb[1] + 1.5, tb[3] - 1.5);
        c.parts.push({ pool: 'box', b: [ax - 0.7, topH, az - 0.5, ax + 0.7, topH + 0.9, az + 0.5], color: 0x8a8d90 });
        c.obstacles.push({ x0: ax - 0.7, x1: ax + 0.7, z0: az - 0.5, z1: az + 0.5, h: topH + 0.9, tower: false });
      }
    }
    // monedas en el tejado: premian subir
    if (r() < 0.42) {
      const alongX = tb[2] - tb[0] > tb[3] - tb[1];
      const n = 4;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const px = alongX ? tb[0] + 1 + u * (tb[2] - tb[0] - 2) : (tb[0] + tb[2]) / 2;
        const pz = alongX ? (tb[1] + tb[3]) / 2 : tb[1] + 1 + u * (tb[3] - tb[1] - 2);
        c.coins.push({ x: px, y: topH + 2.1, z: pz, gem: false, roof: true });
      }
    }
    if (topH > 20 && r() < 0.3) {
      c.coins.push({ x: (tb[0] + tb[2]) / 2, y: topH + 2.6, z: (tb[1] + tb[3]) / 2, gem: true, roof: true });
    }
  }

  // ---------- Consultas de altura ----------

  /** Altura de la superficie bajo (x,z) con un margen r. */
  heightAt(x, z, r = 0, towers = false) {
    const c = this.cell(Math.floor(x / CELL), Math.floor(z / CELL));
    let h = 0;
    const obs = c.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (!towers && o.tower) continue;
      if (x + r > o.x0 && x - r < o.x1 && z + r > o.z0 && z - r < o.z1 && o.h > h) h = o.h;
    }
    return h;
  }

  towerHit(x, z, r = 0) {
    const c = this.cell(Math.floor(x / CELL), Math.floor(z / CELL));
    const obs = c.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.tower && x + r > o.x0 && x - r < o.x1 && z + r > o.z0 && z - r < o.z1) return true;
    }
    return false;
  }

  // ---------- Carga / descarga de mallas ----------

  update(pos, maxLoads = 14) {
    const ccx = Math.floor(pos.x / CELL);
    const ccz = Math.floor(pos.z / CELL);
    let loads = 0;
    const R = VIEW_CELLS;
    for (let ring = 0; ring <= R && loads < maxLoads; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          if (dx * dx + dz * dz > R * R + 1) continue;
          const key = ccx + dx + ',' + (ccz + dz);
          if (!this.loaded.has(key)) {
            this.loadCell(ccx + dx, ccz + dz);
            if (++loads >= maxLoads) break;
          }
        }
        if (loads >= maxLoads) break;
      }
    }
    const lim = (R + 1.6) * (R + 1.6);
    for (const [key, lc] of this.loaded) {
      const dx = lc.cx - ccx, dz = lc.cz - ccz;
      if (dx * dx + dz * dz > lim) this.unloadCell(key);
    }
    if (this.cache.size > 4000) {
      for (const [key, c] of this.cache) {
        if (this.loaded.has(key)) continue;
        if (Math.abs(c.cx - ccx) + Math.abs(c.cz - ccz) > R * 4) this.cache.delete(key);
      }
    }
    this.ground.position.set(pos.x, 0, pos.z);
    for (const k in this.pools) this.pools[k].flush();
  }

  loadCell(cx, cz) {
    const c = this.cell(cx, cz);
    const slots = [];
    for (const part of c.parts) {
      const pool = this.pools[part.pool];
      let m;
      if (part.b) {
        const b = part.b;
        m = boxMatrix(b[0], b[1], b[2], b[3], b[4], b[5]);
      } else {
        _p.set(part.center[0], part.center[1], part.center[2]);
        _s.set(part.scale[0], part.scale[1], part.scale[2]);
        _q.setFromAxisAngle(_p.clone().set(0, 1, 0), (part.center[0] * 7.31 + part.center[2]) % 6.28);
        m = _m.compose(_p, _q, _s);
      }
      const slot = pool.alloc(m, part.color !== undefined ? _c.set(part.color) : null);
      if (slot >= 0) slots.push([pool, slot]);
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
    this.loaded.set(c.key, { cx, cz, slots, coins });
  }

  unloadCell(key) {
    const lc = this.loaded.get(key);
    if (!lc) return;
    for (const [pool, slot] of lc.slots) pool.release(slot);
    for (const coin of lc.coins) coin.pool.release(coin.slot);
    this.loaded.delete(key);
  }

  /** Recoge las monedas cercanas a p. Devuelve una lista de monedas recogidas. */
  collect(p, radius) {
    const out = [];
    const ccx = Math.floor(p.x / CELL), ccz = Math.floor(p.z / CELL);
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
    this.beaconMat.emissiveIntensity = Math.sin(time * 4.2) > 0.1 ? 5 : 0.4;
  }
}
