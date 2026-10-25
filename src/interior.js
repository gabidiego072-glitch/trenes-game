// Utilidades compartidas por los modos dentro del tren (bar y azafato).

/**
 * Oculta todos los coches del tren (estamos dentro) y cuelga el interior del coche anfitrión.
 * Devuelve una función que lo deja todo como estaba.
 */
export function enterCar(train, hostIndex, root) {
  const hidden = [];
  for (const car of train.cars) {
    for (const ch of car.g.children) {
      if (ch.visible && !ch.isLight) {
        hidden.push(ch);
        ch.visible = false;
      }
    }
  }
  const host = train.cars[hostIndex].g;
  host.add(root);
  return () => {
    host.remove(root);
    for (const ch of hidden) ch.visible = true;
  };
}

/** Etiqueta de texto flotante (sprite) para señalar puestos y objetos. */
export function makeLabel(THREE, text, scale = 0.05) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = "700 40px 'Inter', Arial, sans-serif";
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w;
  c.height = 60;
  g.font = "700 40px 'Inter', Arial, sans-serif";
  g.fillStyle = 'rgba(20, 14, 10, 0.72)';
  g.beginPath();
  g.roundRect(2, 2, w - 4, 56, 28);
  g.fill();
  g.fillStyle = '#fff4e2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false, fog: false }));
  s.scale.set((scale * w) / 60, scale, 1);
  s.renderOrder = 7;
  return s;
}
