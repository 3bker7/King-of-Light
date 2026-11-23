import * as THREE from 'three';

function createCanvas(
  width: number,
  height: number
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }
  return [canvas, ctx];
}

function makeSeededRandom(seedInit: number): () => number {
  let seed = seedInit;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// Warm desert sky gradient (soft blue zenith to sun-baked desert horizon)
export function createSkyTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(32, 512);
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#78B0CE');
  grad.addColorStop(0.35, '#B2D5E0');
  grad.addColorStop(0.66, '#E2D4B4');
  grad.addColorStop(0.86, '#E4CFA6');
  grad.addColorStop(1.0, '#D7BC8A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Earthy sun-baked desert sand (#DCC084 base) with wind ripples and mineral speckles
export function createSandTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(4219);

  ctx.fillStyle = '#DCC084';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 48; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 60 + rand() * 145;
    const darker = rand() > 0.42;
    const color = darker ? 'rgba(164, 130, 74, 0.16)' : 'rgba(244, 224, 178, 0.15)';

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const px = cx + ox * size;
        const py = cy + oy * size;
        if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
        const grad = ctx.createRadialGradient(px, py, r * 0.1, px, py, r);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(220, 192, 132, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.lineWidth = 2.4;
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
      y % 32 === 0 ? 'rgba(156, 122, 68, 0.14)' : 'rgba(248, 232, 192, 0.13)';
    ctx.stroke();
  }

  for (let i = 0; i < 7500; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const s = 1 + rand() * 1.8;
    ctx.fillStyle =
      rand() > 0.52 ? 'rgba(246, 230, 194, 0.25)' : 'rgba(134, 102, 54, 0.22)';
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
    ctx.strokeStyle = 'rgba(218, 218, 218, 0.28)';
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

// WP1: 512px Warm Off-White Plaster Wall (subtle stains, trowel texture, hairline cracks)
export function createPlasterTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(1103);

  ctx.fillStyle = '#E6D6BC';
  ctx.fillRect(0, 0, size, size);

  // Subtle weathered plaster patches & water stains
  for (let i = 0; i < 65; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 24 + rand() * 75;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, r);
    const warm = rand() > 0.45;
    grad.addColorStop(0, warm ? 'rgba(176, 148, 112, 0.14)' : 'rgba(252, 244, 228, 0.16)');
    grad.addColorStop(1, 'rgba(230, 214, 188, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Base dirt gradient near bottom of walls
  const dirtGrad = ctx.createLinearGradient(0, size * 0.72, 0, size);
  dirtGrad.addColorStop(0, 'rgba(138, 110, 74, 0)');
  dirtGrad.addColorStop(1, 'rgba(138, 110, 74, 0.28)');
  ctx.fillStyle = dirtGrad;
  ctx.fillRect(0, size * 0.72, size, size * 0.28);

  // Fine sand-plaster grain
  for (let i = 0; i < 3200; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,250,240,0.16)' : 'rgba(120,96,68,0.14)';
    ctx.fillRect(rand() * size, rand() * size, 1.5, 1.5);
  }

  // Subtle hairline cracks
  ctx.strokeStyle = 'rgba(116, 94, 68, 0.34)';
  ctx.lineWidth = 1.2;
  for (let c = 0; c < 12; c++) {
    let x = rand() * size;
    let y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (rand() - 0.5) * 28;
      y += rand() * 24;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// WP1: 512px Weathered Wood Planks (doors, fences, stalls, frames)
export function createWoodPlanksTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(2311);

  ctx.fillStyle = '#7C5738';
  ctx.fillRect(0, 0, size, size);

  const plankCount = 8;
  const plankH = size / plankCount;

  for (let p = 0; p < plankCount; p++) {
    const y0 = p * plankH;
    const toneShift = Math.floor((rand() - 0.5) * 22);
    ctx.fillStyle = `rgb(${120 + toneShift}, ${84 + Math.floor(toneShift * 0.7)}, ${52 + Math.floor(toneShift * 0.5)})`;
    ctx.fillRect(0, y0, size, plankH - 2);

    // Wood grain streaks
    for (let g = 0; g < 18; g++) {
      const gy = y0 + rand() * (plankH - 4);
      ctx.strokeStyle = rand() > 0.5 ? 'rgba(54, 34, 18, 0.24)' : 'rgba(176, 134, 92, 0.16)';
      ctx.lineWidth = 1 + rand() * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(
        size * 0.33,
        gy + (rand() - 0.5) * 5,
        size * 0.66,
        gy + (rand() - 0.5) * 5,
        size,
        gy
      );
      ctx.stroke();
    }

    // Plank seam
    ctx.fillStyle = 'rgba(42, 26, 14, 0.65)';
    ctx.fillRect(0, y0 + plankH - 2, size, 2);

    // Vertical end joint + iron nail dots
    const jointX = (p * 137 + 90) % size;
    ctx.fillRect(jointX, y0, 2, plankH);
    ctx.fillStyle = 'rgba(38, 28, 20, 0.7)';
    ctx.beginPath();
    ctx.arc(jointX + 10, y0 + 12, 2.5, 0, Math.PI * 2);
    ctx.arc(jointX + 10, y0 + plankH - 12, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// WP1: 512px Stone Blocks (wells, palace base, quarry, mosque base, mines)
export function createStoneBlocksTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(3457);

  ctx.fillStyle = '#7E7970';
  ctx.fillRect(0, 0, size, size);

  const rows = 8;
  const cols = 4;
  const rowH = size / rows;
  const colW = size / cols;

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const bx = c * colW + offset;
      const by = r * rowH;
      const shade = Math.floor((rand() - 0.5) * 28);
      ctx.fillStyle = `rgb(${152 + shade}, ${146 + shade}, ${134 + shade})`;
      ctx.fillRect(bx + 3, by + 3, colW - 6, rowH - 6);

      // Subtle bevel top highlight
      ctx.fillStyle = 'rgba(255, 248, 232, 0.16)';
      ctx.fillRect(bx + 3, by + 3, colW - 6, 4);

      // Subtle bevel bottom shadow
      ctx.fillStyle = 'rgba(48, 42, 36, 0.22)';
      ctx.fillRect(bx + 3, by + rowH - 7, colW - 6, 4);
    }
  }

  // Stone speckle wear
  for (let i = 0; i < 3600; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(240,235,220,0.14)' : 'rgba(58,52,44,0.16)';
    ctx.fillRect(rand() * size, rand() * size, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// WP1: 512px Terracotta Roof Tiles (overlapping barrel tile rows)
export function createTerracottaRoofTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(5501);

  ctx.fillStyle = '#B56343';
  ctx.fillRect(0, 0, size, size);

  const rows = 12;
  const cols = 10;
  const rowH = size / rows;
  const colW = size / cols;

  for (let r = 0; r < rows; r++) {
    const by = r * rowH;
    for (let c = 0; c < cols; c++) {
      const bx = c * colW;
      const shift = Math.floor((rand() - 0.5) * 20);
      const grad = ctx.createLinearGradient(bx, by, bx + colW, by);
      grad.addColorStop(0, `rgb(${156 + shift}, ${82 + Math.floor(shift * 0.5)}, ${55 + Math.floor(shift * 0.4)})`);
      grad.addColorStop(0.5, `rgb(${198 + shift}, ${112 + Math.floor(shift * 0.5)}, ${76 + Math.floor(shift * 0.4)})`);
      grad.addColorStop(1, `rgb(${146 + shift}, ${76 + Math.floor(shift * 0.5)}, ${50 + Math.floor(shift * 0.4)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(bx + 1, by, colW - 2, rowH - 2);
    }

    // Shadow under overlapping tile row
    ctx.fillStyle = 'rgba(66, 30, 18, 0.38)';
    ctx.fillRect(0, by + rowH - 4, size, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// WP1: 512px Woven Straw Thatch (farm storage, rustic huts, roofs)
export function createThatchTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(6709);

  ctx.fillStyle = '#B89B62';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2400; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 18 + rand() * 34;
    const angle = Math.PI / 2 + (rand() - 0.5) * 0.35;
    ctx.strokeStyle =
      rand() > 0.5
        ? 'rgba(214, 186, 126, 0.48)'
        : 'rgba(122, 94, 48, 0.42)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  // Horizontal thatch tier bands
  for (let y = 64; y < size; y += 64) {
    ctx.fillStyle = 'rgba(84, 62, 32, 0.24)';
    ctx.fillRect(0, y, size, 5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// WP1: 512px Veined White Marble Stone (Palace, Mosque, Clinic, School accents)
export function createMarbleTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(7817);

  ctx.fillStyle = '#EFE9DD';
  ctx.fillRect(0, 0, size, size);

  // Warm soft clouds
  for (let i = 0; i < 36; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 40 + rand() * 90;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(210, 200, 182, 0.2)');
    grad.addColorStop(1, 'rgba(239, 233, 221, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Delicate marble veins
  for (let v = 0; v < 18; v++) {
    let x = rand() * size;
    let y = rand() * size;
    ctx.strokeStyle = 'rgba(174, 164, 148, 0.34)';
    ctx.lineWidth = 0.8 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += 22 + rand() * 32;
      y += (rand() - 0.45) * 28;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Subtle carved ashlar stone courses
  ctx.strokeStyle = 'rgba(178, 168, 150, 0.25)';
  ctx.lineWidth = 1.5;
  for (let y = 0; y < size; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// WP1: Rounded alpha-feathered packed-earth foundation patch so buildings sit planted in sand
export function createPackedEarthTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(8291);

  ctx.clearRect(0, 0, size, size);

  // Soft irregular packed dirt disc
  const grad = ctx.createRadialGradient(256, 256, 48, 256, 256, 240);
  grad.addColorStop(0, 'rgba(136, 108, 72, 0.88)');
  grad.addColorStop(0.58, 'rgba(154, 124, 82, 0.65)');
  grad.addColorStop(0.84, 'rgba(172, 142, 94, 0.24)');
  grad.addColorStop(1, 'rgba(172, 142, 94, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(256, 256, 240, 0, Math.PI * 2);
  ctx.fill();

  // Earthy pebbles and soil mottling inside the feathered circle
  for (let i = 0; i < 1400; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * 210;
    const x = 256 + Math.cos(angle) * dist;
    const y = 256 + Math.sin(angle) * dist;
    const alpha = (1 - dist / 225) * 0.32;
    ctx.fillStyle =
      rand() > 0.5
        ? `rgba(98, 74, 46, ${alpha.toFixed(2)})`
        : `rgba(186, 154, 106, ${alpha.toFixed(2)})`;
    ctx.fillRect(x, y, 2.5, 2.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// WP4: Organic stony ground texture patch for ROCKY cells (never a square grid!)
export function createRockyGroundTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(9413);

  ctx.clearRect(0, 0, size, size);

  const grad = ctx.createRadialGradient(256, 256, 40, 256, 256, 232);
  grad.addColorStop(0, 'rgba(128, 124, 116, 0.78)');
  grad.addColorStop(0.55, 'rgba(142, 136, 124, 0.52)');
  grad.addColorStop(0.85, 'rgba(156, 148, 132, 0.16)');
  grad.addColorStop(1, 'rgba(156, 148, 132, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(256, 256, 232, 0, Math.PI * 2);
  ctx.fill();

  // Small gravel stones & mineral flecks
  for (let i = 0; i < 650; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * 205;
    const x = 256 + Math.cos(angle) * dist;
    const y = 256 + Math.sin(angle) * dist;
    const r = 1.5 + rand() * 4.2;
    ctx.fillStyle =
      rand() > 0.45 ? 'rgba(94, 90, 84, 0.48)' : 'rgba(182, 178, 168, 0.42)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// WP1: Soft dark radial-gradient disc for fake ambient occlusion (blob shadows)
export function createBlobShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = createCanvas(size, size);
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(26, 18, 10, 0.54)');
  grad.addColorStop(0.55, 'rgba(26, 18, 10, 0.28)');
  grad.addColorStop(1, 'rgba(26, 18, 10, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Water shimmer texture with subtle sun glints
export function createWaterWaveTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const rand = makeSeededRandom(9187);

  ctx.fillStyle = '#2B7A9B';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 30; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 36 + rand() * 82;
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
    grad.addColorStop(0, 'rgba(68, 162, 188, 0.34)');
    grad.addColorStop(1, 'rgba(43, 122, 155, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineWidth = 2;
  for (let y = 0; y < size; y += 22) {
    ctx.beginPath();
    for (let x = 0; x <= size; x += 12) {
      const wy = y + Math.sin((x / size) * Math.PI * 6 + y * 0.08) * 5;
      if (x === 0) ctx.moveTo(x, wy);
      else ctx.lineTo(x, wy);
    }
    ctx.strokeStyle = 'rgba(224, 246, 255, 0.24)';
    ctx.stroke();
  }

  // Sun glint flecks across waves
  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = 6 + rand() * 14;
    ctx.fillStyle = 'rgba(255, 248, 220, 0.38)';
    ctx.fillRect(x, y, w, 2);
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

// Striped terracotta/parchment fabric awning texture
export function createAwningTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size, size);
  const stripes = 8;
  const stripeW = size / stripes;

  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#B55F3E' : '#EAE0C8';
    ctx.fillRect(i * stripeW, 0, stripeW, size);
  }

  const grad = ctx.createLinearGradient(0, size * 0.76, 0, size);
  grad.addColorStop(0, 'rgba(43, 33, 24, 0)');
  grad.addColorStop(1, 'rgba(43, 33, 24, 0.25)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, size * 0.76, size, size * 0.24);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

// Soft radial circle texture for dust puffs, sunlit motes, and water sparkles
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

// Canvas-drawn floating amber "!" badge for unstaffed buildings
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

  ctx.fillStyle = '#2B2118';
  ctx.beginPath();
  ctx.roundRect(57, 34, 14, 38, 6);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(64, 88, 7.5, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Organic feathered placement footprint decal
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

// WP2: Canvas sprite price tag (gold coin drawn + exact price number)
export function createPriceTagTexture(
  price: number,
  affordable: boolean
): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(192, 80);
  ctx.clearRect(0, 0, 192, 80);

  // Parchment pill badge with gold border
  ctx.fillStyle = affordable ? 'rgba(251, 243, 223, 0.94)' : 'rgba(232, 220, 200, 0.86)';
  ctx.strokeStyle = affordable ? '#C9962E' : '#A67C52';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(10, 12, 172, 56, 26);
  ctx.fill();
  ctx.stroke();

  // Drawn gold coin on the left
  ctx.beginPath();
  ctx.arc(46, 40, 17, 0, Math.PI * 2);
  ctx.fillStyle = affordable ? '#E6B64B' : '#B89C68';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#8F6415';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(46, 40, 10, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 248, 210, 0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Crisp Latin price number
  ctx.fillStyle = affordable ? '#2B2118' : '#7A4338';
  ctx.font = '800 32px Cairo, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(price), 118, 42);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
