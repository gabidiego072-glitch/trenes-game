import * as THREE from 'three';
import { Customer } from './customers.js';
import * as F from './food.js';
import { Particles } from '../effects.js';

// Medidas del vagón restaurante (coordenadas locales del vagón, suelo en y = 0)
const FLOOR_Y = 1.25;
const W2 = 2.2;          // media anchura interior
const L2 = 4.6;          // media longitud interior
const H = 2.55;          // altura del techo
const CAM = new THREE.Vector3(1.02, 1.66, 0);
const STOOLS = [-1.25, 0, 1.25];
const STOOL_X = -1.12;
const AISLE_X = -1.78;
const DOOR_Z = 4.25;
const SHIFT = 240;       // duración del turno (s)
const SLOTS = [0.28, 0.45, 0.62];
const TAPS = [
  { drink: 'cola', z: -0.9 },
  { drink: 'naranja', z: -1.05 },
  { drink: 'limon', z: -1.2 },
];

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
    this.pitch = -0.27;
    this.pitchFollow = 0;
    this.keysYaw = 0;
    this.customers = [];
    this.bubbleTex = [];
    this.build();
    this.hand = null;          // lo que llevas en la mano
    this.handGroup = new THREE.Group();
    this.handGroup.position.set(0.26, -0.25, -0.55);
    this.handGroup.scale.setScalar(0.75);
    this.handGroup.visible = false;
    camera.add(this.handGroup);
    this.raycaster = new THREE.Raycaster();
    this.ui = {
      hud: document.getElementById('barHud'),
      money: document.getElementById('bMoney'),
      clock: document.getElementById('bClock'),
      stars: document.getElementById('bStars'),
      hand: document.getElementById('bHand'),
      hint: document.getElementById('bHint'),
      tip: document.getElementById('bTip'),
      pop: document.getElementById('bPop'),
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

    // techo y molduras
    const cream = std(0xefe3c8, { roughness: 0.8 });
    const ceil = add(box(W2 * 2 + 0.2, 0.08, L2 * 2 + 0.2), cream, 0, H + 0.04, 0);
    ceil.castShadow = true;
    const wood = phys(0x5b2f1a, { roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const darkWood = phys(0x3a1d10, { roughness: 0.5, clearcoat: 0.4 });
    const brass = std(0xc9a14a, { roughness: 0.25, metalness: 0.95 });
    const chrome = std(0xdfe3e8, { roughness: 0.15, metalness: 1 });
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
      // cristal muy sutil
      const glass = add(box(0.01, 1.1, L2 * 2), phys(0xaaccdd, { transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, depthWrite: false }), x - s * 0.02, 1.5, 0, R, false);
      glass.renderOrder = 6;
    }

    // paredes de los extremos
    for (const s of [-1, 1]) {
      const z = s * (L2 + 0.04);
      add(box(W2 * 2, 1.0, 0.08), wood, 0, 0.5, z);
      add(box(W2 * 2, H - 1.0, 0.08), cream, 0, 1.0 + (H - 1) / 2, z);
      add(box(W2 * 2, 0.05, 0.1), brass, 0, 1.0, z - s * 0.01);
    }
    // puerta por la que entran los clientes
    const doorZ = L2 + 0.0;
    add(box(0.9, 2.1, 0.06), darkWood, AISLE_X + 0.15, 1.05, doorZ - 0.02);
    add(box(0.5, 0.9, 0.02), phys(0x9fc4d6, { transparent: true, opacity: 0.35, roughness: 0.05 }), AISLE_X + 0.15, 1.45, doorZ - 0.06, R, false);
    add(new THREE.SphereGeometry(0.03, 12, 8), brass, AISLE_X + 0.5, 1.05, doorZ - 0.08);

    // letrero de neón y carta en las paredes del fondo
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
    const neonMesh = add(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: neon, color: new THREE.Color(1.6, 1.6, 1.6) }), -0.6, 2.05, -L2 + 0.01, R, false);
    neonMesh.rotation.y = 0;
    const menu = canvasTexture(512, 640, (g, w, h) => {
      g.fillStyle = '#1d2a22';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#a8742e';
      g.lineWidth = 18;
      g.strokeRect(9, 9, w - 18, h - 18);
      g.fillStyle = '#f4efe2';
      g.textAlign = 'center';
      g.font = "700 54px 'Georgia', serif";
      g.fillText('CARTA', w / 2, 90);
      g.font = "400 34px 'Georgia', serif";
      g.textAlign = 'left';
      const rows = [['Hamburguesa', 6], ['Perrito', 4], ['Patatas', 3], ['Cola', 2], ['Naranja', 2], ['Limón', 2]];
      rows.forEach(([n, p], i) => {
        g.fillText(n, 50, 175 + i * 72);
        g.textAlign = 'right';
        g.fillText('$' + p, w - 50, 175 + i * 72);
        g.textAlign = 'left';
      });
      g.font = "italic 26px 'Georgia', serif";
      g.textAlign = 'center';
      g.fillText('Servicio a bordo', w / 2, h - 50);
    });
    const menuMesh = add(new THREE.PlaneGeometry(0.62, 0.78), std(0xffffff, { map: menu, roughness: 0.9 }), 0.7, 1.65, L2 - 0.01, R, false);
    menuMesh.rotation.y = Math.PI;

    // estantería con botellas en la pared del fondo
    for (const y of [1.3, 1.62]) add(box(1.4, 0.03, 0.22), darkWood, 1.2, y, -L2 + 0.12);
    const bottleCols = [0x2e7d32, 0x8d3a1a, 0xc9a14a, 0x1e4f8a, 0x7a1f3a, 0xd9d2c0];
    for (let i = 0; i < 14; i++) {
      const y = i < 7 ? 1.315 : 1.635;
      const b = add(new THREE.CylinderGeometry(0.032, 0.035, 0.22, 12), phys(bottleCols[i % bottleCols.length], { roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.85 }), 0.65 + (i % 7) * 0.18, y + 0.11, -L2 + 0.12);
      add(new THREE.CylinderGeometry(0.01, 0.014, 0.07, 8), b.material, 0, 0.14, 0, b);
    }

    // ---- barra donde se sientan los clientes ----
    const leather = phys(0x8a1c22, { roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xff8080) });
    add(box(0.62, 0.06, 5.6), wood, -0.48, 1.02, 0);
    add(box(0.06, 0.96, 5.6), leather, -0.77, 0.48, 0);
    for (const y of [0.15, 0.86]) add(box(0.07, 0.03, 5.62), chrome, -0.78, y, 0);
    add(box(0.05, 0.96, 5.6), darkWood, -0.2, 0.48, 0);
    const rail = add(new THREE.CylinderGeometry(0.022, 0.022, 5.5, 12), brass, -0.88, 0.2, 0);
    rail.rotation.x = Math.PI / 2;
    // taburetes
    this.stoolMeshes = STOOLS.map((z) => {
      const g = new THREE.Group();
      g.position.set(STOOL_X, 0, z);
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 24), chrome, 0, 0.015, 0, g);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.68, 12), chrome, 0, 0.36, 0, g);
      const ring = add(new THREE.TorusGeometry(0.16, 0.012, 8, 28), chrome, 0, 0.32, 0, g);
      ring.rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.2, 0.19, 0.08, 28), leather, 0, 0.7, 0, g);
      R.add(g);
      return g;
    });
    // detalles sobre la barra
    add(box(0.28, 0.2, 0.3), std(0x2a2a2a, { metalness: 0.5, roughness: 0.4 }), -0.5, 1.15, 2.4);
    add(box(0.2, 0.05, 0.22), chrome, -0.5, 1.27, 2.4);
    for (const [z, col] of [[-1.8, 0xd8262b], [-1.72, 0xf2c41a], [0.62, 0xd8262b], [0.7, 0xf2c41a], [1.9, 0xd8262b]]) {
      const b = add(new THREE.CylinderGeometry(0.022, 0.025, 0.15, 12), phys(col, { roughness: 0.3, clearcoat: 1 }), -0.62, 1.125, z);
      add(new THREE.ConeGeometry(0.012, 0.04, 8), b.material, 0, 0.095, 0, b);
    }
    const jar = add(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 20, 1, true), phys(0xddeeff, { transparent: true, opacity: 0.35, roughness: 0.05, side: THREE.DoubleSide }), -0.5, 1.12, -2.4);
    jar.renderOrder = 6;
    this.tipCoins = add(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 16), brass, -0.5, 1.06, -2.4);

    // ---- mostrador de trabajo (acero) ----
    const steel = std(0xb9bec4, { metalness: 0.9, roughness: 0.32 });
    const darkSteel = std(0x3a3d42, { metalness: 0.7, roughness: 0.45 });
    add(box(0.56, 0.05, 3.0), steel, 0.08, 0.895, -0.15);
    add(box(0.54, 0.87, 2.98), darkSteel, 0.08, 0.435, -0.15);

    const click = (obj, action, label, data = {}) => {
      obj.userData.action = action;
      obj.userData.label = label;
      Object.assign(obj.userData, data);
      this.clickables.push(obj);
      return obj;
    };

    // bandejas de carne y salchichas
    const trayMat = std(0xe0e0e0, { metalness: 0.6, roughness: 0.3 });
    const pattyTray = add(box(0.2, 0.03, 0.17), trayMat, 0.04, 0.935, 1.12);
    click(pattyTray, 'patty', 'Carne cruda · a la plancha');
    for (let i = 0; i < 4; i++) {
      const p = F.makePatty(0);
      p.position.set(0.04 + (i % 2) * 0.05 - 0.025, 0.96 + Math.floor(i / 2) * 0.02, 1.12 + (i % 2 ? 0.03 : -0.03));
      R.add(p);
      click(p, 'patty', 'Carne cruda · a la plancha');
    }
    const sausTray = add(box(0.2, 0.03, 0.17), trayMat, 0.04, 0.935, 0.9);
    click(sausTray, 'sausage', 'Salchichas · a la plancha');
    for (let i = 0; i < 4; i++) {
      const s = F.makeSausage(0);
      s.position.set(0.04, 0.965, 0.84 + i * 0.04);
      s.rotation.set(0, Math.PI / 2, Math.PI / 2);
      R.add(s);
      click(s, 'sausage', 'Salchichas · a la plancha');
    }

    // plancha
    const grill = add(box(0.36, 0.04, 0.5), std(0x1c1c1e, { metalness: 0.6, roughness: 0.5 }), 0.06, 0.94, 0.45);
    for (let i = 0; i < 9; i++) add(box(0.34, 0.004, 0.006), std(0x2a2a2c, { metalness: 0.7, roughness: 0.4 }), 0.06, 0.962, 0.22 + i * 0.058);
    this.grillGlow = add(box(0.37, 0.01, 0.51), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.0 }), 0.06, 0.918, 0.45, R, false);
    click(grill, 'grill', 'Plancha');
    this.slots = SLOTS.map((z, i) => {
      const hit = add(box(0.2, 0.06, 0.15), new THREE.MeshBasicMaterial({ visible: false }), 0.06, 0.98, z, R, false);
      click(hit, 'slot', 'Plancha', { idx: i });
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd23f, depthTest: false }));
      dot.scale.set(0.035, 0.035, 1);
      dot.position.set(0.06, 1.06, z);
      dot.visible = false;
      dot.renderOrder = 8;
      R.add(dot);
      return { z, item: null, mesh: null, dot };
    });

    // freidora
    const fryer = new THREE.Group();
    fryer.position.set(0.06, 0.92, 0.02);
    R.add(fryer);
    add(box(0.3, 0.12, 0.26), steel, 0, 0.06, 0, fryer);
    add(box(0.26, 0.01, 0.22), phys(0xb07a1e, { roughness: 0.1, clearcoat: 1 }), 0, 0.1, 0, fryer);
    this.basket = new THREE.Group();
    fryer.add(this.basket);
    const wire = std(0xcfd3d8, { metalness: 0.9, roughness: 0.3, wireframe: true });
    add(box(0.2, 0.08, 0.16, 4, 2, 4), wire, 0, 0.16, 0, this.basket);
    const handle = add(box(0.18, 0.015, 0.02), std(0x111111), 0.17, 0.2, 0, this.basket);
    handle.rotation.z = -0.4;
    this.friesInBasket = F.makeFries('ok', 0);
    this.friesInBasket.children[0].visible = false;
    this.friesInBasket.position.set(0, 0.07, 0);
    this.friesInBasket.scale.setScalar(1.3);
    this.friesInBasket.visible = false;
    this.basket.add(this.friesInBasket);
    this.fryLamp = add(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0x333333 }), 0.155, 0.08, 0.1, fryer, false);
    click(fryer, 'fryer', 'Freidora · patatas');
    this.fryer = { state: 'idle', t: 0 };

    // tabla de panes
    const board = add(box(0.24, 0.025, 0.26), phys(0xc8995a, { roughness: 0.7 }), 0.05, 0.93, -0.38);
    click(board, 'board', 'Panes · monta la hamburguesa o el perrito');
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0xc98a3c, { roughness: 0.55 }));
    bun.scale.y = 0.7;
    bun.position.set(0.05, 0.945, -0.32);
    bun.castShadow = true;
    R.add(bun);
    click(bun, 'board', 'Panes · monta la hamburguesa o el perrito');
    const hbun = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.1, 6, 10), std(0xc98a3c, { roughness: 0.55 }));
    hbun.rotation.set(0, 0, Math.PI / 2);
    hbun.position.set(0.05, 0.96, -0.45);
    hbun.castShadow = true;
    R.add(hbun);
    click(hbun, 'board', 'Panes · monta la hamburguesa o el perrito');

    // vasos
    for (let i = 0; i < 5; i++) {
      const c = F.makeCup(null);
      c.position.set(0.05, 0.92 + i * 0.025, -0.7);
      R.add(c);
      click(c, 'cups', 'Vasos');
    }

    // máquina de refrescos con tres grifos
    // la cara con los grifos mira hacia el camarero (+x)
    const mach = add(box(0.2, 0.44, 0.48), std(0xc8202a, { roughness: 0.35, metalness: 0.2 }), 0.0, 1.14, -1.05);
    click(mach, 'machine', 'Máquina de refrescos');
    add(box(0.16, 0.02, 0.46), darkSteel, 0.2, 0.93, -1.05);
    const top = add(box(0.21, 0.06, 0.49), std(0xf2f2f2, { roughness: 0.4 }), 0.0, 1.38, -1.05);
    void top;
    this.streams = TAPS.map((t) => {
      const name = 'Grifo de ' + F.ITEMS[t.drink].name.toLowerCase();
      const lab = add(box(0.005, 0.09, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(F.ITEMS[t.drink].color).multiplyScalar(t.drink === 'cola' ? 3 : 1.4) }), 0.102, 1.26, t.z, R, false);
      click(lab, 'tap', name, { drink: t.drink });
      const tap = add(new THREE.CylinderGeometry(0.016, 0.016, 0.09, 10), chrome, 0.14, 1.12, t.z);
      tap.rotation.z = Math.PI / 2;
      click(tap, 'tap', name, { drink: t.drink });
      const spout = add(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 8), chrome, 0.18, 1.09, t.z);
      click(spout, 'tap', name, { drink: t.drink });
      const hit = add(box(0.2, 0.3, 0.14), new THREE.MeshBasicMaterial({ visible: false }), 0.16, 1.1, t.z, R, false);
      click(hit, 'tap', name, { drink: t.drink });
      const stream = add(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 8), new THREE.MeshBasicMaterial({ color: F.ITEMS[t.drink].color }), 0.18, 1.0, t.z, R, false);
      stream.visible = false;
      return stream;
    });

    // papelera
    const bin = add(new THREE.CylinderGeometry(0.14, 0.12, 0.86, 20), std(0x5a6068, { metalness: 0.6, roughness: 0.4 }), 0.12, 0.43, -1.78);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 20), std(0x30343a, { metalness: 0.6, roughness: 0.3 }), 0.12, 0.875, -1.78);
    click(bin, 'trash', 'Papelera');

    // lámparas colgantes
    this.lights = [];
    for (const z of [-1.4, 0.2, 1.8]) {
      const cord = add(new THREE.CylinderGeometry(0.004, 0.004, 0.45, 6), std(0x111111), -0.45, H - 0.22, z, R, false);
      const shade = add(new THREE.ConeGeometry(0.17, 0.16, 24, 1, true), phys(0x1f5c3a, { roughness: 0.35, side: THREE.DoubleSide, clearcoat: 0.6 }), -0.45, H - 0.5, z, R, false);
      add(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.0, 1.3) }), -0.45, H - 0.56, z, R, false);
      void cord; void shade;
    }
    const l1 = new THREE.PointLight(0xffc98a, 3.2, 7, 1.4);
    l1.position.set(-0.2, H - 0.25, 0);
    const l2 = new THREE.PointLight(0xfff0dd, 1.4, 3.5, 1.4);
    l2.position.set(0.3, H - 0.2, -0.1);
    R.add(l1, l2);
    this.lights.push(l1, l2);

    // humo/vapor de la cocina (en coordenadas del vagón)
    this.steam = new Particles(R, 200, { soft: true, drag: 1.5, gravity: 0.6 });
    this.steamCol = new THREE.Color(0.85, 0.85, 0.88);
    this.burnCol = new THREE.Color(0.2, 0.18, 0.18);
  }

  // ---------- Ciclo de vida ----------

  attach(train) {
    this.train = train;
    this.car = train.cars[2];
    this.hidden = [];
    for (const ch of this.car.g.children) {
      if (ch.visible) {
        this.hidden.push(ch);
        ch.visible = false;
      }
    }
    this.car.g.add(this.root);
  }

  detach() {
    if (!this.car) return;
    this.car.g.remove(this.root);
    for (const ch of this.hidden) ch.visible = true;
    this.car = null;
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
    this.spawnT = 2;
    this.elapsed = 0;
    for (const c of this.customers) this.removeCustomer(c);
    this.customers = [];
    this.stoolUsed = [false, false, false];
    for (const s of this.slots) this.clearSlot(s);
    this.fryer = { state: 'idle', t: 0 };
    this.basket.position.y = 0.04;
    this.friesInBasket.visible = false;
    this.setHand(null);
    this.filling = null;
    this.yawDrag = 0;
    this.camera.near = 0.06;
    this.camera.updateProjectionMatrix();
    this.ui.hud.hidden = false;
    this.hint('Tu primer cliente está a punto de llegar', 3);
    this.renderHud();
  }

  stop() {
    this.active = false;
    for (const c of this.customers) this.removeCustomer(c);
    this.customers = [];
    for (const s of this.slots) this.clearSlot(s);
    this.setHand(null);
    this.detach();
    this.camera.near = 0.3;
    this.camera.updateProjectionMatrix();
    this.ui.hud.hidden = true;
    this.ui.tip.hidden = true;
    this.sfx.sizzle(0);
  }

  results() {
    return { money: this.money, served: this.served, angry: this.angry, perfect: this.perfect };
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
    // amortiguar el balanceo del vagón para que no maree
    _q2.setFromEuler(_e.set(pitch, Math.PI / 2 + this.yaw, 0, 'YXZ'));
    camera.quaternion.copy(_q).multiply(_q2);
    // mano: pequeño vaivén
    const t = performance.now() / 1000;
    this.handGroup.position.set(0.26, -0.25 + Math.sin(t * 2) * 0.005, -0.55);
  }

  pointerLook(nx, ny, isMouse) {
    if (!isMouse) return;
    this.lookFollow = (0.5 - nx) * 0.8;
    this.pitchFollow = (0.5 - ny) * 0.35;
  }

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
      if (o) return o;
    }
    return null;
  }

  hover(nx, ny, px, py) {
    const o = this.pick(nx, ny);
    const tip = this.ui.tip;
    if (!o) {
      tip.hidden = true;
      return;
    }
    let label = o.userData.label;
    if (o.userData.customer) {
      const c = o.userData.customer;
      label = c.state === 'waiting' ? (this.hand ? 'Servir' : 'Cliente esperando') : 'Cliente';
    } else if (o.userData.action === 'slot') {
      const s = this.slots[o.userData.idx];
      label = s.item ? F.itemLabel(s.item) : 'Plancha (hueco libre)';
    } else if (o.userData.action === 'fryer') {
      label = this.fryer.state === 'idle' ? 'Freidora · pulsa para freír' : 'Patatas ' + ({ raw: 'friéndose', ok: 'listas', burnt: 'quemadas' })[F.quality('fries', this.fryer.t)];
    }
    tip.textContent = label;
    tip.style.left = px + 14 + 'px';
    tip.style.top = py + 14 + 'px';
    tip.hidden = false;
  }

  click(nx, ny) {
    const o = this.pick(nx, ny);
    if (!o) return;
    if (o.userData.customer) this.serve(o.userData.customer);
    else this.act(o.userData.action, o.userData);
    this.renderHud();
  }

  act(action, data) {
    const hand = this.hand;
    if (this.filling) return this.hint('Espera a que se llene el vaso');
    switch (action) {
      case 'patty':
      case 'sausage': {
        if (hand) return this.hint('Tienes las manos ocupadas');
        const s = this.slots.find((sl) => !sl.item);
        if (!s) return this.hint('La plancha está llena');
        this.putOnGrill(s, { kind: action, t: 0 });
        this.sfx.plop();
        return;
      }
      case 'grill':
      case 'slot': {
        const s = data.idx !== undefined ? this.slots[data.idx] : this.slots.find((sl) => sl.item) || this.slots[0];
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
        return this.hint('Tienes las manos ocupadas');
      }
      case 'fryer': {
        const fr = this.fryer;
        if (fr.state === 'idle') {
          if (hand) return this.hint('Tienes las manos ocupadas');
          fr.state = 'frying';
          fr.t = 0;
          this.friesInBasket.visible = true;
          this.sfx.plop();
          return;
        }
        if (hand) return this.hint('Tienes las manos ocupadas');
        const q = F.quality('fries', fr.t);
        if (q === 'raw') return this.hint('Las patatas aún se están friendo');
        this.setHand({ kind: 'fries', q, t: fr.t });
        fr.state = 'idle';
        this.friesInBasket.visible = false;
        return;
      }
      case 'board': {
        if (!hand) return this.hint('Pon aquí la carne o la salchicha de la plancha');
        if (hand.kind === 'patty') return this.setHand({ kind: 'burger', q: F.quality('patty', hand.t) });
        if (hand.kind === 'sausage') return this.setHand({ kind: 'hotdog', q: F.quality('sausage', hand.t) });
        return this.hint('Aquí solo se montan hamburguesas y perritos');
      }
      case 'cups':
        if (hand) return this.hint('Tienes las manos ocupadas');
        return this.setHand({ kind: 'cup', fill: null });
      case 'tap':
      case 'machine': {
        if (!hand || hand.kind !== 'cup') return this.hint('Coge primero un vaso');
        if (hand.fill) return this.hint('El vaso ya está lleno');
        const drink = data.drink || 'cola';
        const tap = TAPS.findIndex((t) => t.drink === drink);
        this.filling = { drink, t: 0, tap };
        this.streams[tap].visible = true;
        this.sfx.pour();
        return;
      }
      case 'trash':
        if (!hand) return this.hint('La papelera está vacía');
        this.setHand(null);
        this.sfx.trash();
        return;
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
  }

  clearSlot(s) {
    if (s.mesh) this.root.remove(s.mesh);
    s.item = null;
    s.mesh = null;
    s.dot.visible = false;
  }

  setHand(item) {
    this.hand = item;
    while (this.handGroup.children.length) this.handGroup.remove(this.handGroup.children[0]);
    if (item) {
      const m = F.makeHeld(item);
      m.rotation.y = -0.4;
      if (item.kind === 'patty') m.position.y = 0.02;
      this.handGroup.add(m);
      this.handModel = m;
    }
    this.handGroup.visible = !!item;
    if (item && F.orderKey(item) && !this.tutServe) {
      this.tutServe = true;
      this.hint('Ahora pulsa sobre el cliente para servirle', 3.5);
    }
    this.renderHud();
  }

  serve(c) {
    if (c.state !== 'waiting') return this.hint(c.state === 'think' ? 'Está decidiendo qué pedir' : 'Este cliente ya está servido');
    if (!this.hand) return this.hint('Prepara su pedido y pulsa sobre el cliente para servirlo');
    const key = F.orderKey(this.hand);
    if (!key) {
      return this.hint(this.hand.kind === 'cup' ? 'El vaso está vacío' : 'Primero ponlo en un pan');
    }
    const o = c.order.find((it) => it.key === key && !it.done);
    if (!o) {
      c.say('¡Eso no lo he pedido!');
      c.model.setMood('impatient');
      this.sfx.angry(0.4);
      return;
    }
    const q = this.hand.q || 'ok';
    this.setHand(null);
    if (q !== 'ok') {
      c.patience -= c.maxPatience * 0.25;
      c.model.setMood('disgust');
      c.moodT = 1.6;
      c.say(q === 'raw' ? '¡Está crudo!' : '¡Está quemado!');
      this.sfx.angry(0.6);
      return;
    }
    o.done = true;
    this.perfect++;
    c.dirty = true;
    this.sfx.serveItem();
    if (c.order.every((it) => it.done)) {
      const price = c.order.reduce((s, it) => s + F.ITEMS[it.key].price, 0);
      const frac = Math.max(0, c.patience / c.maxPatience);
      const tip = Math.round(price * 0.7 * frac);
      this.money += price + tip;
      this.served++;
      c.state = 'eating';
      c.t = 0;
      c.model.setMood('happy');
      c.say(tip >= price * 0.4 ? '¡Rapidísimo, gracias!' : '¡Gracias!');
      this.pop(`+$${price}` + (tip ? ` · propina $${tip}` : ''));
      this.sfx.register();
      this.tipCoins.scale.y = Math.min(12, 1 + this.served * 0.8);
    } else {
      c.model.setMood('neutral');
      c.say('¡Bien! ¿Y lo demás?');
    }
  }

  // ---------- Clientes ----------

  spawnCustomer() {
    const free = this.stoolUsed.map((u, i) => (u ? -1 : i)).filter((i) => i >= 0);
    if (!free.length) return;
    const stool = free[Math.floor(Math.random() * free.length)];
    this.stoolUsed[stool] = true;
    const model = new Customer();
    model.root.position.set(AISLE_X, 0, DOOR_Z);
    model.root.rotation.y = Math.PI;
    model.walk = 1;
    model.walkPhase = 0;
    this.root.add(model.root);
    const c = {
      model, stool, z: STOOLS[stool], state: 'enter', t: 0, order: [], patience: 1, maxPatience: 1, moodT: 0,
      bubble: this.makeBubble(), dirty: true, speech: null, speechT: 0,
    };
    model.root.traverse((m) => (m.userData.customer = c));
    model.root.userData.customer = c;
    c.say = (text) => {
      c.speech = text;
      c.speechT = 2.2;
      c.dirty = true;
    };
    this.root.add(c.bubble);
    this.customers.push(c);
    this.sfx.bell();
  }

  removeCustomer(c) {
    this.root.remove(c.model.root);
    this.root.remove(c.bubble);
    c.bubble.material.map.dispose();
    c.bubble.material.dispose();
  }

  makeOrder() {
    const progress = Math.min(1, this.elapsed / SHIFT);
    const n = Math.random() < 0.45 - progress * 0.2 ? 1 : Math.random() < 0.8 ? 2 : 3;
    const pool = ['cola', 'naranja', 'limon', 'burger', 'burger', 'hotdog', 'hotdog', 'fries', 'fries'];
    const order = [];
    for (let i = 0; i < n; i++) {
      let k = pool[Math.floor(Math.random() * pool.length)];
      // como mucho una bebida por pedido
      if (F.DRINKS.includes(k) && order.some((o) => F.DRINKS.includes(o.key))) k = 'fries';
      order.push({ key: k, done: false });
    }
    return order;
  }

  makeBubble() {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 200;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(0.56, 0.35, 1);
    s.renderOrder = 9;
    s.visible = false;
    s.userData.canvas = canvas;
    return s;
  }

  drawBubble(c) {
    const cv = c.bubble.userData.canvas;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const w = cv.width, h = cv.height;
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
    if (c.speech) {
      g.fillStyle = '#1b1b1b';
      g.font = "700 30px 'Inter', Arial, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(c.speech, w / 2, (h - 40) / 2 + 4, w - 40);
    } else if (c.state === 'think') {
      g.fillStyle = '#555';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(w / 2 - 30 + i * 30, (h - 40) / 2, 9 + (Math.floor(performance.now() / 250) % 3 === i ? 4 : 0), 0, Math.PI * 2);
        g.fill();
      }
    } else {
      const n = c.order.length;
      const size = 84;
      const startX = w / 2 - ((n - 1) * 96) / 2;
      c.order.forEach((o, i) => {
        const x = startX + i * 96, y = 72;
        g.globalAlpha = o.done ? 0.3 : 1;
        F.drawIcon(g, o.key, x, y, size);
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
      // barra de paciencia
      const f = Math.max(0, c.patience / c.maxPatience);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.beginPath();
      g.roundRect(34, h - 66, w - 68, 12, 6);
      g.fill();
      g.fillStyle = `hsl(${Math.round(f * 120)}, 75%, 45%)`;
      g.beginPath();
      g.roundRect(34, h - 66, (w - 68) * f, 12, 6);
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
        const tz = c.z;
        if (p.z > tz + 0.02) {
          p.z = Math.max(tz, p.z - dt * 1.25);
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
        if (c.t > 1.4) {
          c.order = this.makeOrder();
          const progress = Math.min(1, this.elapsed / SHIFT);
          c.maxPatience = (34 + c.order.length * 12) * (1 - progress * 0.3);
          c.patience = c.maxPatience;
          c.state = 'waiting';
          c.dirty = true;
          this.sfx.orderPing();
          if (!this.tutOrder) {
            this.tutOrder = true;
            this.hint('Mira su pedido en el bocadillo y prepáralo en tu mostrador', 4);
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
          this.sfx.angry(1);
        }
      } else if (c.state === 'eating') {
        if (c.t > 2.6) {
          c.state = 'leave';
          c.t = 0;
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

      // bocadillo
      if (c.speechT > 0) {
        c.speechT -= dt;
        if (c.speechT <= 0) {
          c.speech = null;
          c.dirty = true;
        }
      }
      const showBubble = c.speech || c.state === 'think' || c.state === 'waiting';
      c.bubble.visible = !!showBubble;
      c.bubble.position.set(p.x + 0.2, 1.9, p.z);
      c.redrawT = (c.redrawT || 0) - dt;
      if (showBubble && (c.dirty || c.redrawT <= 0)) {
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

    // llegada de clientes: cada vez más seguidos
    this.spawnT -= dt;
    if (this.time > 8 && this.spawnT <= 0) {
      this.spawnCustomer();
      const progress = Math.min(1, this.elapsed / SHIFT);
      this.spawnT = (15 - progress * 8) * (0.75 + Math.random() * 0.5);
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
      if (q !== 'burnt') s.warned = false;
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
      F.setCook(this.friesInBasket.children[1], 'fries', fr.t);
      for (let k = 1; k < this.friesInBasket.children.length; k++) cookColorTo(this.friesInBasket.children[k], fr.t);
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
      if (this.handModel) F.setFill(this.handModel, this.filling.drink, k);
      if (k >= 1) {
        this.streams[this.filling.tap].visible = false;
        this.setHand({ kind: 'cup', fill: this.filling.drink });
        this.filling = null;
      }
    }
    this.steam.update(dt);

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
    if (this.time <= 0 && !this.customers.some((c) => c.state === 'waiting' || c.state === 'think')) return 'over';
    if (this.time <= -25) return 'over';
    return null;
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
    u.hand.textContent = this.filling ? 'Llenando…' : this.hand ? 'En la mano: ' + F.itemLabel(this.hand) : 'Manos libres';
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

function cookColorTo(mesh, t) {
  if (mesh && mesh.material && mesh.material.color) F.cookColor('fries', t, mesh.material.color);
}
