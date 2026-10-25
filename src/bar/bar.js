import * as THREE from 'three';
import { Customer } from './customers.js';
import * as F from './food.js';
import { Particles } from '../effects.js';
import { enterCar, makeLabel } from '../interior.js';

// Medidas del vagón restaurante (coordenadas locales del vagón, suelo en y = 0)
const FLOOR_Y = 1.25;
const W2 = 2.2;          // media anchura interior
const L2 = 4.6;          // media longitud interior
const H = 2.55;          // altura del techo
const CAM = new THREE.Vector3(1.38, 1.8, -0.35); // desde atrás: se ve todo el mostrador y la barra
const STOOLS = [1.25, 0, -1.25];   // asiento 1 a la izquierda de la pantalla
const STOOL_X = -1.12;
const AISLE_X = -1.78;
const DOOR_Z = 4.25;
const BAR_Y = 1.05;      // superficie de la barra de los clientes
const SHIFT = 240;       // duración del turno (s)
const SLOTS = [0.3, 0.45, 0.6];
const TAPS = [
  { flavor: 'cola', z: -1.28 },
  { flavor: 'naranja', z: -1.43 },
  { flavor: 'limon', z: -1.58 },
];
const HAND_BASE = new THREE.Vector3(0.25, -0.3, -0.5);

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _ndc = new THREE.Vector2();

function std(color, o = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6 }, o));
}
function phys(color, o = {}) {
  return new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.5 }, o));
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Brazo y mano del camarero en primera persona (camisa blanca arremangada). */
function makeFPHand() {
  const g = new THREE.Group();
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xe8b796, roughness: 0.6, sheen: 0.3, sheenColor: new THREE.Color(0xffd6c8) });
  const shirt = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f2, roughness: 0.85, sheen: 0.6 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    g.add(o);
    return o;
  };
  // antebrazo que entra desde abajo a la derecha
  add(new THREE.CapsuleGeometry(0.036, 0.26, 6, 14), skin, 0.06, -0.12, 0.12, 1.2, 0, 0.35);
  add(new THREE.CylinderGeometry(0.046, 0.05, 0.12, 16), shirt, 0.1, -0.2, 0.24, 1.2, 0, 0.35);
  // palma y dedos sujetando
  const palm = add(new THREE.SphereGeometry(0.042, 18, 14), skin, 0, 0, 0);
  palm.scale.set(0.9, 0.55, 1.15);
  for (let i = 0; i < 4; i++) {
    const f = add(new THREE.CapsuleGeometry(0.0095, 0.035, 4, 8), skin, -0.03 + i * 0.019, 0.012, -0.045, -1.1, 0, 0);
    f.scale.setScalar(1 - Math.abs(i - 1.5) * 0.08);
  }
  add(new THREE.CapsuleGeometry(0.011, 0.03, 4, 8), skin, -0.045, 0.01, 0.0, 0, 0, 1.1);
  g.traverse((m) => {
    if (m.isMesh) m.castShadow = false;
  });
  return g;
}

export class BarMode {
  constructor(camera, sfx) {
    this.camera = camera;
    this.sfx = sfx;
    this.root = new THREE.Group();
    this.root.position.y = FLOOR_Y;
    this.clickables = [];
    this.active = false;
    this.yaw = 0;
    this.yawDrag = 0;
    this.lookFollow = 0;
    this.pitch = -0.42;
    this.pitchFollow = 0;
    this.keysYaw = 0;
    this.customers = [];
    this.build();

    // mano en primera persona con lo que llevas
    this.hand = null;
    this.handRig = new THREE.Group();
    this.handRig.position.copy(HAND_BASE);
    this.handRig.add(makeFPHand());
    this.handItem = new THREE.Group();
    this.handItem.position.set(0, 0.018, -0.03);
    this.handItem.scale.setScalar(0.8);
    this.handRig.add(this.handItem);
    this.handRig.visible = false;
    camera.add(this.handRig);
    this.reach = null;

    this.raycaster = new THREE.Raycaster();
    const $ = (id) => document.getElementById(id);
    this.ui = {
      hud: $('barHud'), money: $('bMoney'), clock: $('bClock'), stars: $('bStars'), hand: $('bHand'),
      hint: $('bHint'), tip: $('bTip'), pop: $('bPop'), drop: $('bDrop'), tickets: $('bTickets'),
    };
    this.hintT = 0;
  }

  // ---------- Construcción del vagón ----------

  build() {
    const R = this.root;
    const add = (geo, mat, x, y, z, parent = R, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const click = (obj, action, label, data = {}) => {
      obj.userData.action = action;
      obj.userData.label = label;
      Object.assign(obj.userData, data);
      this.clickables.push(obj);
      return obj;
    };
    const hitbox = (w, h, d, x, y, z, action, label, data) =>
      click(add(box(w, h, d), new THREE.MeshBasicMaterial({ visible: false }), x, y, z, R, false), action, label, data);
    // etiqueta fija encima de cada puesto
    const tag = (text, x, y, z) => {
      const l = makeLabel(THREE, text, 0.05);
      l.position.set(x, y, z);
      R.add(l);
      return l;
    };
    this.tag = tag;

    // suelo de baldosas blancas y negras
    const tiles = canvasTexture(256, 256, (g) => {
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        g.fillStyle = (i + j) % 2 ? '#1b1b1d' : '#ecebe6';
        g.fillRect(i * 32, j * 32, 32, 32);
      }
    });
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
    tiles.repeat.set(4.4 / 2.4, 9.2 / 2.4);
    const floor = add(new THREE.PlaneGeometry(W2 * 2, L2 * 2), phys(0xffffff, { map: tiles, roughness: 0.3, clearcoat: 0.4 }), 0, 0.001, 0, R, false);
    floor.rotation.x = -Math.PI / 2;

    // techo, madera, latón y cromo
    const cream = std(0xefe3c8, { roughness: 0.8 });
    add(box(W2 * 2 + 0.2, 0.08, L2 * 2 + 0.2), cream, 0, H + 0.04, 0);
    const wood = phys(0x5b2f1a, { roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const darkWood = phys(0x3a1d10, { roughness: 0.5, clearcoat: 0.4 });
    const brass = std(0xc9a14a, { roughness: 0.25, metalness: 0.95 });
    const chrome = std(0xdfe3e8, { roughness: 0.15, metalness: 1 });
    this.mats = { brass, chrome };
    for (const s of [-1, 1]) add(box(0.08, 0.1, L2 * 2), brass, s * (W2 - 0.04), H - 0.05, 0);

    // paredes laterales con ventanas
    const winW = 1.1, pillar = 0.36;
    for (const s of [-1, 1]) {
      const x = s * (W2 + 0.04);
      add(box(0.08, 0.95, L2 * 2), wood, x, 0.475, 0);
      add(box(0.1, 0.06, L2 * 2), brass, x - s * 0.01, 0.95, 0);
      add(box(0.08, H - 2.05, L2 * 2), cream, x, 2.05 + (H - 2.05) / 2, 0);
      let z = -L2;
      while (z < L2 - 0.01) {
        const pw = Math.min(pillar, L2 - z);
        add(box(0.1, 1.1, pw), cream, x, 1.5, z + pw / 2);
        add(box(0.12, 1.1, 0.03), brass, x - s * 0.01, 1.5, z + pw);
        z += pw + winW;
        if (z < L2) add(box(0.12, 1.1, 0.03), brass, x - s * 0.01, 1.5, z);
      }
      const glass = add(box(0.01, 1.1, L2 * 2), phys(0xaaccdd, { transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false }), x - s * 0.02, 1.5, 0, R, false);
      glass.renderOrder = 6;
    }
    for (const s of [-1, 1]) {
      const z = s * (L2 + 0.04);
      add(box(W2 * 2, 1.0, 0.08), wood, 0, 0.5, z);
      add(box(W2 * 2, H - 1.0, 0.08), cream, 0, 1.0 + (H - 1) / 2, z);
      add(box(W2 * 2, 0.05, 0.1), brass, 0, 1.0, z - s * 0.01);
    }
    // puerta
    add(box(0.9, 2.1, 0.06), darkWood, AISLE_X + 0.15, 1.05, L2 - 0.02);
    add(box(0.5, 0.9, 0.02), phys(0x9fc4d6, { transparent: true, opacity: 0.35, roughness: 0.05 }), AISLE_X + 0.15, 1.45, L2 - 0.06, R, false);
    add(new THREE.SphereGeometry(0.03, 12, 8), brass, AISLE_X + 0.5, 1.05, L2 - 0.08);

    // neón y carta
    const neon = canvasTexture(1024, 256, (g, w, h) => {
      g.fillStyle = '#120a0a';
      g.fillRect(0, 0, w, h);
      g.font = "900 120px 'Arial Black', Impact, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#ff3d7f';
      g.shadowBlur = 30;
      g.fillStyle = '#ff7aa8';
      g.fillText('BAR VÍA LIBRE', w / 2, h / 2 + 6);
      g.strokeStyle = '#5ef2ff';
      g.shadowColor = '#5ef2ff';
      g.lineWidth = 8;
      g.strokeRect(20, 20, w - 40, h - 40);
    });
    add(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: neon, color: new THREE.Color(1.6, 1.6, 1.6) }), -0.6, 2.05, -L2 + 0.01, R, false);
    const menu = canvasTexture(512, 700, (g, w, h) => {
      g.fillStyle = '#1d2a22';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#a8742e';
      g.lineWidth = 18;
      g.strokeRect(9, 9, w - 18, h - 18);
      g.fillStyle = '#f4efe2';
      g.textAlign = 'center';
      g.font = "700 54px 'Georgia', serif";
      g.fillText('CARTA', w / 2, 90);
      g.font = "400 32px 'Georgia', serif";
      const rows = [['Hamburguesa', '$5'], ['  + cada extra', '$0,5'], ['Perrito', '$4'], ['Patatas', '$3'], ['Refresco', '$2']];
      rows.forEach(([n, p], i) => {
        g.textAlign = 'left';
        g.fillText(n, 46, 175 + i * 70);
        g.textAlign = 'right';
        g.fillText(p, w - 46, 175 + i * 70);
      });
      g.font = "italic 24px 'Georgia', serif";
      g.textAlign = 'center';
      g.fillText('Queso · lechuga · tomate · cebolla', w / 2, h - 110);
      g.fillText('Kétchup · mostaza · hielo · sal', w / 2, h - 70);
    });
    const menuMesh = add(new THREE.PlaneGeometry(0.62, 0.85), std(0xffffff, { map: menu, roughness: 0.9 }), 0.7, 1.65, L2 - 0.01, R, false);
    menuMesh.rotation.y = Math.PI;

    // estantería con botellas
    for (const y of [1.3, 1.62]) add(box(1.4, 0.03, 0.22), darkWood, 1.2, y, -L2 + 0.12);
    const bottleCols = [0x2e7d32, 0x8d3a1a, 0xc9a14a, 0x1e4f8a, 0x7a1f3a, 0xd9d2c0];
    for (let i = 0; i < 14; i++) {
      const y = i < 7 ? 1.315 : 1.635;
      const b = add(new THREE.CylinderGeometry(0.032, 0.035, 0.22, 12), phys(bottleCols[i % bottleCols.length], { roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.85 }), 0.65 + (i % 7) * 0.18, y + 0.11, -L2 + 0.12);
      add(new THREE.CylinderGeometry(0.01, 0.014, 0.07, 8), b.material, 0, 0.14, 0, b);
    }

    // ---- barra de los clientes ----
    const leather = phys(0x8a1c22, { roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xff8080) });
    add(box(0.62, 0.06, 5.6), wood, -0.48, BAR_Y - 0.03, 0);
    add(box(0.06, BAR_Y - 0.09, 5.6), leather, -0.77, (BAR_Y - 0.09) / 2, 0);
    for (const y of [0.15, BAR_Y - 0.16]) add(box(0.07, 0.03, 5.62), chrome, -0.78, y, 0);
    add(box(0.05, BAR_Y - 0.09, 5.6), darkWood, -0.2, (BAR_Y - 0.09) / 2, 0);
    const rail = add(new THREE.CylinderGeometry(0.022, 0.022, 5.5, 12), brass, -0.88, 0.2, 0);
    rail.rotation.x = Math.PI / 2;
    STOOLS.forEach((z, i) => {
      const g = new THREE.Group();
      g.position.set(STOOL_X, 0, z);
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 24), chrome, 0, 0.015, 0, g);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.68, 12), chrome, 0, 0.36, 0, g);
      const ring = add(new THREE.TorusGeometry(0.16, 0.012, 8, 28), chrome, 0, 0.32, 0, g);
      ring.rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.2, 0.19, 0.08, 28), leather, 0, 0.7, 0, g);
      R.add(g);
      // placa con el número de asiento
      const num = canvasTexture(64, 64, (c, w, h) => {
        c.fillStyle = '#c9a14a';
        c.beginPath();
        c.arc(32, 32, 30, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#2a1a0a';
        c.font = "900 40px 'Arial Black', sans-serif";
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(i + 1), 32, 35);
      });
      const plate = add(new THREE.CircleGeometry(0.03, 20), new THREE.MeshStandardMaterial({ map: num, metalness: 0.6, roughness: 0.3 }), -0.205, BAR_Y - 0.05, z, R, false);
      plate.rotation.y = Math.PI / 2;
    });
    // salseros y bote de propinas decorativos
    for (const [z, col] of [[-1.85, 0xd8262b], [-1.77, 0xf2c41a], [0.62, 0xd8262b], [0.7, 0xf2c41a], [1.9, 0xd8262b]]) {
      const b = add(new THREE.CylinderGeometry(0.022, 0.025, 0.15, 12), phys(col, { roughness: 0.3, clearcoat: 1 }), -0.66, BAR_Y + 0.075, z);
      add(new THREE.ConeGeometry(0.012, 0.04, 8), b.material, 0, 0.095, 0, b);
    }
    add(box(0.28, 0.2, 0.3), std(0x2a2a2a, { metalness: 0.5, roughness: 0.4 }), -0.5, BAR_Y + 0.1, 2.4);
    add(box(0.2, 0.05, 0.22), chrome, -0.5, BAR_Y + 0.22, 2.4);

    // sitios en la barra delante de cada taburete (comida servida, platos sucios y dinero)
    this.spots = STOOLS.map((z, i) => {
      const g = new THREE.Group();
      g.position.set(-0.5, BAR_Y, z);
      R.add(g);
      const hit = hitbox(0.5, 0.25, 0.75, -0.48, BAR_Y + 0.1, z, 'spot', 'Sitio ' + (i + 1), { idx: i });
      return { idx: i, z, group: g, hit, dirty: false, money: 0, tip: 0, models: [] };
    });

    // ---- mostrador de trabajo (acero) ----
    const steel = std(0xb9bec4, { metalness: 0.9, roughness: 0.32 });
    const darkSteel = std(0x3a3d42, { metalness: 0.7, roughness: 0.45 });
    add(box(0.56, 0.05, 3.3), steel, 0.08, 0.895, -0.4);
    add(box(0.54, 0.87, 3.28), darkSteel, 0.08, 0.435, -0.4);

    // bandejas de carne y salchichas
    const trayMat = std(0xe0e0e0, { metalness: 0.6, roughness: 0.3 });
    add(box(0.2, 0.03, 0.17), trayMat, 0.04, 0.935, 0.9);
    for (let i = 0; i < 4; i++) {
      const p = F.makePatty(0);
      p.position.set(0.015 + (i % 2) * 0.05, 0.96 + Math.floor(i / 2) * 0.02, 0.9 + (i % 2 ? 0.03 : -0.03));
      R.add(p);
    }
    hitbox(0.22, 0.12, 0.19, 0.04, 0.97, 0.9, 'patty', 'Carne cruda · a la plancha');
    add(box(0.2, 0.03, 0.17), trayMat, 0.04, 0.935, 1.1);
    for (let i = 0; i < 4; i++) {
      const s = F.makeSausage(0);
      s.position.set(0.04, 0.965, 1.04 + i * 0.04);
      s.rotation.set(0, Math.PI / 2, Math.PI / 2);
      R.add(s);
    }
    hitbox(0.22, 0.12, 0.19, 0.04, 0.97, 1.1, 'sausage', 'Salchichas · a la plancha');

    // plancha
    add(box(0.36, 0.04, 0.5), std(0x1c1c1e, { metalness: 0.6, roughness: 0.5 }), 0.06, 0.94, 0.45);
    for (let i = 0; i < 9; i++) add(box(0.34, 0.004, 0.006), std(0x2a2a2c, { metalness: 0.7, roughness: 0.4 }), 0.06, 0.962, 0.22 + i * 0.058);
    this.grillGlow = add(box(0.37, 0.01, 0.51), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.0 }), 0.06, 0.918, 0.45, R, false);
    this.slots = SLOTS.map((z, i) => {
      hitbox(0.34, 0.08, 0.15, 0.06, 0.98, z, 'slot', 'Plancha', { idx: i });
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd23f, depthTest: false }));
      dot.scale.set(0.035, 0.035, 1);
      dot.position.set(0.06, 1.06, z);
      dot.visible = false;
      dot.renderOrder = 8;
      R.add(dot);
      return { z, item: null, mesh: null, dot };
    });

    // freidora y salero
    const fryer = new THREE.Group();
    fryer.position.set(0.06, 0.92, 0.02);
    R.add(fryer);
    add(box(0.3, 0.12, 0.26), steel, 0, 0.06, 0, fryer);
    add(box(0.26, 0.01, 0.22), phys(0xb07a1e, { roughness: 0.1, clearcoat: 1 }), 0, 0.1, 0, fryer);
    this.basket = new THREE.Group();
    fryer.add(this.basket);
    add(box(0.2, 0.08, 0.16, 4, 2, 4), std(0xcfd3d8, { metalness: 0.9, roughness: 0.3, wireframe: true }), 0, 0.16, 0, this.basket);
    const handle = add(box(0.18, 0.015, 0.02), std(0x111111), 0.17, 0.2, 0, this.basket);
    handle.rotation.z = -0.4;
    this.friesInBasket = F.makeFries('ok', 0);
    this.friesInBasket.children[0].visible = false;
    this.friesInBasket.position.set(0, 0.07, 0);
    this.friesInBasket.scale.setScalar(1.3);
    this.friesInBasket.visible = false;
    this.basket.add(this.friesInBasket);
    this.fryLamp = add(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0x333333 }), 0.155, 0.08, 0.1, fryer, false);
    hitbox(0.34, 0.25, 0.28, 0.07, 1.02, 0.02, 'fryer', 'Freidora');
    const salt = new THREE.Group();
    salt.position.set(0.27, 0.92, 0.2);
    R.add(salt);
    add(new THREE.CylinderGeometry(0.022, 0.024, 0.07, 14), phys(0xf2f2f2, { transparent: true, opacity: 0.9, roughness: 0.1, clearcoat: 1 }), 0, 0.035, 0, salt);
    add(new THREE.CylinderGeometry(0.023, 0.023, 0.02, 14), chrome, 0, 0.08, 0, salt);
    hitbox(0.08, 0.14, 0.08, 0.27, 0.98, 0.2, 'salt', 'Salero (para las patatas)');

    // tabla de montaje
    add(box(0.26, 0.025, 0.3), phys(0xc8995a, { roughness: 0.7 }), 0.07, 0.93, -0.4);
    this.boardGroup = new THREE.Group();
    this.boardGroup.position.set(0.07, 0.943, -0.4);
    R.add(this.boardGroup);
    hitbox(0.28, 0.16, 0.32, 0.07, 1.0, -0.4, 'board', 'Tabla de montaje');
    this.board = null;

    // cestas de panes (cerca del camarero)
    const basketMat = phys(0x8a5a2b, { roughness: 0.8 });
    for (const [z, kind] of [[-0.27, 'bunB'], [-0.53, 'bunH']]) {
      add(box(0.13, 0.05, 0.16), basketMat, 0.27, 0.945, z);
      for (let i = 0; i < 3; i++) {
        if (kind === 'bunB') {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0xc98a3c, { roughness: 0.55 }));
          b.scale.y = 0.7;
          b.position.set(0.27, 0.97, z - 0.045 + i * 0.045);
          R.add(b);
        } else {
          const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.08, 4, 8), std(0xc98a3c, { roughness: 0.55 }));
          b.rotation.z = Math.PI / 2;
          b.position.set(0.27, 0.985, z - 0.045 + i * 0.045);
          R.add(b);
        }
      }
      hitbox(0.15, 0.12, 0.18, 0.27, 0.98, z, kind, kind === 'bunB' ? 'Pan de hamburguesa' : 'Pan de perrito');
    }

    // cuencos de ingredientes y botes de salsa (fila del fondo)
    const bowlMat = std(0xe8e8e8, { metalness: 0.7, roughness: 0.25 });
    const TOP_Z = { cheese: -0.16, lettuce: -0.27, tomato: -0.38, onion: -0.49 };
    for (const k of F.TOPPINGS) {
      const z = TOP_Z[k];
      add(new THREE.CylinderGeometry(0.05, 0.042, 0.05, 18, 1, true), bowlMat, -0.12, 0.945, z).material.side = THREE.DoubleSide;
      const fillM = add(new THREE.CylinderGeometry(0.046, 0.046, 0.01, 18), F.TOPPING_MATS[k](), -0.12, 0.96, z);
      void fillM;
      for (let i = 0; i < 4; i++) {
        const piece = k === 'cheese' ? new THREE.BoxGeometry(0.03, 0.004, 0.03)
          : k === 'onion' ? new THREE.TorusGeometry(0.012, 0.003, 4, 10)
            : new THREE.CylinderGeometry(0.014, 0.014, 0.006, 10);
        const pm = add(piece, F.TOPPING_MATS[k](), -0.12 + Math.cos(i * 1.6) * 0.02, 0.968 + i * 0.002, z + Math.sin(i * 1.6) * 0.02, R, false);
        if (k === 'onion') pm.rotation.x = Math.PI / 2;
        pm.rotation.y = i;
      }
      hitbox(0.11, 0.12, 0.1, -0.12, 0.97, z, k, 'Añadir ' + F.MOD_NAMES[k]);
    }
    for (const [k, z] of [['ketchup', -0.61], ['mustard', -0.71]]) {
      const b = add(new THREE.CylinderGeometry(0.026, 0.028, 0.15, 14), phys(F.TOPPING_MATS[k]().color.getHex(), { roughness: 0.3, clearcoat: 1 }), -0.12, 0.995, z);
      add(new THREE.ConeGeometry(0.012, 0.045, 10), b.material, 0, 0.097, 0, b);
      hitbox(0.08, 0.2, 0.08, -0.12, 1.0, z, k, 'Añadir ' + F.MOD_NAMES[k]);
    }

    // vasos y cubitera
    for (let i = 0; i < 5; i++) {
      const c = F.makeCup(null);
      c.position.set(0.05, 0.92 + i * 0.025, -0.9);
      R.add(c);
    }
    hitbox(0.1, 0.25, 0.1, 0.05, 1.02, -0.9, 'cups', 'Vasos');
    add(new THREE.CylinderGeometry(0.07, 0.06, 0.09, 20, 1, true), chrome, 0.05, 0.965, -1.08).material.side = THREE.DoubleSide;
    const iceMat = phys(0xdff4ff, { roughness: 0.05, transparent: true, opacity: 0.85, clearcoat: 1 });
    for (let i = 0; i < 9; i++) {
      const c = add(new THREE.BoxGeometry(0.022, 0.022, 0.022), iceMat, 0.05 + Math.cos(i * 2.3) * 0.035, 0.99 + (i % 3) * 0.006, -1.08 + Math.sin(i * 2.3) * 0.035, R, false);
      c.rotation.set(i, i * 0.7, 0);
    }
    hitbox(0.15, 0.14, 0.15, 0.05, 0.98, -1.08, 'ice', 'Cubitera · hielo');

    // máquina de refrescos (los grifos miran al camarero)
    add(box(0.2, 0.44, 0.48), std(0xc8202a, { roughness: 0.35, metalness: 0.2 }), 0.0, 1.14, -1.43);
    add(box(0.16, 0.02, 0.46), darkSteel, 0.2, 0.93, -1.43);
    add(box(0.21, 0.06, 0.49), std(0xf2f2f2, { roughness: 0.4 }), 0.0, 1.38, -1.43);
    this.streams = TAPS.map((t) => {
      const name = 'Grifo de ' + F.FLAVORS[t.flavor].name.toLowerCase();
      add(box(0.005, 0.09, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(F.FLAVORS[t.flavor].color).multiplyScalar(t.flavor === 'cola' ? 3 : 1.4) }), 0.102, 1.26, t.z, R, false);
      const tap = add(new THREE.CylinderGeometry(0.016, 0.016, 0.09, 10), chrome, 0.14, 1.12, t.z);
      tap.rotation.z = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 8), chrome, 0.18, 1.09, t.z);
      hitbox(0.2, 0.32, 0.14, 0.15, 1.12, t.z, 'tap', name, { flavor: t.flavor });
      const stream = add(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 8), new THREE.MeshBasicMaterial({ color: F.FLAVORS[t.flavor].color }), 0.18, 1.0, t.z, R, false);
      stream.visible = false;
      return stream;
    });

    // papelera
    add(new THREE.CylinderGeometry(0.14, 0.12, 0.86, 20), std(0x5a6068, { metalness: 0.6, roughness: 0.4 }), 0.25, 0.43, -1.8);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 20), std(0x30343a, { metalness: 0.6, roughness: 0.3 }), 0.25, 0.875, -1.8);
    hitbox(0.34, 0.95, 0.34, 0.25, 0.45, -1.8, 'trash', 'Papelera');
    tag('Basura', 0.25, 1.02, -1.8);

    // etiquetas de los puestos
    tag('Salchichas', 0.04, 1.07, 1.1);
    tag('Carne', 0.04, 1.07, 0.9);
    tag('Plancha', -0.14, 1.04, 0.45);
    tag('Freidora', 0.06, 1.2, 0.02);
    tag('Sal', 0.27, 1.07, 0.2);
    tag('Tabla', 0.07, 1.06, -0.4);
    tag('Pan burger', 0.3, 1.06, -0.27);
    tag('Pan perrito', 0.3, 1.11, -0.53);
    tag('Queso', -0.12, 1.06, -0.16);
    tag('Lechuga', -0.12, 1.12, -0.27);
    tag('Tomate', -0.12, 1.06, -0.38);
    tag('Cebolla', -0.12, 1.12, -0.49);
    tag('Kétchup', -0.12, 1.14, -0.61);
    tag('Mostaza', -0.12, 1.2, -0.71);
    tag('Vasos', 0.05, 1.12, -0.9);
    tag('Hielo', 0.05, 1.06, -1.08);
    tag('Cola', 0.16, 1.32, -1.28);
    tag('Naranja', 0.16, 1.4, -1.43);
    tag('Limón', 0.16, 1.32, -1.58);

    // resaltado: lo que tienes bajo el cursor (azul) y dónde puedes usar lo que llevas (verde)
    const hlGeo = new THREE.BoxGeometry(1, 1, 1);
    this.hoverBox = new THREE.Mesh(hlGeo, new THREE.MeshBasicMaterial({ color: 0x5ef2ff, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
    this.hoverBox.visible = false;
    this.hoverBox.renderOrder = 6;
    R.add(this.hoverBox);
    this.validBoxes = [];
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(hlGeo, new THREE.MeshBasicMaterial({ color: 0x3dff8a, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
      b.visible = false;
      b.renderOrder = 6;
      R.add(b);
      this.validBoxes.push(b);
    }

    // lámparas colgantes y luces
    for (const z of [-1.4, 0.2, 1.8]) {
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.45, 6), std(0x111111), -0.45, H - 0.22, z, R, false);
      add(new THREE.ConeGeometry(0.17, 0.16, 24, 1, true), phys(0x1f5c3a, { roughness: 0.35, side: THREE.DoubleSide, clearcoat: 0.6 }), -0.45, H - 0.5, z, R, false);
      add(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.0, 1.3) }), -0.45, H - 0.56, z, R, false);
    }
    const l1 = new THREE.PointLight(0xffc98a, 3.2, 7, 1.4);
    l1.position.set(-0.2, H - 0.25, 0);
    const l2 = new THREE.PointLight(0xfff0dd, 1.5, 3.8, 1.4);
    l2.position.set(0.3, H - 0.2, -0.4);
    R.add(l1, l2);

    this.steam = new Particles(R, 220, { soft: true, drag: 1.5, gravity: 0.6 });
    this.steamCol = new THREE.Color(0.85, 0.85, 0.88);
    this.burnCol = new THREE.Color(0.2, 0.18, 0.18);
  }

  // ---------- Ciclo de vida ----------

  attach(train) {
    this.restoreTrain = enterCar(train, 2, this.root);
  }

  detach() {
    if (this.restoreTrain) this.restoreTrain();
    this.restoreTrain = null;
  }

  start(train) {
    this.attach(train);
    this.active = true;
    this.money = 0;
    this.time = SHIFT;
    this.stars = 3;
    this.served = 0;
    this.angry = 0;
    this.perfect = 0;
    this.mistakes = 0;
    this.spawnT = 2;
    this.elapsed = 0;
    this.ordersMade = 0;
    for (const c of this.customers) this.removeCustomer(c);
    this.customers = [];
    this.stoolUsed = [false, false, false];
    for (const s of this.slots) this.clearSlot(s);
    for (const sp of this.spots) this.clearSpot(sp);
    this.fryer = { state: 'idle', t: 0 };
    this.basket.position.y = 0.04;
    this.friesInBasket.visible = false;
    this.setBoard(null);
    this.setHand(null);
    this.filling = null;
    this.yawDrag = 0;
    this.tut = {};
    this.handRig.visible = true;
    this.camera.near = 0.06;
    this.camera.updateProjectionMatrix();
    this.ui.hud.hidden = false;
    this.hint('Tu primer cliente está a punto de llegar', 3);
    this.ticketsDirty = true;
    this.renderHud();
  }

  stop() {
    this.active = false;
    for (const c of this.customers) this.removeCustomer(c);
    this.customers = [];
    for (const s of this.slots) this.clearSlot(s);
    for (const sp of this.spots) this.clearSpot(sp);
    this.setBoard(null);
    this.setHand(null);
    this.handRig.visible = false;
    this.detach();
    this.camera.near = 0.3;
    this.camera.updateProjectionMatrix();
    this.ui.hud.hidden = true;
    this.ui.tip.hidden = true;
    this.sfx.sizzle(0);
  }

  results() {
    return { money: this.money, served: this.served, angry: this.angry, perfect: this.perfect, mistakes: this.mistakes };
  }

  /** Al terminar, se cobra lo que quedara en la barra. */
  collectAll() {
    for (const sp of this.spots) if (sp.dirty) this.money += sp.money;
  }

  // ---------- Cámara e interacción ----------

  applyCamera(camera, dt) {
    this.yawDrag += this.keysYaw * dt * 1.4;
    this.yawDrag = THREE.MathUtils.clamp(this.yawDrag, -1.1, 1.1);
    this.yaw += (THREE.MathUtils.clamp(this.yawDrag + this.lookFollow, -1.25, 1.25) - this.yaw) * Math.min(1, dt * 8);
    const pitch = THREE.MathUtils.clamp(this.pitch + this.pitchFollow, -0.75, 0.35);
    this.root.updateWorldMatrix(true, false);
    camera.position.copy(CAM).applyMatrix4(this.root.matrixWorld);
    this.root.getWorldQuaternion(_q);
    _q2.setFromEuler(_e.set(pitch, Math.PI / 2 + this.yaw, 0, 'YXZ'));
    camera.quaternion.copy(_q).multiply(_q2);

    // la mano se estira hacia lo que tocas
    const t = performance.now() / 1000;
    const rig = this.handRig;
    rig.position.copy(HAND_BASE);
    rig.position.y += Math.sin(t * 2) * 0.004;
    rig.rotation.set(0.15, -0.25, 0.1);
    if (this.reach) {
      this.reach.t += dt;
      const k = Math.sin(Math.min(1, this.reach.t / 0.26) * Math.PI);
      rig.position.lerp(this.reach.target, k * 0.55);
      rig.rotation.x += k * 0.35;
      if (this.reach.t >= 0.26) this.reach = null;
    }
  }

  // la cámara ya no sigue al ratón: lo que vas a pulsar se queda quieto
  pointerLook() {}

  drag(dx, dy) {
    this.yawDrag += dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.003, -0.75, 0.25);
  }

  pick(nx, ny) {
    _ndc.set(nx * 2 - 1, -(ny * 2 - 1));
    this.raycaster.setFromCamera(_ndc, this.camera);
    const targets = this.clickables.concat(this.customers.map((c) => c.model.root));
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.action && !o.userData.customer) o = o.parent;
      if (o) return { o, point: h.point };
    }
    return null;
  }

  hover(nx, ny, px, py) {
    const hit = this.pick(nx, ny);
    const tip = this.ui.tip;
    this.hoverBox.visible = false;
    if (!hit) {
      tip.hidden = true;
      return;
    }
    const o = hit.o;
    if (o.userData.action && o.geometry && o.geometry.parameters && o.geometry.parameters.width) {
      const p = o.geometry.parameters;
      this.hoverBox.position.copy(o.position);
      this.hoverBox.scale.set(p.width, p.height, p.depth);
      this.hoverBox.visible = true;
    }
    let label = o.userData.label;
    if (o.userData.customer) {
      const c = o.userData.customer;
      label = c.state === 'waiting' ? (this.hand ? 'Servir a ' + c.name : c.name + ' · ' + c.order.filter((x) => !x.done).map(F.orderLabel).join(' + ')) : c.name;
    } else if (o.userData.action === 'slot') {
      const s = this.slots[o.userData.idx];
      label = s.item ? F.itemLabel(s.item) : 'Plancha (hueco libre)';
    } else if (o.userData.action === 'fryer') {
      label = this.fryer.state === 'idle' ? 'Freidora · pulsa para freír' : 'Patatas ' + ({ raw: 'friéndose', ok: 'listas', burnt: 'quemadas' })[F.quality('fries', this.fryer.t)];
    } else if (o.userData.action === 'board') {
      label = this.board ? 'Tabla: ' + this.boardLabel() : 'Tabla de montaje (vacía)';
    } else if (o.userData.action === 'spot') {
      const sp = this.spots[o.userData.idx];
      label = sp.dirty ? 'Recoger plato y $' + sp.money : 'Asiento ' + (sp.idx + 1);
    }
    tip.textContent = label;
    tip.style.left = Math.min(px + 14, innerWidth - 240) + 'px';
    tip.style.top = py + 14 + 'px';
    tip.hidden = false;
  }

  click(nx, ny) {
    const hit = this.pick(nx, ny);
    if (!hit) return;
    // la mano se estira hacia el punto tocado
    const local = this.camera.worldToLocal(hit.point.clone());
    this.reach = { t: 0, target: local };
    const o = hit.o;
    if (o.userData.customer) this.serve(o.userData.customer);
    else this.act(o.userData.action, o.userData);
    this.renderHud();
  }

  /** Botón Soltar: tira lo que llevas o, con las manos libres, vacía la tabla. */
  drop() {
    if (!this.active) return;
    if (this.filling) return this.hint('Espera a que se llene el vaso');
    if (this.hand) {
      this.hint(F.itemLabel(this.hand) + ' a la basura');
      this.setHand(null);
      this.sfx.trash();
    } else if (this.board) {
      this.setBoard(null);
      this.hint('Has vaciado la tabla');
      this.sfx.trash();
    } else {
      this.hint('No tienes nada que soltar');
    }
    this.renderHud();
  }

  act(action, data) {
    const hand = this.hand;
    if (this.filling) return this.hint('Espera a que se llene el vaso');
    const busy = () => this.hint('Tienes las manos ocupadas · usa Soltar si te has equivocado');
    switch (action) {
      case 'patty':
      case 'sausage': {
        if (hand) return busy();
        const s = this.slots.find((sl) => !sl.item);
        if (!s) return this.hint('La plancha está llena');
        this.putOnGrill(s, { kind: action, t: 0 });
        this.sfx.plop();
        return;
      }
      case 'slot': {
        const s = this.slots[data.idx];
        if (s.item && !hand) {
          this.setHand({ kind: s.item.kind, t: s.item.t });
          this.clearSlot(s);
          return;
        }
        if (!s.item && hand && (hand.kind === 'patty' || hand.kind === 'sausage')) {
          this.putOnGrill(s, { kind: hand.kind, t: hand.t });
          this.setHand(null);
          return;
        }
        if (!s.item) return this.hint('Coge carne o salchichas de las bandejas');
        return busy();
      }
      case 'fryer': {
        const fr = this.fryer;
        if (fr.state === 'idle') {
          if (hand) return busy();
          fr.state = 'frying';
          fr.t = 0;
          this.friesInBasket.visible = true;
          this.sfx.plop();
          return;
        }
        if (hand) return busy();
        const q = F.quality('fries', fr.t);
        if (q === 'raw') return this.hint('Las patatas aún se están friendo');
        this.setHand({ kind: 'fries', q, t: fr.t, salt: false });
        fr.state = 'idle';
        this.friesInBasket.visible = false;
        return;
      }
      case 'salt':
        if (!hand || hand.kind !== 'fries') return this.hint('El salero es para las patatas');
        if (hand.salt) return this.hint('Ya tienen sal');
        this.setHand(Object.assign({}, hand, { salt: true }));
        this.sfx.shake();
        return;
      case 'bunB':
      case 'bunH': {
        if (this.board) return this.hint('La tabla ya está ocupada · usa Soltar para vaciarla');
        if (hand && hand.kind !== 'patty' && hand.kind !== 'sausage') return busy();
        this.setBoard(action === 'bunB' ? { type: 'burger', meat: null, mods: [] } : { type: 'hotdog', meat: null, mods: [] });
        this.sfx.plop();
        if (!this.tut.bun) {
          this.tut.bun = true;
          this.hint(action === 'bunB' ? 'Pon la carne hecha y los ingredientes que pida' : 'Pon la salchicha y las salsas que pida', 3);
        }
        return;
      }
      case 'board': {
        const b = this.board;
        if (!b) {
          if (hand && (hand.kind === 'patty' || hand.kind === 'sausage')) return this.hint('Primero coge un pan de la cesta');
          return this.hint('Coge un pan de la cesta para empezar');
        }
        if (hand) {
          if (hand.kind === 'patty' && b.type === 'burger' && !b.meat) {
            b.meat = { t: hand.t };
            this.setHand(null);
            return this.setBoard(b);
          }
          if (hand.kind === 'sausage' && b.type === 'hotdog' && !b.meat) {
            b.meat = { t: hand.t };
            this.setHand(null);
            return this.setBoard(b);
          }
          if (hand.kind === 'patty' || hand.kind === 'sausage') return this.hint(b.meat ? 'Ya tiene ' + (b.type === 'burger' ? 'carne' : 'salchicha') : 'Ese pan no es para eso');
          return busy();
        }
        // con las manos libres: recoger lo montado
        if (!b.meat) return this.hint(b.type === 'burger' ? 'Falta la carne' : 'Falta la salchicha');
        if (b.type === 'burger') this.setHand({ kind: 'burger', q: F.quality('patty', b.meat.t), tops: [...b.mods] });
        else this.setHand({ kind: 'hotdog', q: F.quality('sausage', b.meat.t), sauces: [...b.mods] });
        this.setBoard(null);
        return;
      }
      case 'cheese':
      case 'lettuce':
      case 'tomato':
      case 'onion':
      case 'ketchup':
      case 'mustard': {
        const b = this.board;
        if (!b) return this.hint('Primero pon un pan en la tabla');
        const isSauce = action === 'ketchup' || action === 'mustard';
        if (b.type === 'burger' && isSauce) return this.hint('Las salsas son para los perritos');
        if (b.type === 'hotdog' && !isSauce) return this.hint('Al perrito solo se le echan salsas');
        if (b.mods.includes(action)) return this.hint('Ya lleva ' + F.MOD_NAMES[action]);
        b.mods.push(action);
        this.setBoard(b);
        if (isSauce) this.sfx.squirt();
        else this.sfx.plop();
        return;
      }
      case 'cups':
        if (hand) return busy();
        return this.setHand({ kind: 'cup', fill: null, ice: false });
      case 'ice':
        if (!hand || hand.kind !== 'cup') return this.hint('Coge primero un vaso');
        if (hand.fill) return this.hint('El hielo se pone antes del refresco');
        if (hand.ice) return this.hint('Ya tiene hielo');
        this.setHand(Object.assign({}, hand, { ice: true }));
        this.sfx.ice();
        return;
      case 'tap': {
        if (!hand || hand.kind !== 'cup') return this.hint('Coge primero un vaso');
        if (hand.fill) return this.hint('El vaso ya está lleno');
        const tap = TAPS.findIndex((t) => t.flavor === data.flavor);
        this.filling = { flavor: data.flavor, t: 0, tap };
        this.streams[tap].visible = true;
        this.sfx.pour();
        return;
      }
      case 'trash':
        if (this.hand) return this.drop();
        return this.hint('No llevas nada que tirar');
      case 'spot': {
        const sp = this.spots[data.idx];
        if (sp.dirty) {
          if (hand) return this.hint('Necesitas las manos libres para recoger · usa Soltar');
          this.money += sp.money;
          this.pop('+$' + sp.money + (sp.tip ? ' · propina $' + sp.tip : ''));
          this.clearSpot(sp);
          this.sfx.register();
          return;
        }
        const c = this.customers.find((cu) => cu.stool === data.idx && cu.state === 'waiting');
        if (c) return this.serve(c);
        return this.hint(hand ? 'No hay nadie esperando en ese asiento' : 'Asiento ' + (sp.idx + 1));
      }
      default:
    }
  }

  putOnGrill(s, item) {
    s.item = item;
    const m = item.kind === 'patty' ? F.makePatty(item.t) : F.makeSausage(item.t);
    m.position.set(0.06, 0.972, s.z);
    if (item.kind === 'sausage') m.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.root.add(m);
    s.mesh = m;
    s.dot.visible = true;
    s.warned = false;
  }

  clearSlot(s) {
    if (s.mesh) this.root.remove(s.mesh);
    s.item = null;
    s.mesh = null;
    s.dot.visible = false;
  }

  setBoard(b) {
    this.board = b;
    const g = this.boardGroup;
    while (g.children.length) g.remove(g.children[0]);
    if (b) {
      const m = b.type === 'burger'
        ? F.makeBurger({ tops: b.mods, patty: !!b.meat, pattyT: b.meat && b.meat.t, closed: false, plate: false })
        : F.makeHotdog({ sauces: b.mods, sausage: !!b.meat, sausageT: b.meat && b.meat.t, tray: false });
      m.rotation.y = Math.PI / 2;
      g.add(m);
    }
    this.renderHud();
  }

  boardLabel() {
    const b = this.board;
    if (!b) return '';
    const meat = b.meat ? (b.type === 'burger' ? 'carne' : 'salchicha') : 'sin ' + (b.type === 'burger' ? 'carne' : 'salchicha');
    return (b.type === 'burger' ? 'hamburguesa' : 'perrito') + ' (' + [meat, ...b.mods.map((k) => F.MOD_NAMES[k])].join(', ') + ')';
  }

  setHand(item) {
    this.hand = item;
    const g = this.handItem;
    while (g.children.length) g.remove(g.children[0]);
    this.handModel = null;
    if (item) {
      const m = F.makeHeld(item);
      m.rotation.y = -0.4;
      g.add(m);
      this.handModel = m;
    }
    if (item && F.asOrder(item) && !this.tut.serve) {
      this.tut.serve = true;
      this.hint('Pulsa sobre el cliente (o su sitio en la barra) para servirle', 3.5);
    }
    this.renderHud();
  }

  serve(c) {
    if (c.state !== 'waiting') return this.hint(c.state === 'think' ? c.name + ' está decidiendo qué pedir' : c.name + ' ya está servido');
    if (!this.hand) return this.hint('Prepara su pedido y pulsa sobre ' + c.name + ' para servirle');
    const got = F.asOrder(this.hand);
    if (!got) {
      if (this.hand.kind === 'cup') return this.hint(this.hand.ice ? 'Falta el refresco' : 'El vaso está vacío');
      return this.hint('Primero móntalo en un pan');
    }
    const pending = c.order.filter((it) => !it.done);
    const exact = pending.find((it) => F.matches(it, got));
    const sameKind = pending.find((it) => it.key === got.key);
    if (!exact && !sameKind) {
      c.say('¡Eso no lo he pedido!');
      c.model.setMood('impatient');
      c.moodT = 1.2;
      this.sfx.voice(c.voice, 3);
      return;
    }
    const q = got.q || 'ok';
    this.setHand(null);
    if (q !== 'ok') {
      this.mistakes++;
      c.patience -= c.maxPatience * 0.25;
      c.model.setMood('disgust');
      c.moodT = 1.8;
      c.say(q === 'raw' ? '¡Esto está crudo!' : '¡Esto está quemado!');
      this.sfx.angry(0.6);
      return;
    }
    if (!exact) {
      this.mistakes++;
      c.patience -= c.maxPatience * 0.2;
      c.model.setMood('disgust');
      c.moodT = 1.8;
      c.say(F.complaint(sameKind, got));
      this.sfx.voice(c.voice, 4);
      c.dirty = true;
      return;
    }
    exact.done = true;
    this.perfect++;
    c.dirty = true;
    this.ticketsDirty = true;
    this.placeServed(c, exact);
    this.sfx.serveItem();
    if (c.order.every((it) => it.done)) {
      const total = c.order.reduce((s, it) => s + F.price(it), 0);
      const frac = Math.max(0, c.patience / c.maxPatience);
      c.bill = Math.round(total);
      c.tip = Math.round(total * 0.7 * frac);
      this.served++;
      c.state = 'eating';
      c.t = 0;
      c.model.setMood('happy');
      c.model.eating = true;
      c.say(c.tip >= total * 0.4 ? '¡Rapidísimo, gracias!' : '¡Gracias!');
      this.sfx.voice(c.voice, 4);
    } else {
      c.model.setMood('neutral');
      c.say('¡Bien! ¿Y lo demás?');
      this.sfx.voice(c.voice, 2);
    }
  }

  placeServed(c, o) {
    const sp = this.spots[c.stool];
    const m = F.makeServed(o);
    const n = sp.models.length;
    m.position.set((n % 2) * 0.12 - 0.04, 0, -0.16 + n * 0.16);
    m.rotation.y = Math.PI / 2;
    sp.group.add(m);
    sp.models.push(m);
  }

  clearSpot(sp) {
    while (sp.group.children.length) sp.group.remove(sp.group.children[0]);
    sp.models = [];
    sp.dirty = false;
    sp.money = 0;
    sp.tip = 0;
  }

  /** El cliente se va: deja platos sucios y el dinero (cuenta + propina) en la barra. */
  leaveMess(c) {
    const sp = this.spots[c.stool];
    for (const m of sp.models) {
      m.scale.multiplyScalar(0.9);
      m.traverse((o) => {
        if (o.isMesh && o.material && o.material.color) {
          o.material = o.material.clone();
          o.material.color.multiplyScalar(0.55);
        }
      });
    }
    // billete y monedas
    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.002, 0.06), new THREE.MeshStandardMaterial({ color: 0x6f9a5a, roughness: 0.8 }));
    bill.position.set(0.12, 0.002, 0.1);
    bill.rotation.y = 0.3;
    sp.group.add(bill);
    const coinMat = this.mats.brass;
    for (let i = 0; i < Math.min(6, 1 + c.tip); i++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.003, 14), coinMat);
      coin.position.set(0.1 + (i % 3) * 0.026, 0.004 + Math.floor(i / 3) * 0.003, 0.17);
      sp.group.add(coin);
    }
    sp.dirty = true;
    sp.money = (c.bill || 0) + (c.tip || 0);
    sp.tip = c.tip || 0;
    if (!this.tut.mess) {
      this.tut.mess = true;
      this.hint('Pulsa en su sitio de la barra para cobrar y recoger el plato', 4);
    }
  }

  // ---------- Clientes ----------

  spawnCustomer() {
    const free = this.stoolUsed.map((u, i) => (u || this.spots[i].dirty ? -1 : i)).filter((i) => i >= 0);
    if (!free.length) return false;
    const stool = free[Math.floor(Math.random() * free.length)];
    this.stoolUsed[stool] = true;
    const model = new Customer();
    model.root.position.set(AISLE_X, 0, DOOR_Z);
    model.root.rotation.y = Math.PI;
    model.walk = 1;
    model.walkPhase = 0;
    this.root.add(model.root);
    const NAMES = ['Ana', 'Luis', 'Marta', 'Jorge', 'Lucía', 'Pablo', 'Sara', 'Diego', 'Elena', 'Hugo', 'Nora', 'Iván', 'Carla', 'Raúl', 'Inés', 'Tomás'];
    const c = {
      model, stool, z: STOOLS[stool], state: 'enter', t: 0, order: [], patience: 1, maxPatience: 1, moodT: 0,
      bubble: this.makeBubble(), dirty: true, speech: null, speechT: 0,
      name: NAMES[Math.floor(Math.random() * NAMES.length)], voice: 0.75 + Math.random() * 0.7,
    };
    model.root.traverse((m) => (m.userData.customer = c));
    c.say = (text) => {
      c.speech = text;
      c.speechT = 2.4;
      c.dirty = true;
    };
    this.root.add(c.bubble);
    this.customers.push(c);
    this.sfx.bell();
    return true;
  }

  removeCustomer(c) {
    this.root.remove(c.model.root);
    this.root.remove(c.bubble);
    c.bubble.material.map.dispose();
    c.bubble.material.dispose();
  }

  makeOrder() {
    // los primeros clientes piden cosas sencillas para aprender
    this.ordersMade = (this.ordersMade || 0) + 1;
    const fl = Object.keys(F.FLAVORS);
    if (this.ordersMade === 1) return [{ key: 'drink', flavor: fl[Math.floor(Math.random() * 3)], ice: false, done: false }];
    if (this.ordersMade === 2) return [{ key: 'fries', salt: true, done: false }];
    if (this.ordersMade === 3) return [{ key: 'burger', tops: ['cheese'], done: false }];
    const progress = Math.min(1, this.elapsed / SHIFT);
    const n = Math.random() < 0.5 - progress * 0.25 ? 1 : Math.random() < 0.75 ? 2 : 3;
    const order = [];
    const kinds = ['burger', 'burger', 'hotdog', 'fries', 'drink', 'drink'];
    for (let i = 0; i < n; i++) {
      let k = kinds[Math.floor(Math.random() * kinds.length)];
      if (k === 'drink' && order.some((o) => o.key === 'drink')) k = 'fries';
      if (k === 'fries' && order.some((o) => o.key === 'fries')) k = 'burger';
      const extraP = 0.35 + progress * 0.3;
      if (k === 'burger') order.push({ key: 'burger', tops: F.TOPPINGS.filter(() => Math.random() < extraP).sort(), done: false });
      else if (k === 'hotdog') order.push({ key: 'hotdog', sauces: F.SAUCES.filter(() => Math.random() < 0.55).sort(), done: false });
      else if (k === 'fries') order.push({ key: 'fries', salt: Math.random() < 0.6, done: false });
      else order.push({ key: 'drink', flavor: Object.keys(F.FLAVORS)[Math.floor(Math.random() * 3)], ice: Math.random() < 0.55, done: false });
    }
    return order;
  }

  makeBubble() {
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 240;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false, fog: false }));
    s.scale.set(0.78, 0.446, 1);
    s.renderOrder = 9;
    s.visible = false;
    s.userData.canvas = canvas;
    return s;
  }

  drawBubble(c) {
    const cv = c.bubble.userData.canvas;
    const g = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(8, 8, w - 16, h - 48, 26);
    g.moveTo(w / 2 - 18, h - 41);
    g.lineTo(w / 2, h - 12);
    g.lineTo(w / 2 + 18, h - 41);
    g.fill();
    g.stroke();
    g.fillStyle = '#7a6a5a';
    g.font = "700 20px 'Inter', Arial, sans-serif";
    g.textAlign = 'left';
    g.fillText((c.stool + 1) + ' · ' + c.name, 26, 36);
    if (c.speech) {
      g.fillStyle = '#1b1b1b';
      g.font = "700 30px 'Inter', Arial, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(c.speech, w / 2, (h - 40) / 2 + 12, w - 40);
      g.textBaseline = 'alphabetic';
    } else if (c.state === 'think') {
      g.fillStyle = '#555';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(w / 2 - 30 + i * 30, (h - 40) / 2 + 10, 9 + (Math.floor(performance.now() / 250) % 3 === i ? 4 : 0), 0, Math.PI * 2);
        g.fill();
      }
    } else {
      const n = c.order.length;
      const step = 128;
      const startX = w / 2 - ((n - 1) * step) / 2;
      c.order.forEach((o, i) => {
        const x = startX + i * step, y = 88;
        g.globalAlpha = o.done ? 0.3 : 1;
        F.drawIcon(g, o, x, y, 74);
        const mods = F.modsOf(o);
        const mw = 27;
        mods.forEach((m, j) => F.drawMod(g, m, x - ((mods.length - 1) * mw) / 2 + j * mw, 146, 24));
        g.globalAlpha = 1;
        if (o.done) {
          g.strokeStyle = '#1fa64a';
          g.lineWidth = 10;
          g.beginPath();
          g.moveTo(x - 20, y);
          g.lineTo(x - 4, y + 18);
          g.lineTo(x + 26, y - 20);
          g.stroke();
        }
      });
      const f = Math.max(0, c.patience / c.maxPatience);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.beginPath();
      g.roundRect(34, h - 64, w - 68, 10, 5);
      g.fill();
      g.fillStyle = `hsl(${Math.round(f * 120)}, 75%, 45%)`;
      g.beginPath();
      g.roundRect(34, h - 64, (w - 68) * f, 10, 5);
      g.fill();
    }
    c.bubble.material.map.needsUpdate = true;
  }

  updateCustomers(dt, t) {
    const camWorld = this.camera.getWorldPosition(_v);
    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i];
      const m = c.model;
      c.t += dt;
      const p = m.root.position;
      if (c.state === 'enter') {
        if (p.z > c.z + 0.02) {
          p.z = Math.max(c.z, p.z - dt * 1.25);
          m.walkPhase += dt * 8;
        } else {
          c.state = 'sit';
          c.t = 0;
          m.walk = 0;
        }
      } else if (c.state === 'sit') {
        const k = Math.min(1, c.t / 0.8);
        m.root.rotation.y = Math.PI - (Math.PI / 2) * Math.min(1, k * 1.6);
        p.x = AISLE_X + (STOOL_X - AISLE_X) * k;
        m.seated = THREE.MathUtils.smoothstep(k, 0.3, 1);
        if (k >= 1) {
          c.state = 'think';
          c.t = 0;
          c.dirty = true;
        }
      } else if (c.state === 'think') {
        if (c.t > 1.6) {
          c.order = this.makeOrder();
          const progress = Math.min(1, this.elapsed / SHIFT);
          const work = c.order.reduce((s, o) => s + (o.key === 'burger' ? 16 + o.tops.length * 2 : o.key === 'hotdog' ? 13 : o.key === 'fries' ? 11 : 6), 0);
          c.maxPatience = (40 + work * 1.9) * (1 - progress * 0.2);
          c.patience = c.maxPatience;
          c.state = 'waiting';
          c.dirty = true;
          this.ticketsDirty = true;
          this.sfx.voice(c.voice, 3 + c.order.length);
          if (!this.tut.order) {
            this.tut.order = true;
            this.hint('Mira su pedido en el bocadillo o en las comandas y prepáralo', 4);
          }
        }
      } else if (c.state === 'waiting') {
        c.patience -= dt;
        const f = c.patience / c.maxPatience;
        if (c.moodT <= 0) m.setMood(f < 0.3 ? 'impatient' : 'neutral');
        if (c.patience <= 0) {
          c.state = 'leave';
          c.t = 0;
          m.setMood('angry');
          c.say('¡Me voy!');
          this.stars--;
          this.angry++;
          this.ticketsDirty = true;
          this.sfx.angry(1);
          // lo que ya le habías servido se queda en la barra, sin cobrar
          const sp = this.spots[c.stool];
          if (sp.models.length) {
            c.bill = 0;
            c.tip = 0;
            this.leaveMess(c);
            sp.money = 0;
          }
        }
      } else if (c.state === 'eating') {
        // la comida se va acabando
        const k = Math.min(1, c.t / 5);
        for (const mm of this.spots[c.stool].models) mm.scale.setScalar(1 - k * 0.35);
        if (c.t > 5) {
          m.eating = false;
          c.state = 'leave';
          c.t = 0;
          this.leaveMess(c);
          this.ticketsDirty = true;
          c.say(Math.random() < 0.5 ? '¡Hasta luego!' : '¡Qué rico!');
        }
      } else if (c.state === 'leave') {
        const k = Math.min(1, c.t / 0.8);
        m.seated = 1 - THREE.MathUtils.smoothstep(k, 0, 0.7);
        p.x = STOOL_X + (AISLE_X - STOOL_X) * k;
        m.root.rotation.y = Math.PI / 2 - (Math.PI / 2) * Math.min(1, k * 1.4);
        if (k >= 1) {
          c.state = 'exit';
          this.stoolUsed[c.stool] = false;
          m.walk = 1;
        }
      } else if (c.state === 'exit') {
        p.z += dt * 1.35;
        m.walkPhase += dt * 8;
        if (p.z > DOOR_Z + 0.2) {
          this.removeCustomer(c);
          this.customers.splice(i, 1);
          continue;
        }
      }
      if (c.moodT > 0) {
        c.moodT -= dt;
        if (c.moodT <= 0 && c.state === 'waiting') m.setMood('neutral');
      }
      m.pose(t, dt, camWorld);

      if (c.speechT > 0) {
        c.speechT -= dt;
        if (c.speechT <= 0) {
          c.speech = null;
          c.dirty = true;
        }
      }
      const show = c.speech || c.state === 'think' || c.state === 'waiting';
      c.bubble.visible = !!show;
      c.bubble.position.set(p.x + 0.55, 1.88, p.z);
      c.redrawT = (c.redrawT || 0) - dt;
      if (show && (c.dirty || c.redrawT <= 0)) {
        this.drawBubble(c);
        c.dirty = false;
        c.redrawT = 0.25;
      }
    }
  }

  // ---------- Bucle ----------

  update(dt, t) {
    if (!this.active) return null;
    this.elapsed += dt;
    this.time -= dt;

    this.spawnT -= dt;
    if (this.time > 10 && this.spawnT <= 0) {
      const ok = this.spawnCustomer();
      const progress = Math.min(1, this.elapsed / SHIFT);
      this.spawnT = ok ? (this.ordersMade < 3 ? 14 : 19 - progress * 8) * (0.75 + Math.random() * 0.5) : 2;
      if (!ok && this.spots.some((sp) => sp.dirty) && !this.tut.dirtyBlock) {
        this.tut.dirtyBlock = true;
        this.hint('Hay clientes esperando sitio: recoge los platos sucios', 3.5);
      }
    }
    this.updateCustomers(dt, t);

    // plancha
    let cooking = 0;
    for (const s of this.slots) {
      if (!s.item) continue;
      cooking++;
      s.item.t += dt;
      F.setCook(s.mesh, s.item.kind, s.item.t);
      const q = F.quality(s.item.kind, s.item.t);
      s.dot.material.color.set(q === 'raw' ? 0xffd23f : q === 'ok' ? 0x2bd66b : 0xff3b30);
      s.dot.scale.setScalar(q === 'ok' ? 0.04 + Math.sin(t * 8) * 0.006 : 0.035);
      if (Math.random() < dt * (q === 'burnt' ? 14 : 4)) {
        this.steam.spawn(0.06 + (Math.random() - 0.5) * 0.05, 1.0, s.z + (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 0.05, 0.25 + Math.random() * 0.15, (Math.random() - 0.5) * 0.05,
          1.4, 0.04, 0.22, q === 'burnt' ? this.burnCol : this.steamCol, q === 'burnt' ? 0.5 : 0.25);
      }
      if (q === 'burnt' && !s.warned) {
        s.warned = true;
        this.hint('¡Se está quemando algo en la plancha!');
        this.sfx.burn();
      }
    }
    this.grillGlow.material.opacity = cooking ? 0.25 + Math.sin(t * 3) * 0.05 : 0;

    // freidora
    const fr = this.fryer;
    if (fr.state === 'frying') {
      fr.t += dt;
      cooking++;
      this.basket.position.y += (-0.05 - this.basket.position.y) * Math.min(1, dt * 6);
      const q = F.quality('fries', fr.t);
      this.fryLamp.material.color.set(q === 'raw' ? 0xffb020 : q === 'ok' ? 0x2bd66b : 0xff3b30);
      F.cookColor('fries', fr.t, this.friesInBasket.userData.sticks.color);
      if (q === 'ok' && !fr.dinged) {
        fr.dinged = true;
        this.sfx.ding();
      }
      if (Math.random() < dt * 10) {
        this.steam.spawn(0.06 + (Math.random() - 0.5) * 0.2, 1.03, 0.02 + (Math.random() - 0.5) * 0.15,
          0, 0.2, 0, 1.0, 0.03, 0.18, q === 'burnt' ? this.burnCol : this.steamCol, 0.2);
      }
    } else {
      fr.dinged = false;
      this.basket.position.y += (0.04 - this.basket.position.y) * Math.min(1, dt * 6);
      this.fryLamp.material.color.set(0x333333);
    }
    this.sfx.sizzle(cooking);

    // llenado de vasos
    if (this.filling) {
      this.filling.t += dt;
      const k = Math.min(1, this.filling.t / 1.1);
      if (this.handModel) F.setFill(this.handModel, this.filling.flavor, k);
      if (k >= 1) {
        this.streams[this.filling.tap].visible = false;
        const ice = !!(this.hand && this.hand.ice);
        const flavor = this.filling.flavor;
        this.filling = null;
        this.setHand({ kind: 'cup', fill: flavor, ice });
      }
    }
    this.steam.update(dt);
    this.updateValid(t);

    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.ui.hint.classList.remove('show');
    }
    this.hudT = (this.hudT || 0) - dt;
    if (this.hudT <= 0) {
      this.hudT = 0.2;
      this.renderHud();
    }

    if (this.stars <= 0) return 'over';
    const busy = this.customers.some((c) => ['enter', 'sit', 'think', 'waiting', 'eating'].includes(c.state));
    if (this.time <= 0 && !busy) return 'over';
    if (this.time <= -30) return 'over';
    return null;
  }

  /** Ilumina en verde dónde se puede usar lo que llevas (o lo que ya está listo). */
  updateValid(t) {
    const targets = [];
    const hb = (act, pred) => {
      for (const o of this.clickables) if (o.userData.action === act && (!pred || pred(o))) targets.push(o);
    };
    const h = this.hand;
    const b = this.board;
    if (this.filling) {
      // nada
    } else if (!h) {
      for (let i = 0; i < this.slots.length; i++) if (this.slots[i].item && F.quality(this.slots[i].item.kind, this.slots[i].item.t) === 'ok') hb('slot', (o) => o.userData.idx === i);
      if (this.fryer.state === 'frying' && F.quality('fries', this.fryer.t) === 'ok') hb('fryer');
      if (b && b.meat) hb('board');
      this.spots.forEach((sp, i) => { if (sp.dirty) hb('spot', (o) => o.userData.idx === i); });
    } else if (h.kind === 'cup') {
      if (!h.fill) {
        if (!h.ice) hb('ice');
        hb('tap');
      }
    } else if (h.kind === 'patty' || h.kind === 'sausage') {
      const want = h.kind === 'patty' ? 'burger' : 'hotdog';
      if (b && b.type === want && !b.meat) hb('board');
      else if (!b) hb(h.kind === 'patty' ? 'bunB' : 'bunH');
    } else if (h.kind === 'fries' && !h.salt) {
      hb('salt');
    }
    const got = F.asOrder(h);
    if (got) {
      for (const c of this.customers) {
        if (c.state === 'waiting' && c.order.some((o) => !o.done && o.key === got.key)) hb('spot', (o) => o.userData.idx === c.stool);
      }
    }
    const pulse = 0.12 + 0.1 * (0.5 + 0.5 * Math.sin(t * 6));
    this.validBoxes.forEach((vb, i) => {
      const o = targets[i];
      if (!o || !o.geometry.parameters.width) {
        vb.visible = false;
        return;
      }
      const p = o.geometry.parameters;
      vb.position.copy(o.position);
      vb.scale.set(p.width * 1.04, p.height * 1.04, p.depth * 1.04);
      vb.material.opacity = pulse;
      vb.visible = true;
    });
  }

  renderHud() {
    const u = this.ui;
    if (!u.money) return;
    u.money.textContent = '$' + this.money;
    const t = Math.max(0, Math.ceil(this.time));
    u.clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    u.clock.classList.toggle('low', this.time < 30);
    const spans = u.stars.children;
    for (let i = 0; i < spans.length; i++) spans[i].classList.toggle('lost', i >= this.stars);
    u.hand.textContent = this.filling ? 'Llenando…' : this.hand ? 'En la mano: ' + F.itemLabel(this.hand) : this.board ? 'En la tabla: ' + this.boardLabel() : 'Manos libres';
    u.drop.disabled = !this.hand && !this.board;
    this.renderTickets();
  }

  /** Comandas: un ticket por cliente con su pedido en texto. */
  renderTickets() {
    const el = this.ui.tickets;
    if (!el) return;
    const list = this.customers.filter((c) => c.state === 'waiting').sort((a, b) => a.stool - b.stool);
    if (this.ticketsDirty) {
      this.ticketsDirty = false;
      el.innerHTML = list.map((c) => `
        <div class="ticket" data-id="${c.stool}">
          <div class="t-head"><span>Asiento ${c.stool + 1}</span><span>${c.name}</span></div>
          ${c.order.map((o) => `<div class="t-line${o.done ? ' done' : ''}">${F.orderLabel(o)}</div>`).join('')}
          <div class="t-bar"><i></i></div>
        </div>`).join('');
    }
    for (const c of list) {
      const bar = el.querySelector(`.ticket[data-id="${c.stool}"] .t-bar i`);
      if (!bar) {
        this.ticketsDirty = true;
        continue;
      }
      const f = Math.max(0, c.patience / c.maxPatience);
      bar.style.width = f * 100 + '%';
      bar.style.background = `hsl(${Math.round(f * 120)}, 70%, 45%)`;
    }
    if (el.children.length !== list.length) this.ticketsDirty = true;
  }

  hint(text, dur = 1.8) {
    this.ui.hint.textContent = text;
    this.ui.hint.classList.add('show');
    this.hintT = dur;
  }

  pop(text) {
    const el = this.ui.pop;
    el.textContent = text;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }
}
