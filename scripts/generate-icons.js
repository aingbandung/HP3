import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * High-quality SDF (Signed Distance Field) rasterizer for Smartphone + Radar App Icon.
 * Renders anti-aliased PNG without external heavy binary dependencies.
 */
function createPNG(size) {
  const width = size;
  const height = size;

  // CRC32 table
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }
  function crc32(buf, start, len) {
    let c = 0xffffffff;
    for (let i = start; i < start + len; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  // SDF Helpers
  function sdRoundedBox(px, py, bx, by, r) {
    const qx = Math.abs(px) - bx + r;
    const qy = Math.abs(py) - by + r;
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  }

  function sdCircle(px, py, r) {
    return Math.hypot(px, py) - r;
  }

  function sdRing(px, py, r, thickness) {
    return Math.abs(Math.hypot(px, py) - r) - thickness / 2;
  }

  function sdSegment(px, py, ax, ay, bx, by, thickness) {
    const pax = px - ax, pay = py - ay;
    const bax = bx - ax, bay = by - ay;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
    const dx = pax - bax * h;
    const dy = pay - bay * h;
    return Math.hypot(dx, dy) - thickness / 2;
  }

  const rawData = Buffer.alloc((1 + width * 4) * height);
  const cx = width / 2;
  const cy = height / 2;
  const scale = size / 512;

  // Squircle icon background geometry
  const bgHalfW = 240 * scale;
  const bgHalfH = 240 * scale;
  const bgRadius = 90 * scale;

  // Phone geometry
  const phoneCenterY = cy + 10 * scale;
  const phoneHalfW = 100 * scale;
  const phoneHalfH = 175 * scale;
  const phoneRadius = 38 * scale;
  const bezelThickness = 6 * scale;

  // Screen geometry
  const screenHalfW = phoneHalfW - bezelThickness - 2 * scale;
  const screenHalfH = phoneHalfH - bezelThickness - 6 * scale;
  const screenRadius = 26 * scale;

  // Radar geometry (centered in phone screen)
  const radarCY = phoneCenterY - 4 * scale;
  const radarR1 = 68 * scale;
  const radarR2 = 46 * scale;
  const radarR3 = 24 * scale;
  const ringThick = 2.4 * scale;

  // Radar blip target location
  const blipX = cx + 34 * scale;
  const blipY = radarCY - 26 * scale;

  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      // 1. App Icon Base Squircle
      const dBg = sdRoundedBox(x - cx, y - cy, bgHalfW, bgHalfH, bgRadius);
      if (dBg > 1.5) {
        // Transparent outside app icon
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        continue;
      }

      // Base app squircle color: deep obsidian dark-blue gradient
      const ny = y / height;
      let r = Math.round(3 + ny * 12);
      let g = Math.round(7 + ny * 18);
      let b = Math.round(22 + ny * 35);
      let a = Math.round(Math.max(0, Math.min(1, 0.5 - dBg)) * 255);

      // Squircle outer border rim
      if (Math.abs(dBg) < 2.5 * scale) {
        r = Math.round(r * 0.5 + 40);
        g = Math.round(g * 0.5 + 60);
        b = Math.round(b * 0.5 + 110);
      }

      // Outer radar broadcast waves above phone
      const dWaveY = y - (phoneCenterY - phoneHalfH - 12 * scale);
      const dWaveX = x - cx;
      const waveDist = Math.hypot(dWaveX, dWaveY);
      if (dWaveY < 0 && Math.abs(dWaveX) < 130 * scale) {
        const w1 = Math.abs(waveDist - 40 * scale) - 1.8 * scale;
        const w2 = Math.abs(waveDist - 70 * scale) - 2.0 * scale;
        const w3 = Math.abs(waveDist - 100 * scale) - 2.2 * scale;
        const minW = Math.min(w1, w2, w3);
        if (minW < 1.0) {
          const waveAlpha = Math.max(0, Math.min(1, 0.5 - minW)) * 0.8;
          r = Math.round(r * (1 - waveAlpha) + 56 * waveAlpha);
          g = Math.round(g * (1 - waveAlpha) + 189 * waveAlpha);
          b = Math.round(b * (1 - waveAlpha) + 248 * waveAlpha);
        }
      }

      // 2. Phone Body Bezel (Bentuk HP)
      const dPhone = sdRoundedBox(x - cx, y - phoneCenterY, phoneHalfW, phoneHalfH, phoneRadius);
      const dPhoneGlow = dPhone - 8 * scale;

      if (dPhoneGlow < 0) {
        // Subtle outer cyan/indigo glow around phone
        const glowFactor = Math.max(0, -dPhoneGlow / (8 * scale)) * 0.45;
        r = Math.round(r + 40 * glowFactor);
        g = Math.round(g + 90 * glowFactor);
        b = Math.round(b + 200 * glowFactor);
      }

      if (dPhone < 0.8) {
        // Phone Bezel Gradient (Cyan -> Indigo -> Violet border)
        const phoneGrad = (y - (phoneCenterY - phoneHalfH)) / (phoneHalfH * 2);
        let bR = Math.round(56 * (1 - phoneGrad) + 147 * phoneGrad);
        let bG = Math.round(189 * (1 - phoneGrad) + 51 * phoneGrad);
        let bB = Math.round(248 * (1 - phoneGrad) + 234 * phoneGrad);

        const dScreen = sdRoundedBox(x - cx, y - phoneCenterY, screenHalfW, screenHalfH, screenRadius);

        if (dScreen >= 0) {
          // Inside phone bezel frame
          const bezelAlpha = Math.max(0, Math.min(1, 0.5 - dPhone));
          r = Math.round(r * (1 - bezelAlpha) + bR * bezelAlpha);
          g = Math.round(g * (1 - bezelAlpha) + bG * bezelAlpha);
          b = Math.round(b * (1 - bezelAlpha) + bB * bezelAlpha);
        } else {
          // Inside phone glass screen
          // Deep radar screen navy-teal gradient
          const sGrad = (y - (phoneCenterY - screenHalfH)) / (screenHalfH * 2);
          let sR = Math.round(4 + sGrad * 10);
          let sG = Math.round(12 + sGrad * 24);
          let sB = Math.round(32 + sGrad * 48);

          // Top Dynamic Island Notch
          const dNotch = sdRoundedBox(x - cx, y - (phoneCenterY - screenHalfH + 16 * scale), 26 * scale, 5 * scale, 5 * scale);
          if (dNotch < 0) {
            sR = 15;
            sG = 23;
            sB = 42;
          }

          // Camera pinhole inside notch
          const dCam = sdCircle(x - (cx + 14 * scale), y - (phoneCenterY - screenHalfH + 16 * scale), 2 * scale);
          if (dCam < 0) {
            sR = 14;
            sG = 165;
            sB = 233;
          }

          // Bottom Home Bar Pill
          const dHomeBar = sdRoundedBox(x - cx, y - (phoneCenterY + screenHalfH - 14 * scale), 30 * scale, 2.5 * scale, 2.5 * scale);
          if (dHomeBar < 0) {
            sR = 71;
            sG = 85;
            sB = 105;
          }

          // 3. RADAR SYMBOL (Simbol Radar)
          const rx = x - cx;
          const ry = y - radarCY;
          const rDist = Math.hypot(rx, ry);

          // Radar Concentric Circles
          const ring1 = sdRing(rx, ry, radarR1, ringThick);
          const ring2 = sdRing(rx, ry, radarR2, ringThick * 1.1);
          const ring3 = sdRing(rx, ry, radarR3, ringThick * 1.2);
          const minRing = Math.min(ring1, ring2, ring3);

          if (minRing < 1.0) {
            const ringAlpha = Math.max(0, Math.min(1, 0.5 - minRing)) * 0.85;
            sR = Math.round(sR * (1 - ringAlpha) + 0 * ringAlpha);
            sG = Math.round(sG * (1 - ringAlpha) + 240 * ringAlpha);
            sB = Math.round(sB * (1 - ringAlpha) + 255 * ringAlpha);
          }

          // Radar Crosshairs
          const dCrossH = sdSegment(rx, ry, -radarR1, 0, radarR1, 0, 1.2 * scale);
          const dCrossV = sdSegment(rx, ry, 0, -radarR1, 0, radarR1, 1.2 * scale);
          const minCross = Math.min(dCrossH, dCrossV);
          if (minCross < 0.8 && rDist <= radarR1) {
            const crossAlpha = Math.max(0, Math.min(1, 0.5 - minCross)) * 0.45;
            sR = Math.round(sR * (1 - crossAlpha) + 56 * crossAlpha);
            sG = Math.round(sG * (1 - crossAlpha) + 189 * crossAlpha);
            sB = Math.round(sB * (1 - crossAlpha) + 248 * crossAlpha);
          }

          // Radar Sweep Beam Sector (Rotated wedge at ~45-80 degrees)
          if (rDist < radarR1) {
            const angle = Math.atan2(ry, rx); // -PI to PI
            // Sweep sector between -0.8 rad and -0.1 rad
            if (angle > -0.85 && angle < -0.05) {
              const sweepGrad = (angle - (-0.85)) / 0.8;
              const sweepAlpha = sweepGrad * 0.45;
              sR = Math.round(sR * (1 - sweepAlpha) + 0 * sweepAlpha);
              sG = Math.round(sG * (1 - sweepAlpha) + 230 * sweepAlpha);
              sB = Math.round(sB * (1 - sweepAlpha) + 255 * sweepAlpha);
            }
          }

          // Radar Sweep Leading Edge Beam
          const sweepCos = Math.cos(-0.08);
          const sweepSin = Math.sin(-0.08);
          const dBeam = sdSegment(rx, ry, 0, 0, radarR1 * sweepCos, radarR1 * sweepSin, 2.0 * scale);
          if (dBeam < 0.8) {
            const beamAlpha = Math.max(0, Math.min(1, 0.5 - dBeam)) * 0.95;
            sR = Math.round(sR * (1 - beamAlpha) + 160 * beamAlpha);
            sG = Math.round(sG * (1 - beamAlpha) + 250 * beamAlpha);
            sB = Math.round(sB * (1 - beamAlpha) + 255 * beamAlpha);
          }

          // Radar Center Dot
          const dCenterDot = sdCircle(rx, ry, 4.5 * scale);
          if (dCenterDot < 0) {
            sR = 255;
            sG = 255;
            sB = 255;
          }

          // Target Detected Blip Dot (Green Ping!)
          const dBlip = sdCircle(x - blipX, y - blipY, 4.5 * scale);
          const dBlipGlow = sdCircle(x - blipX, y - blipY, 12 * scale);
          if (dBlipGlow < 0) {
            const blipGlow = Math.max(0, -dBlipGlow / (12 * scale)) * 0.6;
            sR = Math.round(sR + 16 * blipGlow);
            sG = Math.round(sG + 185 * blipGlow);
            sB = Math.round(sB + 129 * blipGlow);
          }
          if (dBlip < 0) {
            const innerBlip = sdCircle(x - blipX, y - blipY, 2.0 * scale);
            if (innerBlip < 0) {
              sR = 255;
              sG = 255;
              sB = 255;
            } else {
              sR = 52;
              sG = 211;
              sB = 153;
            }
          }

          // Blend screen with antialiased screen border
          const screenAlpha = Math.max(0, Math.min(1, 0.5 - dScreen));
          r = Math.round(bR * (1 - screenAlpha) + sR * screenAlpha);
          g = Math.round(bG * (1 - screenAlpha) + sG * screenAlpha);
          b = Math.round(bB * (1 - screenAlpha) + sB * screenAlpha);
        }
      }

      rawData[offset++] = Math.min(255, Math.max(0, r));
      rawData[offset++] = Math.min(255, Math.max(0, g));
      rawData[offset++] = Math.min(255, Math.max(0, b));
      rawData[offset++] = a;
    }
  }

  // PNG chunks
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.writeUInt8(8, 16); // 8-bit depth
  ihdr.writeUInt8(6, 17); // RGBA
  ihdr.writeUInt8(0, 18);
  ihdr.writeUInt8(0, 19);
  ihdr.writeUInt8(0, 20);
  ihdr.writeUInt32BE(crc32(ihdr, 4, 17), 21);

  const compressedData = zlib.deflateSync(rawData);
  const idat = Buffer.alloc(12 + compressedData.length);
  idat.writeUInt32BE(compressedData.length, 0);
  idat.write('IDAT', 4);
  compressedData.copy(idat, 8);
  idat.writeUInt32BE(crc32(idat, 4, 4 + compressedData.length), 8 + compressedData.length);

  const iend = Buffer.alloc(12);
  iend.writeUInt32BE(0, 0);
  iend.write('IEND', 4);
  iend.writeUInt32BE(crc32(iend, 4, 4), 8);

  return Buffer.concat([signature, ihdr, idat, iend]);
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log('Generating high-resolution Smartphone with Radar PNG icons...');
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), createPNG(512));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), createPNG(512));
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), createPNG(192));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPNG(180));
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), createPNG(48));

console.log('✅ Successfully generated smartphone + radar icons in /public!');
