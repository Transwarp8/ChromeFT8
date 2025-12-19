/**
 * Simple script to create placeholder PNG icons for the Chrome extension.
 * Run with: node create-icons.js
 */

const fs = require('fs');
const path = require('path');

// Minimal 1x1 transparent PNG (base64)
// We'll create simple colored icons using raw PNG data

function createPNG(width, height, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);  // Length
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;  // Bit depth
  ihdr[17] = 2;  // Color type (RGB)
  ihdr[18] = 0;  // Compression
  ihdr[19] = 0;  // Filter
  ihdr[20] = 0;  // Interlace
  const ihdrCRC = crc32(ihdr.slice(4, 21));
  ihdr.writeUInt32BE(ihdrCRC, 21);
  
  // IDAT chunk (image data)
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0);  // Filter byte
    for (let x = 0; x < width; x++) {
      // Create a gradient effect
      const centerX = width / 2;
      const centerY = height / 2;
      const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
      const maxDist = Math.sqrt(centerX ** 2 + centerY ** 2);
      const factor = 1 - (dist / maxDist) * 0.5;
      
      // Background with gradient
      if (dist < width / 2 - 2) {
        const bgR = Math.floor(10 * factor);
        const bgG = Math.floor(14 * factor);
        const bgB = Math.floor(20 * factor);
        
        // Add some cyan color in center
        if (dist < width / 4) {
          rawData.push(Math.floor(0 + 217 * (1 - dist / (width / 4))));
          rawData.push(Math.floor(14 + 241 * (1 - dist / (width / 4))));
          rawData.push(Math.floor(20 + 235 * (1 - dist / (width / 4))));
        } else {
          rawData.push(bgR);
          rawData.push(bgG);
          rawData.push(bgB);
        }
      } else {
        // Border gradient
        rawData.push(Math.floor(r * factor));
        rawData.push(Math.floor(g * factor));
        rawData.push(Math.floor(b * factor));
      }
    }
  }
  
  // Compress using zlib (simple store)
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(Buffer.from(rawData));
  
  const idatLen = compressed.length;
  const idat = Buffer.alloc(idatLen + 12);
  idat.writeUInt32BE(idatLen, 0);
  idat.write('IDAT', 4);
  compressed.copy(idat, 8);
  const idatCRC = crc32(Buffer.concat([Buffer.from('IDAT'), compressed]));
  idat.writeUInt32BE(idatCRC, idatLen + 8);
  
  // IEND chunk
  const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// CRC32 lookup table
const crcTable = (function() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir);
}

// Create icons
const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = createPNG(size, size, 0, 217, 255);
  const filename = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filename, png);
  console.log(`Created ${filename}`);
}

console.log('Done! Icons created successfully.');
