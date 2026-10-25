import * as THREE from 'three';

// ---------- Datos de la carta ----------

export const ITEMS = {
  cola: { name: 'Cola', price: 2, color: 0x3a1a0c },
  naranja: { name: 'Naranja', price: 2, color: 0xff8a1c },
  limon: { name: 'Limón', price: 2, color: 0xc9e83a },
  burger: { name: 'Hamburguesa', price: 6 },
  hotdog: { name: 'Perrito', price: 4 },
  fries: { name: 'Patatas', price: 3 },
};
export const DRINKS = ['cola', 'naranja', 'limon'];

// Tiempos de cocinado (segundos): hecho a partir de `ok`, quemado a partir de `burnt`.
export const COOK = {
  patty: { ok: 6, burnt: 14 },
  sausage: { ok: 4.5, burnt: 11 },
  fries: { ok: 5, burnt: 12 },
};

export function quality(kind, t) {
  const c = COOK[kind];
  if (t < c.ok) return 'raw';
  if (t < c.burnt) return 'ok';
  return 'burnt';
}

// ---------- Materiales ----------

const mats = {};
function mat(key, params) {
  if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial(params);
  return mats[key];
}
const physical = (p) => new THREE.MeshPhysicalMaterial(p);

const BUN = () => mat('bun', { color: 0xc98a3c, roughness: 0.55 });
const BUN_IN = () => mat('bunIn', { color: 0xf0d9a8, roughness: 0.8 });
const PLATE = () => mat('plate', { color: 0xf4f4f0, roughness: 0.25 });

/** Color de la carne según el tiempo en la plancha. */
const RAW = new THREE.Color(0xd9737a), DONE = new THREE.Color(0x6b3a1e), BURNT = new THREE.Color(0x161210);
const RAW_S = new THREE.Color(0xe8909a), DONE_S = new THREE.Color(0x9a3d1e);
export function cookColor(kind, t, out = new THREE.Color()) {
  const c = COOK[kind];
  const raw = kind === 'sausage' ? RAW_S : RAW;
  const done = kind === 'sausage' ? DONE_S : DONE;
  if (kind === 'fries') {
    const a = new THREE.Color(0xf3e3a0), b = new THREE.Color(0xe0a63a), d = new THREE.Color(0x4a2a10);
    return t < c.ok ? out.copy(a).lerp(b, t / c.ok) : out.copy(b).lerp(d, Math.min(1, (t - c.ok) / (c.burnt - c.ok)));
  }
  if (t < c.ok) return out.copy(raw).lerp(done, t / c.ok);
  return out.copy(done).lerp(BURNT, Math.min(1, (t - c.ok) / (c.burnt - c.ok)));
}

function shadowy(g) {
  g.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return g;
}

// ---------- Modelos ----------

export function makePatty(t = 0) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.054, 0.018, 24),
    new THREE.MeshStandardMaterial({ color: cookColor('patty', t), roughness: 0.8 })
  );
  m.userData.kind = 'patty';
  m.castShadow = true;
  return m;
}

export function makeSausage(t = 0) {
  const m = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.016, 0.1, 6, 12),
    new THREE.MeshStandardMaterial({ color: cookColor('sausage', t), roughness: 0.45 })
  );
  m.rotation.z = Math.PI / 2;
  m.userData.kind = 'sausage';
  m.castShadow = true;
  return m;
}

export function setCook(obj, kind, t) {
  obj.traverse((m) => {
    if (m.isMesh && m.userData.cook) cookColor(kind, t, m.material.color);
  });
  if (obj.isMesh && obj.material && obj.material.color) cookColor(kind, t, obj.material.color);
}

/** Vaso de papel con pajita; el líquido sube al servir. */
export function makeCup(fill = null, level = 1) {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.03, 0.12, 24, 1, true),
    physical({ color: 0xfafafa, roughness: 0.5, side: THREE.DoubleSide })
  );
  paper.position.y = 0.06;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.0375, 0.0345, 0.03, 24, 1, true), mat('cupStripe', { color: 0xd8262b, roughness: 0.5 }));
  stripe.position.y = 0.055;
  stripe.scale.setScalar(1.01);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), mat('cupBottom', { color: 0xeeeeee }));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.002;
  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.037, 0.029, 1, 24),
    physical({ color: 0x000000, roughness: 0.15, clearcoat: 1 })
  );
  liquid.visible = false;
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.17, 8), mat('straw', { color: 0xffffff, roughness: 0.4 }));
  straw.position.set(0.012, 0.12, 0);
  straw.rotation.z = -0.18;
  straw.visible = false;
  g.add(paper, stripe, bottom, liquid, straw);
  g.userData = { kind: 'cup', liquid, straw };
  setFill(g, fill, level);
  return shadowy(g);
}

export function setFill(cup, fill, level = 1) {
  const { liquid, straw } = cup.userData;
  if (!fill || level <= 0) {
    liquid.visible = false;
    straw.visible = false;
    return;
  }
  liquid.visible = true;
  straw.visible = level >= 1;
  liquid.material.color.set(ITEMS[fill].color);
  const h = 0.105 * Math.min(1, level);
  liquid.scale.set(1, h, 1);
  liquid.position.y = 0.005 + h / 2;
}

function plate() {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.012, 32), PLATE());
  p.position.y = 0.006;
  return p;
}

export function makeBurger(q = 'ok') {
  const g = new THREE.Group();
  g.add(plate());
  const y0 = 0.012;
  const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.055, 0.022, 28), BUN());
  bot.position.y = y0 + 0.011;
  const patty = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 28), new THREE.MeshStandardMaterial({ roughness: 0.8 }));
  cookColor('patty', q === 'raw' ? 1 : q === 'ok' ? 8 : 20, patty.material.color);
  patty.position.y = y0 + 0.032;
  const cheese = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.1), mat('cheese', { color: 0xffc21a, roughness: 0.5 }));
  cheese.rotation.y = Math.PI / 4;
  cheese.position.y = y0 + 0.044;
  const lettuce = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 6, 20), mat('lettuce', { color: 0x5fb33a, roughness: 0.6 }));
  lettuce.rotation.x = Math.PI / 2;
  lettuce.scale.z = 0.6;
  lettuce.position.y = y0 + 0.049;
  const tomato = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.007, 20), mat('tomato', { color: 0xd8312a, roughness: 0.35 }));
  tomato.position.y = y0 + 0.054;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.06, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), BUN());
  top.scale.y = 0.7;
  top.position.y = y0 + 0.058;
  g.add(bot, patty, cheese, lettuce, tomato, top);
  // sésamo
  const seedGeo = new THREE.SphereGeometry(0.004, 6, 4);
  seedGeo.scale(1, 0.5, 1.6);
  const seedMat = mat('seed', { color: 0xfff2cc, roughness: 0.6 });
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.045;
    const s = new THREE.Mesh(seedGeo, seedMat);
    const yy = Math.sqrt(Math.max(0, 0.06 * 0.06 - r * r)) * 0.7;
    s.position.set(Math.cos(a) * r, y0 + 0.058 + yy, Math.sin(a) * r);
    s.rotation.y = a;
    g.add(s);
  }
  g.userData = { kind: 'burger', q };
  return shadowy(g);
}

export function makeHotdog(q = 'ok') {
  const g = new THREE.Group();
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.02, 0.07), mat('tray', { color: 0xe8e2d6, roughness: 0.8 }));
  tray.position.y = 0.01;
  g.add(tray);
  for (const s of [-1, 1]) {
    const half = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.11, 6, 12), BUN());
    half.rotation.z = Math.PI / 2;
    half.position.set(0, 0.035, s * 0.016);
    half.scale.set(1, 1, 0.9);
    g.add(half);
  }
  const sausage = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.13, 6, 12), new THREE.MeshStandardMaterial({ roughness: 0.4 }));
  cookColor('sausage', q === 'raw' ? 1 : q === 'ok' ? 7 : 20, sausage.material.color);
  sausage.rotation.z = Math.PI / 2;
  sausage.position.y = 0.048;
  g.add(sausage);
  // mostaza en zigzag
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    pts.push(new THREE.Vector3(-0.065 + u * 0.13, 0.063, Math.sin(u * Math.PI * 7) * 0.009));
  }
  const mustard = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0028, 6, false),
    mat('mustard', { color: 0xf2c41a, roughness: 0.4 })
  );
  g.add(mustard);
  g.userData = { kind: 'hotdog', q };
  return shadowy(g);
}

export function makeFries(q = 'ok', t = 7) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.036, 0.09, 4, 1, true), physical({ color: 0xd8262b, roughness: 0.6, side: THREE.DoubleSide }));
  box.rotation.y = Math.PI / 4;
  box.position.y = 0.045;
  g.add(box);
  const stickGeo = new THREE.BoxGeometry(0.008, 0.08, 0.008);
  const col = cookColor('fries', q === 'raw' ? 1 : q === 'ok' ? Math.max(t, 6) : 20);
  const stickMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 });
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Mesh(stickGeo, stickMat);
    s.position.set((Math.random() - 0.5) * 0.05, 0.085 + Math.random() * 0.02, (Math.random() - 0.5) * 0.05);
    s.rotation.set((Math.random() - 0.5) * 0.4, Math.random(), (Math.random() - 0.5) * 0.4);
    g.add(s);
  }
  g.userData = { kind: 'fries', q };
  return shadowy(g);
}

/** Crea el modelo 3D de lo que llevas en la mano. */
export function makeHeld(item) {
  switch (item.kind) {
    case 'cup': return makeCup(item.fill, item.fill ? 1 : 0);
    case 'patty': return makePatty(item.t);
    case 'sausage': return makeSausage(item.t);
    case 'burger': return makeBurger(item.q);
    case 'hotdog': return makeHotdog(item.q);
    case 'fries': return makeFries(item.q, item.t);
    default: return new THREE.Group();
  }
}

export function itemLabel(item) {
  if (!item) return '';
  const qn = { raw: 'cruda', ok: 'en su punto', burnt: 'quemada' };
  switch (item.kind) {
    case 'cup': return item.fill ? 'Vaso de ' + ITEMS[item.fill].name.toLowerCase() : 'Vaso vacío';
    case 'patty': return 'Carne ' + qn[quality('patty', item.t)];
    case 'sausage': return 'Salchicha ' + ({ raw: 'cruda', ok: 'hecha', burnt: 'quemada' })[quality('sausage', item.t)];
    case 'burger': return 'Hamburguesa' + (item.q === 'ok' ? '' : item.q === 'raw' ? ' (cruda)' : ' (quemada)');
    case 'hotdog': return 'Perrito' + (item.q === 'ok' ? '' : item.q === 'raw' ? ' (crudo)' : ' (quemado)');
    case 'fries': return 'Patatas' + (item.q === 'ok' ? '' : item.q === 'raw' ? ' (crudas)' : ' (quemadas)');
    default: return '';
  }
}

/** Qué entrada de la carta es el objeto (para comparar con el pedido). */
export function orderKey(item) {
  if (!item) return null;
  if (item.kind === 'cup') return item.fill || null;
  if (item.kind === 'burger' || item.kind === 'hotdog' || item.kind === 'fries') return item.kind;
  return null;
}

// ---------- Iconos para los bocadillos de pedido (dibujados a mano en canvas) ----------

export function drawIcon(g, key, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 100, s / 100);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (DRINKS.includes(key)) {
    const col = '#' + new THREE.Color(ITEMS[key].color).getHexString();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#2b2b2b';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-28, -32); g.lineTo(28, -32); g.lineTo(20, 42); g.lineTo(-20, 42); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(-25, -18); g.lineTo(25, -18); g.lineTo(19, 38); g.lineTo(-19, 38); g.closePath();
    g.fill();
    g.fillStyle = '#d8262b';
    g.fillRect(-24, 0, 47, 9);
    g.strokeStyle = '#d8262b';
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(6, -30); g.lineTo(16, -52); g.stroke();
  } else if (key === 'burger') {
    g.fillStyle = '#d9963f';
    g.beginPath(); g.ellipse(0, -8, 44, 30, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#5fb33a'; g.fillRect(-46, -8, 92, 9);
    g.fillStyle = '#ffc21a';
    g.beginPath(); g.moveTo(-44, 1); g.lineTo(44, 1); g.lineTo(30, 14); g.lineTo(-30, 14); g.fill();
    g.fillStyle = '#6b3a1e'; g.fillRect(-44, 8, 88, 16);
    g.fillStyle = '#c98a3c';
    g.beginPath(); g.roundRect(-42, 24, 84, 16, 7); g.fill();
    g.fillStyle = '#fff2cc';
    for (const [sx, sy] of [[-18, -24], [0, -30], [16, -22], [-6, -16], [26, -14]]) { g.beginPath(); g.ellipse(sx, sy, 4, 2.4, 0.4, 0, Math.PI * 2); g.fill(); }
  } else if (key === 'hotdog') {
    g.rotate(-0.25);
    g.fillStyle = '#d9963f';
    g.beginPath(); g.roundRect(-46, -2, 92, 26, 13); g.fill();
    g.fillStyle = '#a5401f';
    g.beginPath(); g.roundRect(-52, -14, 104, 18, 9); g.fill();
    g.strokeStyle = '#f2c41a'; g.lineWidth = 5;
    g.beginPath();
    for (let i = 0; i <= 10; i++) { const px = -40 + i * 8; const py = -6 + (i % 2 ? -5 : 5); i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
    g.fillStyle = '#c98a3c';
    g.beginPath(); g.roundRect(-46, 6, 92, 18, 9); g.fill();
  } else if (key === 'fries') {
    g.fillStyle = '#f0b43a';
    for (let i = 0; i < 7; i++) { g.save(); g.translate(-24 + i * 8, -14); g.rotate((i - 3) * 0.07); g.fillRect(-3.5, -30, 7, 40); g.restore(); }
    g.fillStyle = '#d8262b';
    g.beginPath(); g.moveTo(-34, -12); g.lineTo(34, -12); g.lineTo(26, 42); g.lineTo(-26, 42); g.closePath(); g.fill();
    g.fillStyle = '#ffd23f';
    g.beginPath(); g.arc(0, 14, 9, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
