// make_simd_probe.js — build a minimal ABI1 plugin whose ec_render uses v128,
// to find out whether the host's wasm runtime accepts SIMD.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const manifest = JSON.stringify({
  api: 1, id: 'probe.simd', name: 'probe_simd', category: 'Probe',
  version: '0.0.1', author: 'probe', params: [
    { id: 'amount', name: 'Amount', type: 'slider', default: 0, min: 0, max: 100 }
  ]
});

function esc(s) { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

const wat = `(module
  (memory (export "memory") 2)
  (data (i32.const 1024) "${esc(manifest)}")
  (global $man_len i32 (i32.const ${Buffer.byteLength(manifest)}))
  (func (export "ec_api_version") (result i32) i32.const 1)
  (func (export "ec_manifest_ptr") (result i32) i32.const 1024)
  (func (export "ec_manifest_len") (result i32) global.get $man_len)
  (func (export "ec_alloc") (param $n i32) (result i32)
    (local $want i32)
    local.get $n i32.const 3 i32.mul i32.const 32768 i32.add i32.const 65536 i32.add
    i32.const 16 i32.shr_u
    local.tee $want
    memory.grow drop
    i32.const 32768)
  (func (export "ec_render")
    (param $px i32) (param $w i32) (param $h i32)
    (param $p i32) (param $np i32) (param $t f64) (param $sc f64) (result i32)
    local.get $px
    v128.const i32x4 1 2 3 4
    v128.store
    i32.const 0)
)
`;

const wabtFactory = require('wabt');
(async () => {
  const wabt = await wabtFactory();
  const mod = wabt.parseWat('probe_simd.wat', wat, {});
  mod.resolveNames();
  mod.validate();
  const { buffer } = mod.toBinary({ log: false, write_debug_names: false });
  const out = path.join(ROOT, 'build', 'probe_simd.wasm');
  fs.writeFileSync(out, Buffer.from(buffer));
  console.log('built', out, buffer.byteLength, 'bytes');
})().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
