import * as THREE from 'three';

// Paletas
const SKINS = [0xf6d3bd, 0xeec1a0, 0xd9a47e, 0xb97c55, 0x8d5a3b, 0x5e3b27];
const HAIRS = [0x1b1411, 0x2e1f16, 0x4a2f1c, 0x6e4a2a, 0xb0844a, 0xd8b26b, 0x8c3a1e, 0x9a9a9a, 0xd9d9d9];
const IRIS = [0x3b2414, 0x5a3a1e, 0x2f5f8a, 0x3f7a4a, 0x6b6b3a];
const SHIRTS = [0xc8423a, 0x2f6fb2, 0x2f8a5f, 0xe2b13c, 0x7a4fb0, 0xeeeeee, 0x2d2d33, 0xe27fa6, 0x3fa7b5, 0xd8742c];
const PANTS = [0x2b3240, 0x3a3a3a, 0x4b3a2a, 0x1f2a44, 0x6b5a45];
const SHOES = [0x1a1a1a, 0x3b2a1e, 0xf2f2f2, 0x7a2e2e];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rr = (a, b) => a + (b - a) * Math.random();

function skinMat(color) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.6, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffd6c8), clearcoat: 0.04,
  });
}
function clothMat(color) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.85, sheen: 0.7, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff) });
}
function hairMat(color) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(color).offsetHSL(0, 0, 0.25) });
}

function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Geometrías compartidas
const G = {
  // cabeza con forma de huevo: se estrecha hacia la mandíbula y la barbilla sale un poco
  head: (() => {
    const g = new THREE.SphereGeometry(0.11, 48, 36);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < 0) {
        const k = 1 - 0.22 * Math.pow(-y / 0.11, 1.5);
        x *= k;
        z *= k;
        if (y < -0.03 && z > 0) z += 0.012 * Math.min(1, (-y - 0.03) / 0.08);
      }
      // nuca algo más plana
      if (z < -0.06) z = -0.06 + (z + 0.06) * 0.85;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  })(),
  lash: new THREE.TorusGeometry(0.0172, 0.0016, 6, 20, Math.PI * 0.85),
  ear: new THREE.SphereGeometry(0.026, 16, 12),
  nose: new THREE.SphereGeometry(0.02, 16, 12),
  sclera: new THREE.SphereGeometry(0.0165, 20, 14),
  iris: new THREE.SphereGeometry(0.0105, 16, 12),
  pupil: new THREE.SphereGeometry(0.0058, 12, 8),
  shine: new THREE.SphereGeometry(0.0026, 8, 6),
  brow: new THREE.CapsuleGeometry(0.0045, 0.03, 4, 8),
  smile: new THREE.TorusGeometry(0.024, 0.0042, 8, 24, Math.PI * 0.75),
  flat: new THREE.CapsuleGeometry(0.004, 0.032, 4, 8),
  ooh: new THREE.TorusGeometry(0.009, 0.004, 8, 20),
  neck: new THREE.CylinderGeometry(0.042, 0.048, 0.1, 20),
  upper: new THREE.CapsuleGeometry(0.05, 0.2, 6, 14),
  fore: new THREE.CapsuleGeometry(0.04, 0.18, 6, 14),
  hand: new THREE.SphereGeometry(0.042, 18, 14),
  thumb: new THREE.CapsuleGeometry(0.012, 0.03, 4, 8),
  thigh: new THREE.CapsuleGeometry(0.078, 0.28, 6, 14),
  shin: new THREE.CapsuleGeometry(0.06, 0.3, 6, 14),
  shoe: new THREE.BoxGeometry(0.1, 0.07, 0.24, 2, 2, 2),
  hips: new THREE.SphereGeometry(0.16, 28, 18),
  frame: new THREE.TorusGeometry(0.021, 0.0017, 8, 28),
};
// torso con hombros redondeados (perfil de torno)
const TORSO = (() => {
  const pts = [
    [0.135, 0.0], [0.15, 0.08], [0.165, 0.2], [0.178, 0.32], [0.185, 0.42], [0.17, 0.49], [0.12, 0.54], [0.05, 0.565], [0.0, 0.57],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 36);
  g.scale(1, 1, 0.62);
  return g;
})();

/**
 * Un cliente: muñeco articulado con proporciones realistas.
 * Raíz en el suelo; mira hacia +z local.
 */
export class Customer {
  constructor() {
    this.root = new THREE.Group();
    const skin = skinMat(pick(SKINS));
    this.skin = skin;
    const hairCol = pick(HAIRS);
    const hair = hairMat(hairCol);
    const shirtCol = pick(SHIRTS);
    const style = pick(['tee', 'tee', 'shirt', 'hoodie', 'suit']);
    const shirt = clothMat(style === 'suit' ? pick([0x23262e, 0x2f3440, 0x3a2f2a]) : shirtCol);
    const pants = clothMat(pick(PANTS));
    const shoe = new THREE.MeshStandardMaterial({ color: pick(SHOES), roughness: 0.45 });
    const width = rr(0.92, 1.12);
    this.height = rr(0.95, 1.05);
    this.root.scale.setScalar(this.height);

    // caderas y torso
    this.hips = new THREE.Group();
    this.root.add(this.hips);
    mesh(G.hips, pants, this.hips).scale.set(0.95 * width, 0.55, 0.68);
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const body = mesh(TORSO, shirt, this.torso);
    body.scale.x = width;
    this.chest = body;

    if (style === 'suit') {
      const white = clothMat(0xf4f4f4);
      const v = mesh(new THREE.CircleGeometry(0.06, 3), white, this.torso, 0, 0.44, 0.118);
      v.rotation.z = -Math.PI / 2;
      v.scale.set(1.25, 0.9, 1);
      const tie = mesh(new THREE.BoxGeometry(0.026, 0.2, 0.006), clothMat(pick([0xb3262b, 0x1f3f8a, 0x2f6a3a])), this.torso, 0, 0.36, 0.121);
      tie.rotation.x = -0.18;
    } else if (style === 'shirt') {
      const collar = mesh(new THREE.TorusGeometry(0.055, 0.012, 8, 24), clothMat(new THREE.Color(shirtCol).offsetHSL(0, 0, 0.15)), this.torso, 0, 0.555, 0.0);
      collar.rotation.x = Math.PI / 2;
      collar.scale.set(1, 0.8, 1);
      for (let i = 0; i < 3; i++) mesh(new THREE.SphereGeometry(0.006, 8, 6), clothMat(0xf0f0f0), this.torso, 0, 0.48 - i * 0.09, 0.118 - i * 0.005);
    } else if (style === 'hoodie') {
      const hood = mesh(new THREE.TorusGeometry(0.075, 0.03, 10, 28), shirt, this.torso, 0, 0.555, -0.025);
      hood.rotation.x = Math.PI / 2 + 0.25;
      for (const sx of [-0.03, 0.03]) mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 6), clothMat(0xf0f0f0), this.torso, sx, 0.47, 0.118);
      const pocket = mesh(new THREE.BoxGeometry(0.16, 0.07, 0.01), shirt, this.torso, 0, 0.14, 0.1);
      pocket.rotation.x = -0.1;
    } else {
      const neckline = mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 24), clothMat(new THREE.Color(shirtCol).offsetHSL(0, 0, -0.12)), this.torso, 0, 0.555, 0.005);
      neckline.rotation.x = Math.PI / 2;
      neckline.scale.set(1, 0.75, 1);
    }

    // cuello y cabeza
    mesh(G.neck, skin, this.torso, 0, 0.6, 0);
    this.neckPivot = new THREE.Group();
    this.neckPivot.position.set(0, 0.64, 0);
    this.torso.add(this.neckPivot);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.085, 0.008);
    this.neckPivot.add(this.head);
    this.buildFace(skin, hair, hairCol);

    // brazos
    const longSleeve = style !== 'tee';
    this.arms = [-1, 1].map((s) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.175 * width, 0.47, 0);
      this.torso.add(shoulder);
      mesh(G.upper, shirt, shoulder, 0, -0.13, 0);
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.26, 0);
      shoulder.add(elbow);
      mesh(G.fore, longSleeve ? shirt : skin, elbow, 0, -0.11, 0);
      if (longSleeve) mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 14), skin, elbow, 0, -0.215, 0);
      const hand = new THREE.Group();
      hand.position.set(0, -0.25, 0);
      elbow.add(hand);
      mesh(G.hand, skin, hand, 0, -0.02, 0).scale.set(0.75, 1.15, 0.5);
      const th = mesh(G.thumb, skin, hand, s * -0.028, -0.005, 0.015);
      th.rotation.z = s * 0.6;
      return { shoulder, elbow, hand, side: s };
    });

    // piernas
    this.legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.085 * width, -0.02, 0);
      this.hips.add(hip);
      mesh(G.thigh, pants, hip, 0, -0.2, 0);
      const knee = new THREE.Group();
      knee.position.set(0, -0.42, 0);
      hip.add(knee);
      mesh(G.shin, pants, knee, 0, -0.19, 0);
      const foot = mesh(G.shoe, shoe, knee, 0, -0.41, 0.05);
      foot.scale.set(1, 1, 1);
      return { hip, knee };
    });

    this.mood = 'neutral';
    this.setMood('neutral');
    this.blinkT = rr(1, 4);
    this.phase = Math.random() * 10;
    this.look = new THREE.Vector2();
    this.seated = 0; // 0 de pie … 1 sentado
    this.walk = 0;
  }

  buildFace(skin, hair, hairCol) {
    const h = this.head;
    mesh(G.head, skin, h).scale.set(0.9, 1.08, 1.0);
    for (const s of [-1, 1]) mesh(G.ear, skin, h, s * 0.098, 0.0, -0.005).scale.set(0.45, 1, 0.8);
    const nose = mesh(G.nose, skin, h, 0, -0.01, 0.103);
    nose.scale.set(0.55, 0.85, 0.8);
    const bridge = mesh(new THREE.CapsuleGeometry(0.0075, 0.03, 4, 10), skin, h, 0, 0.008, 0.1);
    bridge.rotation.x = -0.25;
    // ojos
    const iris = new THREE.MeshPhysicalMaterial({ color: pick(IRIS), roughness: 0.2, clearcoat: 1 });
    const white = new THREE.MeshPhysicalMaterial({ color: 0xfbfbf8, roughness: 0.15, clearcoat: 1 });
    const black = new THREE.MeshBasicMaterial({ color: 0x050505 });
    const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.eyes = [-1, 1].map((s) => {
      const e = new THREE.Group();
      e.position.set(s * 0.036, 0.016, 0.086);
      h.add(e);
      mesh(G.sclera, white, e);
      const look = new THREE.Group();
      e.add(look);
      mesh(G.iris, iris, look, 0, 0, 0.0095);
      mesh(G.pupil, black, look, 0, 0, 0.015);
      mesh(G.shine, shine, look, 0.004, 0.004, 0.0185);
      const lash = mesh(G.lash, black, e, 0, 0.001, 0.004);
      lash.rotation.set(-0.35, 0, Math.PI * 0.075);
      // párpado superior (piel) que baja al parpadear
      const lid = mesh(new THREE.SphereGeometry(0.0178, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), skin, e);
      lid.rotation.x = -1.35;
      return { e, look, lid };
    });
    // cejas
    const browMat = hairMat(new THREE.Color(hairCol).offsetHSL(0, 0, -0.08));
    this.brows = [-1, 1].map((s) => {
      const b = mesh(G.brow, browMat, h, s * 0.037, 0.046, 0.097);
      b.rotation.z = Math.PI / 2;
      b.userData.s = s;
      return b;
    });
    // boca
    const lips = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0xb05a5a), roughness: 0.4, clearcoat: 0.3 });
    this.mouthSmile = mesh(G.smile, lips, h, 0, -0.036, 0.1);
    this.mouthSmile.rotation.z = Math.PI + Math.PI * 0.125;
    this.mouthFrown = mesh(G.smile, lips, h, 0, -0.058, 0.095);
    this.mouthFrown.rotation.z = Math.PI * 0.125;
    this.mouthFlat = mesh(G.flat, lips, h, 0, -0.045, 0.0995);
    this.mouthFlat.rotation.z = Math.PI / 2;
    this.mouthOoh = mesh(G.ooh, lips, h, 0, -0.048, 0.098);
    // mejillas
    const blush = new THREE.MeshBasicMaterial({ color: 0xff7a7a, transparent: true, opacity: 0.18, depthWrite: false });
    for (const s of [-1, 1]) mesh(new THREE.CircleGeometry(0.016, 16), blush, h, s * 0.055, -0.02, 0.0895).rotation.y = s * 0.45;

    // pelo
    const style = pick(['short', 'short', 'long', 'bun', 'curly', 'bald', 'cap', 'side']);
    const cap = (theta = 0.42) => {
      const m = mesh(new THREE.SphereGeometry(0.117, 36, 20, 0, Math.PI * 2, 0, Math.PI * theta), hair, h, 0, 0.01, -0.006);
      m.scale.set(0.93, 1.06, 1.02);
      m.rotation.x = -0.22; // línea del pelo más alta delante y más baja detrás
      return m;
    };
    const back = (len = 0.62) => {
      const m = mesh(new THREE.SphereGeometry(0.116, 36, 20, Math.PI * 1.12, Math.PI * 0.76, 0.2, Math.PI * len), hair, h, 0, 0.005, -0.005);
      m.scale.set(0.94, 1.08, 1.03);
      return m;
    };
    if (style === 'short' || style === 'side') {
      cap(style === 'side' ? 0.38 : 0.36);
      back(0.5);
      if (style === 'side') {
        const fringe = mesh(new THREE.CapsuleGeometry(0.02, 0.08, 6, 10), hair, h, -0.02, 0.085, 0.07);
        fringe.rotation.set(0.3, 0, 1.2);
      }
    } else if (style === 'long') {
      cap(0.4);
      back(0.62);
      const tail = mesh(new THREE.CapsuleGeometry(0.075, 0.16, 8, 16), hair, h, 0, -0.1, -0.06);
      tail.scale.set(1.15, 1, 0.55);
      for (const s of [-1, 1]) {
        const lock = mesh(new THREE.CapsuleGeometry(0.022, 0.13, 6, 10), hair, h, s * 0.09, -0.06, 0.02);
        lock.rotation.z = s * 0.08;
      }
    } else if (style === 'bun') {
      cap(0.4);
      back(0.5);
      mesh(new THREE.SphereGeometry(0.045, 20, 14), hair, h, 0, 0.1, -0.075);
    } else if (style === 'curly') {
      const g = new THREE.IcosahedronGeometry(0.13, 3);
      const p = g.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = 1 + 0.07 * Math.sin(v.x * 140) * Math.sin(v.y * 150) * Math.sin(v.z * 130);
        v.multiplyScalar(n);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      const m = mesh(g, hair, h, 0, 0.04, -0.035);
      m.scale.set(0.95, 0.85, 0.9);
    } else if (style === 'cap') {
      back(0.45);
      const c = new THREE.MeshStandardMaterial({ color: pick(SHIRTS), roughness: 0.7 });
      const dome = mesh(new THREE.SphereGeometry(0.119, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), c, h, 0, 0.012, -0.004);
      dome.scale.set(0.95, 1.0, 1.04);
      const brim = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), c, h, 0, 0.058, 0.07);
      brim.rotation.x = 0.12;
      brim.scale.set(1.05, 1, 1.2);
    }
    // barba / bigote / gafas
    if (style !== 'long' && style !== 'bun' && Math.random() < 0.3) {
      if (Math.random() < 0.5) {
        const beard = mesh(new THREE.SphereGeometry(0.088, 28, 16, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.45), hair, h, 0, -0.03, 0.02);
        beard.scale.set(0.95, 1.05, 1.02);
        this.mouthSmile.position.z += 0.012;
        this.mouthFrown.position.z += 0.012;
        this.mouthFlat.position.z += 0.012;
        this.mouthOoh.position.z += 0.012;
      } else {
        const m = mesh(new THREE.CapsuleGeometry(0.008, 0.04, 4, 8), hair, h, 0, -0.026, 0.103);
        m.rotation.z = Math.PI / 2;
      }
    }
    if (Math.random() < 0.28) {
      const fm = new THREE.MeshStandardMaterial({ color: pick([0x111111, 0x5a3a1e, 0x8a8a8a]), roughness: 0.3, metalness: 0.4 });
      for (const s of [-1, 1]) mesh(G.frame, fm, h, s * 0.036, 0.016, 0.104);
      const bridge = mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.03, 6), fm, h, 0, 0.02, 0.106);
      bridge.rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) {
        const arm = mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.1, 6), fm, h, s * 0.058, 0.018, 0.055);
        arm.rotation.x = Math.PI / 2;
      }
    }
  }

  setMood(m) {
    this.mood = m;
    this.mouthSmile.visible = m === 'happy';
    this.mouthFrown.visible = m === 'angry';
    this.mouthOoh.visible = m === 'disgust';
    this.mouthFlat.visible = m === 'neutral' || m === 'impatient';
    for (const b of this.brows) {
      const s = b.userData.s;
      const tilt = m === 'angry' ? -0.45 : m === 'happy' ? 0.15 : m === 'disgust' ? 0.35 : m === 'impatient' ? -0.2 : 0;
      b.rotation.z = Math.PI / 2 + s * tilt;
      b.position.y = 0.046 + (m === 'happy' || m === 'disgust' ? 0.006 : m === 'angry' ? -0.004 : 0);
    }
    this.skin.emissive.set(m === 'angry' ? 0x3a0800 : 0x000000);
  }

  /** Postura de sentado con los antebrazos sobre la barra (seated 0..1). */
  pose(t, dt, lookAt) {
    const s = this.seated;
    const hipsY = 0.92 - 0.18 * s;
    this.hips.position.y = hipsY + (this.walk ? Math.abs(Math.sin(this.walkPhase * 2)) * 0.025 : 0);
    // respiración y balanceo
    const br = Math.sin(t * 2 + this.phase) * 0.012;
    this.chest.scale.y = 1 + br;
    this.torso.rotation.x = s * 0.22 + (this.mood === 'happy' ? Math.sin(t * 9) * 0.03 * s : 0);

    for (const leg of this.legs) {
      const swing = this.walk ? Math.sin(this.walkPhase + (leg === this.legs[0] ? 0 : Math.PI)) * 0.55 : 0;
      leg.hip.rotation.x = -1.5 * s + swing;
      leg.knee.rotation.x = 1.45 * s + (this.walk ? Math.max(0, -swing) * 0.9 : 0);
    }
    for (const arm of this.arms) {
      const swing = this.walk ? Math.sin(this.walkPhase + (arm.side < 0 ? Math.PI : 0)) * 0.45 : 0;
      let sh = -1.05 * s + swing * (1 - s);
      let el = -0.55 * s;
      let shz = arm.side * (0.08 + 0.04 * s);
      // comer / beber: lleva la mano derecha a la boca de vez en cuando
      if (s > 0.9 && this.eating && arm.side > 0) {
        const k = Math.max(0, Math.sin(t * 1.8 + this.phase));
        sh = -1.05 - k * 1.25;
        el = -0.55 - k * 1.55;
        shz = arm.side * 0.12 - k * 0.35;
        arm.shoulder.rotation.set(sh, 0, shz);
        arm.elbow.rotation.x = el;
        continue;
      }
      // gestos según el humor
      if (s > 0.9) {
        if (this.mood === 'happy' && arm.side > 0) {
          sh = -2.5 + Math.sin(t * 10) * 0.15;
          el = -0.6;
          shz = 0.3 + Math.sin(t * 10) * 0.25;
        } else if (this.mood === 'impatient' && arm.side > 0) {
          el += Math.sin(t * 14) * 0.08;
        } else if (this.mood === 'angry') {
          sh = -1.35;
          el = -1.5;
          shz = -arm.side * 0.55;
        }
      }
      arm.shoulder.rotation.set(sh, 0, shz);
      arm.elbow.rotation.x = el;
    }

    // la cabeza sigue a la cámara con suavidad
    if (lookAt) {
      const local = this.neckPivot.worldToLocal(lookAt.clone());
      const yaw = Math.atan2(local.x, local.z);
      const pitch = Math.atan2(-local.y, Math.hypot(local.x, local.z));
      this.look.x += (THREE.MathUtils.clamp(yaw, -0.9, 0.9) - this.look.x) * Math.min(1, dt * 4);
      this.look.y += (THREE.MathUtils.clamp(pitch, -0.5, 0.5) - this.look.y) * Math.min(1, dt * 4);
    }
    const idle = Math.sin(t * 0.7 + this.phase) * 0.08;
    this.neckPivot.rotation.set(this.look.y * 0.7 - this.torso.rotation.x * 0.8, this.look.x * 0.75 + idle, this.mood === 'disgust' ? 0.15 : 0);
    for (const e of this.eyes) e.look.rotation.set(this.look.y * 0.4, this.look.x * 0.35, 0);

    // parpadeo
    this.blinkT -= dt;
    let lid = 0;
    if (this.blinkT < 0) {
      lid = 1 - Math.abs(this.blinkT / 0.07 + 1);
      if (this.blinkT < -0.14) this.blinkT = rr(1.8, 5);
    }
    const base = this.mood === 'angry' ? 0.35 : this.mood === 'impatient' ? 0.2 : 0;
    for (const e of this.eyes) e.lid.rotation.x = -1.35 + Math.max(lid, base) * 1.65;
  }
}
