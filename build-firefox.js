#!/usr/bin/env node
// Builds the Firefox submission zip (for addons.mozilla.org signing).
//
// The source manifest.json declares BOTH background.service_worker (Chrome MV3,
// which rejects background.scripts) and background.scripts (Firefox, which
// ignores service_worker). That dual form is what lets one source tree load in
// both browsers -- but AMO's validator warns about the unused service_worker key.
//
// So: load unpacked from this folder for Chrome, and run this script to produce
// a Firefox-only zip with service_worker stripped.
//
// Usage: node build-firefox.js [outputPath]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = __dirname;
const OUT = process.argv[2] || path.join(SRC, 'sheets-screenshot-firefox.zip');

const FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.js',
  'preview.html',
  'preview.js',
];
const ICON_DIR = 'icons';

// --- Firefox-specific manifest -------------------------------------------

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));

if (!manifest.background || !Array.isArray(manifest.background.scripts)) {
  console.error('ERROR: manifest.background.scripts is missing. Firefox has no ' +
    'background script to run -- refusing to build a broken package.');
  process.exit(1);
}
delete manifest.background.service_worker;

// --- Minimal ZIP writer (stored + deflate, forward-slash paths) -----------
// PowerShell's Compress-Archive writes backslash entry names, which AMO
// rejects ("Invalid file name in archive"), hence hand-rolling this.

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const chunks = [];
const central = [];
let offset = 0;

function addFile(name, content) {
  const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const deflated = zlib.deflateRawSync(raw, { level: 9 });
  // Only use deflate if it actually helps; otherwise store.
  const useDeflate = deflated.length < raw.length;
  const data = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(raw);
  const nameBuf = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);          // version needed
  local.writeUInt16LE(0, 6);           // flags
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(0, 10);          // mod time
  local.writeUInt16LE(0x21, 12);       // mod date (2000-01-01)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);          // extra len

  chunks.push(local, nameBuf, data);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);             // version made by
  cd.writeUInt16LE(20, 6);             // version needed
  cd.writeUInt16LE(0, 8);              // flags
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(0, 12);
  cd.writeUInt16LE(0x21, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);             // extra
  cd.writeUInt16LE(0, 32);             // comment
  cd.writeUInt16LE(0, 34);             // disk
  cd.writeUInt16LE(0, 36);             // internal attrs
  cd.writeUInt32LE(0, 38);             // external attrs
  cd.writeUInt32LE(offset, 42);
  central.push(cd, nameBuf);

  offset += local.length + nameBuf.length + data.length;
}

// manifest.json comes from the patched object, not from disk
addFile('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

for (const f of FILES) {
  if (f === 'manifest.json') continue;
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) {
    console.error(`ERROR: missing required file: ${f}`);
    process.exit(1);
  }
  addFile(f, fs.readFileSync(p));
}

for (const icon of fs.readdirSync(path.join(SRC, ICON_DIR))) {
  const p = path.join(SRC, ICON_DIR, icon);
  if (fs.statSync(p).isFile()) addFile(`${ICON_DIR}/${icon}`, fs.readFileSync(p));
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

fs.writeFileSync(OUT, Buffer.concat([...chunks, centralBuf, end]));

console.log(`Built ${OUT}`);
console.log(`  version:     ${manifest.version}`);
console.log(`  gecko id:    ${manifest.browser_specific_settings.gecko.id}`);
console.log(`  background:  scripts=[${manifest.background.scripts}] (service_worker stripped)`);
