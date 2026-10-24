import * as THREE from 'three';

/** Sistema de partículas simple en GPU (puntos con tamaño en metros). */
export class Particles {
  constructor(scene, max, { additive = false, soft = false, gravity = 0, drag = 0 } = {}) {
    this.max = max;
    this.n = 0;
    this.gravity = gravity;
    this.drag = drag;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    this.uniforms = { uScale: { value: 500 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
          vColor = aColor;
          // se desvanece al acercarse a la cámara para no tapar la vista
          vAlpha = aAlpha * smoothstep(2.5, 11.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = ${soft ? 'smoothstep(1.0, 0.0, d) * smoothstep(1.0, 0.5, d)' : 'smoothstep(1.0, 0.0, d)'};
          ${soft ? '' : 'a = a * a;'}
          if (a * vAlpha < 0.003) discard;
          gl_FragColor = vec4(vColor, a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, color, a0 = 1) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.size[i] = s0; this.alpha[i] = a0;
  }

  update(dt) {
    const g = this.gravity * dt;
    const dr = Math.exp(-this.drag * dt);
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // quitar intercambiando con el último
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[j * 3 + k];
            this.vel[i * 3 + k] = this.vel[j * 3 + k];
            this.col[i * 3 + k] = this.col[j * 3 + k];
          }
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
          this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.a0[i] = this.a0[j];
        }
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr + g;
      this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 8 + 0.2);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
  }

  clear() {
    this.n = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  setScale(px) {
    this.uniforms.uScale.value = px;
  }
}

const CYAN = new THREE.Color(0x5ef2ff);
const RED = new THREE.Color(0xff3b30);

/**
 * El "constructor": un dron que flota sobre la punta de la vía y la va soldando.
 * También dibuja una vista previa punteada del recorrido que seguirá la vía.
 */
export class Builder {
  constructor(scene) {
    this.group = new THREE.Group();
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x001018, emissive: CYAN, emissiveIntensity: 5 });
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0x223040, metalness: 0.8, roughness: 0.3, emissive: CYAN, emissiveIntensity: 0.6 });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), this.coreMat);
    this.ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.08, 8, 40), this.ringMat);
    this.ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.06, 8, 40), this.ringMat);
    this.group.add(core, this.ring1, this.ring2);
    this.light = new THREE.PointLight(CYAN, 40, 28, 1.6);
    this.group.add(this.light);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const beamGeo = new THREE.CylinderGeometry(0.07, 0.2, 1, 8, 1, true);
    beamGeo.translate(0, -0.5, 0);
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.group.add(this.beam);
    scene.add(this.group);

    // vista previa punteada
    this.previewN = 28;
    const geo = new THREE.BufferGeometry();
    this.prevPos = new Float32Array(this.previewN * 3);
    this.prevAlpha = new Float32Array(this.previewN);
    geo.setAttribute('position', new THREE.BufferAttribute(this.prevPos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.prevAlpha, 1));
    this.prevUniforms = { uColor: { value: CYAN.clone() }, uScale: { value: 500 } };
    this.preview = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.prevUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float aAlpha; uniform float uScale; varying float vA;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 0.55 * uScale / max(-mv.z, 0.1);
            gl_Position = projectionMatrix * mv; vA = aAlpha;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float a = smoothstep(1.0, 0.2, d);
            gl_FragColor = vec4(uColor * 1.6, a * vA);
          }`,
      })
    );
    this.preview.frustumCulled = false;
    this.preview.renderOrder = 4;
    scene.add(this.preview);
    this.danger = false;
  }

  setDanger(d) {
    if (d === this.danger) return;
    this.danger = d;
    const c = d ? RED : CYAN;
    this.coreMat.emissive.copy(c);
    this.ringMat.emissive.copy(c);
    this.light.color.copy(c);
    this.beamMat.color.copy(c);
    this.prevUniforms.uColor.value.copy(c);
  }

  update(time, head, track, world, sparks, active) {
    const hover = 3.2 + Math.sin(time * 3) * 0.25;
    this.group.position.set(head.x, head.y + hover, head.z);
    this.group.rotation.y = head.h;
    this.ring1.rotation.set(Math.PI / 2 + Math.sin(time * 2) * 0.3, time * 3, 0);
    this.ring2.rotation.set(Math.PI / 2, 0, -time * 2);
    this.beam.scale.set(1, hover, 1);
    this.beam.visible = active;
    this.group.visible = active || this.danger;

    // vista previa: hacia dónde irá la vía si mantienes la dirección actual
    const kTarget = track.k + (-track.steer * (1 / 13) - track.k) * 0.8;
    let i = 0;
    let prevY = head.y;
    track.predict(kTarget, this.previewN * 1.8, 1.8, (x, z, d) => {
      const hh = world.heightAt(x, z, 1.5, false) + 0.6;
      prevY = Math.max(hh, prevY - 0.6);
      this.prevPos[i * 3] = x;
      this.prevPos[i * 3 + 1] = prevY;
      this.prevPos[i * 3 + 2] = z;
      this.prevAlpha[i] = active ? (1 - i / this.previewN) * 0.9 : 0;
      i++;
      return i < this.previewN;
    });
    this.preview.geometry.attributes.position.needsUpdate = true;
    this.preview.geometry.attributes.aAlpha.needsUpdate = true;

    if (active && sparks && Math.random() < 0.7) {
      const c = this.danger ? RED : CYAN;
      for (let k = 0; k < 2; k++) {
        sparks.spawn(
          head.x, head.y + 0.1, head.z,
          (Math.random() - 0.5) * 6, Math.random() * 5 + 1, (Math.random() - 0.5) * 6,
          0.35 + Math.random() * 0.3, 0.22, 0.05, c, 1
        );
      }
    }
  }
}
