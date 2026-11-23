import * as THREE from 'three';

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }
  return [canvas, ctx];
}

// Warm desert sky gradient from soft sunny blue to golden desert horizon
export function createSkyTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(32, 512);
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#7CB8D6');
  grad.addColorStop(0.32, '#B6DDE8');
  grad.addColorStop(0.62, '#E5DBBE');
  grad.addColorStop(0.84, '#E8D2A6');
  grad.addColorStop(1.0, '#DFC491');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// 1024px seamless warm desert sand texture with speckles, wind ripples, and subtle patches
export function createSandTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const [canvas, ctx] = createCanvas(size, size);

  ctx.fillStyle = '#E7C77E';
  ctx.fillRect(0, 0, size, size);

  // Soft tonal desert patches (tileable across edges)
  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 42; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 65 + rand() * 140;
    const darker = rand() > 0.45;
    const color = darker ? 'rgba(182, 144, 78, 0.14)' : 'rgba(255, 241, 200, 0.16)';

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const px = cx + ox * size;
        const py = cy + oy * size;
        if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
        const grad = ctx.createRadialGradient(px, py, r * 0.1, px, py, r);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(231, 199, 126, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Subtle wind-swept sand ripple strokes
  ctx.lineWidth = 2.2;
  for (let y = 0; y < size; y += 16) {
    ctx.beginPath();
    for (let x = 0; x <= size; x += 16) {
      const wave =
        Math.sin((x / size) * Math.PI * 4 + y * 0.03) * 4 +
        Math.cos((x / size) * Math.PI * 8 - y * 0.02) * 2;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.strokeStyle =
      y % 32 === 0 ? 'rgba(176, 138, 72, 0.12)' : 'rgba(255, 244, 212, 0.14)';
    ctx.stroke();
  }

  // Fine mineral grain speckles
  for (let i = 0; i < 6500; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const s = 1 + rand() * 1.8;
    const bright = rand() > 0.55;
    ctx.fillStyle = bright
      ? 'rgba(255, 246, 218, 0.28)'
      : 'rgba(155, 118, 60, 0.22)';
    ctx.fillRect(x, y, s, s);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// Linear-space bump map for subtle desert ripple shading under directional sunlight
export function createSandBumpTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 10) {
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const wave = Math.sin((x / size) * Math.PI * 4 + y * 0.05) * 3;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(215, 215, 215, 0.26)';
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(11, 11);
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// Tileable shimmering water wave texture (scrolled continuously in render loop)
export function createWaterWaveTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  ctx.fillStyle = '#2E86AB';
  ctx.fillRect(0, 0, size, size);

  let seed = 9187;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Gentle depth modulation
  for (let i = 0; i < 28; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 40 + rand() * 80;
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
    grad.addColorStop(0, 'rgba(63, 172, 198, 0.32)');
    grad.addColorStop(1, 'rgba(46, 134, 171, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Soft white-aqua ripple highlights
  ctx.lineWidth = 2;
  for (let y = 0; y < size; y += 22) {
    ctx.beginPath();
    for (let x = 0; x <= size; x += 12) {
      const wy = y + Math.sin((x / size) * Math.PI * 6 + y * 0.08) * 5;
      if (x === 0) ctx.moveTo(x, wy);
      else ctx.lineTo(x, wy);
    }
    ctx.strokeStyle = 'rgba(218, 246, 255, 0.24)';
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.08, 0.08);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// Shop striped terracotta/parchment awning texture
export function createAwningTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size, size);
  const stripes = 8;
  const stripeW = size / stripes;

  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#C96F4A' : '#F3E2C7';
    ctx.fillRect(i * stripeW, 0, stripeW, size);
  }

  // Subtle fabric hem shadow at bottom edge
  const grad = ctx.createLinearGradient(0, size * 0.78, 0, size);
  grad.addColorStop(0, 'rgba(43, 33, 24, 0)');
  grad.addColorStop(1, 'rgba(43, 33, 24, 0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, size * 0.78, size, size * 0.22);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// Soft radial circle texture for dust puffs and water sparkles
export function createSoftCircleTexture(): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = createCanvas(size, size);
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255, 250, 236, 1)');
  grad.addColorStop(0.45, 'rgba(245, 228, 188, 0.65)');
  grad.addColorStop(1, 'rgba(245, 228, 188, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Canvas-drawn floating amber "!" badge for unstaffed buildings (zero emoji)
export function createUnstaffedBadgeTexture(): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = createCanvas(size, size);

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.fillStyle = '#E8A33D';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#2B2118';
  ctx.stroke();

  // Exclamation bar
  ctx.fillStyle = '#2B2118';
  ctx.beginPath();
  ctx.roundRect(57, 34, 14, 38, 6);
  ctx.fill();

  // Exclamation dot
  ctx.beginPath();
  ctx.arc(64, 88, 7.5, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Soft organic feathered footprint decal (never a crisp square grid box)
export function createFootprintDecalTexture(): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size, size);
  ctx.clearRect(0, 0, size, size);

  const grad = ctx.createRadialGradient(128, 128, 24, 128, 128, 118);
  grad.addColorStop(0, 'rgba(255, 248, 222, 0.85)');
  grad.addColorStop(0.62, 'rgba(255, 232, 168, 0.45)');
  grad.addColorStop(0.86, 'rgba(255, 220, 128, 0.16)');
  grad.addColorStop(1, 'rgba(255, 220, 128, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
