// make_variant.js — build experimental variants of the kernel for cost attribution.
// usage: node tools/make_variant.js <name> [--sub "a=b" ...]
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function escapeWatString(bytes) {
  let out = '';
  for (const b of bytes) {
    if (b === 0x22 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += '\\' + b.toString(16).padStart(2, '0');
  }
  return out;
}

const name = process.argv[2] || 'variant';
const subs = [];
for (let i = 3; i < process.argv.length; i++) {
  if (process.argv[i] === '--sub') {
    const [a, b] = process.argv[++i].split('=');
    subs.push([a, b]);
  }
}

(async () => {
  const manifestSrc = fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8');
  const manifest = JSON.stringify(JSON.parse(manifestSrc));
  const mbytes = Buffer.from(manifest, 'utf8');
  let wat = fs.readFileSync(path.join(ROOT, 'src', 'mos_shake.wat'), 'utf8');
  wat = wat.replace('__MANIFEST_BYTES__', escapeWatString(mbytes))
    .replace('__MANIFEST_LEN__', String(mbytes.length));
  for (const [a, b] of subs) {
    if (!wat.includes(a)) throw new Error('substr not found: ' + a);
    wat = wat.split(a).join(b);
  }
  const wabt = await require('wabt')();
  const mod = wabt.parseWat('v.wat', wat.replace(/[^\x00-\x7F]/g, ' '), {});
  mod.resolveNames();
  mod.validate();
  const { buffer } = mod.toBinary({ log: false, write_debug_names: false });
  const out = path.join(ROOT, 'build', `v_${name}.wasm`);
  fs.writeFileSync(out, Buffer.from(buffer));
  console.log('built', out, buffer.byteLength, 'B');
})().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
