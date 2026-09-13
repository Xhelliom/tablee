/**
 * Génère les icônes PNG de la PWA depuis les formes de `web/public/icon.svg`.
 *
 *   npm run icons
 *
 * Android exige des PNG pour installer une PWA, et une PWA non installée
 * n'apparaît pas dans le menu de partage — donc pas de share target, donc pas
 * d'ingestion Jow (§4). D'où ce script plutôt qu'une dépendance de rendu : les
 * formes sont trois primitives, autant les tracer à la main que d'embarquer un
 * rasteriseur pour trois fichiers générés une fois.
 */
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

type Rgb = [number, number, number];
const CORAL: Rgb = [0xd8, 0x5a, 0x30];
const CREAM: Rgb = [0xfa, 0xec, 0xe7];

/** Coordonnées du SVG, en repère 512×512, réutilisées telles quelles. */
interface Shape {
  inside(x: number, y: number): boolean;
}

const roundedRect = (x0: number, y0: number, w: number, h: number, r: number): Shape => ({
  inside(x, y) {
    if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
    const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
    const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  },
});

const ellipse = (cx: number, cy: number, rx: number, ry: number): Shape => ({
  inside(x, y) {
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  },
});

/** L'assiette : un rectangle dont le bas est un demi-disque. */
const bowl = (x0: number, y0: number, w: number, depth: number): Shape => {
  const cx = x0 + w / 2;
  return {
    inside(x, y) {
      if (y < y0 || y > y0 + depth) return false;
      if (x < x0 || x > x0 + w) return false;
      const flat = y0 + 18;
      if (y <= flat) return true;
      return ((x - cx) / (w / 2)) ** 2 + ((y - flat) / (depth - 18)) ** 2 <= 1;
    },
  };
};

const union = (...shapes: Shape[]): Shape => ({
  inside: (x, y) => shapes.some((s) => s.inside(x, y)),
});

/**
 * Deux tracés : l'icône normale garde les coins arrondis du SVG ; la variante
 * maskable remplit tout le carré et recentre le motif dans la zone sûre
 * d'Android (80 % du côté), sinon le lanceur rogne dans l'assiette.
 */
function draw(size: number, maskable: boolean): Buffer {
  const scale = size / 512;
  const inset = maskable ? 0.78 : 1;
  const glyph = union(
    bowl(96, 244, 256, 138),
    roundedRect(392, 126, 26, 256, 13),
    ellipse(405, 170, 34, 52),
  );
  const background = maskable ? null : roundedRect(0, 0, 512, 512, 112);

  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) / scale;
      const y = (py + 0.5) / scale;
      const inBackground = background === null || background.inside(x, y);

      // Motif recentré : on repasse en coordonnées SVG autour du centre.
      const gx = 256 + (x - 256) / inset;
      const gy = 256 + (y - 256) / inset;

      const offset = (py * size + px) * 4;
      if (!inBackground) {
        pixels.writeUInt32BE(0, offset);
        continue;
      }
      const color = glyph.inside(gx, gy) ? CREAM : CORAL;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  return encodePng(size, size, pixels);
}

// ── encodeur PNG (RGBA, sans filtre) ────────────────────────────────────────

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filtre « None »
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // 8 bits par canal
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // filtre adaptatif
  ihdr[12] = 0;  // non entrelacé

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const dir = fileURLToPath(new URL('../web/public/', import.meta.url));
for (const [file, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
] as const) {
  await writeFile(dir + file, draw(size, maskable));
  console.log(`✓ web/public/${file}`);
}
