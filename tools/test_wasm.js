// tools/test_wasm.js — 直接实例化 wasm 验证数学与像素输出（不依赖 EffectCraft）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const WASM = path.join(ROOT, 'dist', 'mos_shake', 'mos_shake.wasm');
const OUT = path.join(ROOT, 'build', 'out');

// ---------- minimal PNG encoder ----------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------- test images ----------
// opaque checker / grid / orange frame (visual + coverage checks)
function makeGrid(w, h) {
  const px = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const chk = ((x >> 4) + (y >> 4)) & 1;
      let r = chk ? 0.16 : 0.10, g = chk ? 0.17 : 0.11, b = chk ? 0.22 : 0.14;
      if (x % 16 === 0 || y % 16 === 0) { r += 0.10; g += 0.10; b += 0.10; }
      r += 0.25 * (x / w); g += 0.20 * (y / h);
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 1;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (e < 3) {
        const i = (y * w + x) * 4;
        px[i] = 0.95; px[i + 1] = 0.45; px[i + 2] = 0.10; px[i + 3] = 1;
      }
    }
  }
  return px;
}
// transparent background + one dot (centroid tracking)
function makeDot(w, h, dx, dy, rad) {
  const px = new Float32Array(w * h * 4);
  const cx = (w - 1) / 2 + dx, cy = (h - 1) / 2 + dy;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const a = d <= rad ? 1 : 0;
      if (a > 0) {
        const i = (y * w + x) * 4;
        px[i] = 1; px[i + 1] = 0.6; px[i + 2] = 0.1; px[i + 3] = 1;
      }
    }
  }
  return px;
}

// ---------- JS reference (independent implementation of the doc formulas) ----------
function hash(ch, i) {
  let k = (Math.imul(ch, 2654435761) + Math.imul(i, 2246822519)) | 0;
  k = (k ^ 61) ^ (k >>> 16);
  k = Math.imul(k, 9);
  k ^= k >>> 4;
  k = Math.imul(k, 668265263);
  k ^= k >>> 15;
  return ((k >>> 8) / 16777216) * 2 - 1;
}
function noise(ch, t, T, sm) {
  const g = t / T;
  const fl = Math.floor(g);
  const f = g - fl;
  const q = f * f * f * (f * (f * 6 - 15) + 10);
  const u = f + sm * (q - f);
  const v0 = hash(ch, fl), v1 = hash(ch, fl + 1);
  return v0 + (v1 - v0) * u;
}
function nz(ch, t, PER, sm) {
  return 0.72 * noise(ch, t, PER, sm) + 0.28 * noise(ch + 37, t, PER * 0.37, sm);
}
function refTransform(t, P, W, H, scale) {
  const amp = Math.max(0, P.amplitude ?? 20) * scale;
  const sm = Math.min(1, Math.max(0, (P.smoothness ?? 60) / 100));
  const rate = Math.min(60, Math.max(0.02, P.rate ?? 2.5));
  const PER = 1 / rate;
  const rot = Math.min(60, Math.max(0, P.rotation ?? 1.5)) * Math.PI / 180;
  const rot3d = (P.rot3d ?? 0) > 0.5;
  const rotx = rot3d ? Math.min(rot * 2, 0.75) : 0;
  return {
    amp, PER, sm, rot, rotx,
    tx: amp * nz(1, t, PER, sm),
    ty: amp * nz(2, t, PER, sm),
    rz: rot * nz(3, t, PER, sm),
    rx: rotx * nz(4, t, PER, sm),
    ry: rotx * nz(5, t, PER, sm),
  };
}
// forward map: source point -> where it lands on screen
function refMap(x, y, tr, W, H) {
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const px = x - cx, py = y - cy;
  const cz = Math.cos(tr.rz), sz = Math.sin(tr.rz);
  const cb = Math.cos(tr.ry), sb = Math.sin(tr.ry);
  const ca = Math.cos(tr.rx), sa = Math.sin(tr.rx);
  const r11 = cz * cb, r12 = cz * sb * sa - sz * ca, r13 = cz * sb * ca + sz * sa;
  const r21 = sz * cb, r22 = sz * sb * sa + cz * ca, r23 = sz * sb * ca - cz * sa;
  const r31 = -sb, r32 = cb * sa, r33 = cb * ca;
  void r13; void r23; void r33;
  const X = r11 * px + r12 * py, Y = r21 * px + r22 * py, Z = r31 * px + r32 * py;
  const D = 3 * Math.max(W, H);
  const k = D / (D + Z);
  return { x: X * k + cx + tr.tx, y: Y * k + cy + tr.ty };
}

// ---------- harness ----------
(async () => {
  const bytes = fs.readFileSync(WASM);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;

  const api = ex.ec_api_version();
  const mptr = ex.ec_manifest_ptr(), mlen = ex.ec_manifest_len();
  const manifest = JSON.parse(Buffer.from(new Uint8Array(ex.memory.buffer).slice(mptr, mptr + mlen)).toString('utf8'));
  let flatCount = 0;
  for (const p of manifest.params) flatCount += p.type === 'point' ? 2 : p.type === 'color' ? 4 : 1;
  console.log(`api=${api} id=${manifest.id} name=${manifest.name} category=${manifest.category} params=${manifest.params.length} floats=${flatCount}`);

  function flatParams(values) {
    const flat = [];
    for (const p of manifest.params) {
      const v = values[p.id] !== undefined ? values[p.id] : p.default;
      flat.push(p.type === 'checkbox' ? (v ? 1 : 0) : v);
    }
    return flat;
  }
  function render(w, h, values, time = 0, srcImage, scale = 1) {
    const npx = w * h * 4, nbytes = npx * 4;
    const params = flatParams(values);
    const base = ex.ec_alloc(flatCount * 8 + nbytes);
    const dv = new DataView(ex.memory.buffer);
    for (let i = 0; i < params.length; i++) dv.setFloat64(base + i * 8, params[i], true);
    const pbase = base + flatCount * 8;
    const src = srcImage || makeGrid(w, h);
    new Float32Array(ex.memory.buffer, pbase, npx).set(src);
    const snap = src.slice();
    const t0 = process.hrtime.bigint();
    const rc = ex.ec_render(pbase, w, h, base, flatCount, time, scale);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (rc !== 0 && rc !== 1) throw new Error('ec_render returned ' + rc);
    const out = new Float32Array(ex.memory.buffer, pbase, npx).slice();
    return { out, src: snap, ms, rc, params };
  }
  function toPNG(file, w, h, f32px) {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h * 4; i++) {
      const v = f32px[i];
      rgba[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
    writePNG(file, w, h, rgba);
  }
  function centroid(px, w, h) {
    let s = 0, sx = 0, sy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = px[(y * w + x) * 4 + 3];
      if (a > 0) { s += a; sx += a * x; sy += a * y; }
    }
    return { x: sx / s, y: sy / s, mass: s };
  }
  function maxDiff(a, b) {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  }
  function minAlpha(px, w, h) {
    let m = 1;
    for (let i = 3; i < w * h * 4; i += 4) m = Math.min(m, px[i]);
    return m;
  }
  function opaqueDot(px, w, h) {
    let n = 0;
    for (let i = 3; i < w * h * 4; i += 4) if (px[i] > 0.5) n++;
    return n;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const W = 320, H = 180;
  let fails = 0;
  const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

  // ---- 1. identity ----
  {
    const r = render(W, H, { amplitude: 0, rotation: 0 });
    ok(r.rc === 0, 'identity: rc=0 (no work)');
    ok(maxDiff(r.out, r.src) === 0, 'identity: pixels untouched');
  }
  // ---- 2. zero amp, rotation only ----
  {
    const r = render(W, H, { amplitude: 0, rotation: 0.000001 });
    ok(r.rc === 0 && maxDiff(r.out, r.src) === 0, 'below-epsilon params: no work');
  }

  // ---- 3. translation matches the reference noise ----
  {
    const t = 0.37, P = { amplitude: 50, smoothness: 40, rotation: 0 };
    const tr = refTransform(t, P, W, H, 1);
    const src = makeDot(W, H, 0, 0, 6);
    const r = render(W, H, P, t, src);
    const c0 = centroid(src, W, H), c1 = centroid(r.out, W, H);
    const dx = c1.x - c0.x, dy = c1.y - c0.y;
    ok(Math.abs(dx - tr.tx) < 0.02 && Math.abs(dy - tr.ty) < 0.02,
      `translate: measured (${dx.toFixed(3)}, ${dy.toFixed(3)}) vs ref (${tr.tx.toFixed(3)}, ${tr.ty.toFixed(3)})`);
    ok(Math.hypot(dx, dy) <= 50.0001, 'translate: within 抖动幅度');
    toPNG(path.join(OUT, 'dot-translate.png'), W, H, r.out);
  }

  // ---- 4. rotation: off-centre dot swings on the right circle ----
  {
    const t = 0.83, P = { amplitude: 0, smoothness: 70, rotation: 30 };
    const tr = refTransform(t, P, W, H, 1);
    const src = makeDot(W, H, 90, 0, 6);
    const r = render(W, H, P, t, src);
    const c1 = centroid(r.out, W, H);
    const c0 = centroid(src, W, H);
    const exp = refMap(c0.x, c0.y, tr, W, H);
    ok(Math.abs(c1.x - exp.x) < 0.05 && Math.abs(c1.y - exp.y) < 0.05,
      `rotate: measured (${c1.x.toFixed(2)}, ${c1.y.toFixed(2)}) vs ref (${exp.x.toFixed(2)}, ${exp.y.toFixed(2)})  rz=${(tr.rz * 180 / Math.PI).toFixed(2)}deg`);
    // centre pixel must stay put (rotation about the centre)
    const ci = ((H >> 1) * W + (W >> 1)) * 4;
    ok(Math.abs(r.out[ci] - src[ci]) < 0.06, 'rotate: centre pixel stays put');
  }

  // ---- 5. 3D switch (t=3.0 gives large X/Y tilt) ----
  {
    const t = 3.5, P = { amplitude: 0, smoothness: 60, rotation: 20, rot3d: true };
    const tr2 = refTransform(t, P, W, H, 1);
    ok(Math.abs(tr2.rx) > 0.3 && Math.abs(tr2.ry) > 0.2,
      `3d: test time really tilts (rx=${(tr2.rx * 180 / Math.PI).toFixed(1)} ry=${(tr2.ry * 180 / Math.PI).toFixed(1)})`);
    const src = makeDot(W, H, 90, 55, 6);
    const r2 = render(W, H, P, t, src);
    const c0 = centroid(src, W, H), c2 = centroid(r2.out, W, H);
    const exp = refMap(c0.x, c0.y, tr2, W, H);
    ok(Math.abs(c2.x - exp.x) < 0.6 && Math.abs(c2.y - exp.y) < 0.6,
      `3d: measured (${c2.x.toFixed(2)}, ${c2.y.toFixed(2)}) vs ref (${exp.x.toFixed(2)}, ${exp.y.toFixed(2)})`);
    const r1 = render(W, H, { amplitude: 0, smoothness: 60, rotation: 20 }, t, src);
    ok(maxDiff(r1.out, r2.out) > 0.05, '3d: switch changes the image');
    toPNG(path.join(OUT, 'dot-3d.png'), W, H, r2.out);
  }

  // ---- 5b. homography probe: forward(refInverse(p)) == p, for 2D and 3D ----
  {
    const probe = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      probe[i] = x / (W - 1); probe[i + 1] = y / (H - 1); probe[i + 2] = 0; probe[i + 3] = 1;
    }
    const cases = [
      ['rot30', { amplitude: 0, smoothness: 70, rotation: 30 }, 0.83],
      ['tilt3d', { amplitude: 0, smoothness: 60, rotation: 20, rot3d: true }, 3.0],
      ['mixed', { amplitude: 45, smoothness: 60, rotation: 12, rot3d: true }, 3.0],
    ];
    for (const [name, P, t] of cases) {
      const r = render(W, H, P, t, probe);
      const tr = refTransform(t, P, W, H, 1);
      let worst = 0, n = 0;
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const i = (y * W + x) * 4;
        const a = r.out[i + 3];
        if (a < 0.9999) continue;
        // pixels are premultiplied: undo alpha before decoding the coordinate
        const u = Math.min(W - 1, Math.max(0, (r.out[i] / a) * (W - 1)));
        const v = Math.min(H - 1, Math.max(0, (r.out[i + 1] / a) * (H - 1)));
        const back = refMap(u, v, tr, W, H);
        worst = Math.max(worst, Math.hypot(back.x - x, back.y - y)); n++;
      }
      ok(worst < 0.2 && n > W * H * 0.2, `probe ${name}: forward(inverse(p)) error ${worst.toFixed(3)}px over ${n} px`);
      toPNG(path.join(OUT, 'probe-' + name + '.png'), W, H, r.out);
    }
  }

  // ---- 6. tiling ----
  {
    const t = 0.5, P = { amplitude: 120, smoothness: 50, rotation: 6 };
    const rOff = render(W, H, P, t);
    const rOn = render(W, H, Object.assign({}, P, { tile: true }), t);
    ok(minAlpha(rOff.out, W, H) === 0, 'tile off: uncovered edges are transparent');
    ok(minAlpha(rOn.out, W, H) > 0.99, `tile on: frame fully covered (minAlpha=${minAlpha(rOn.out, W, H).toFixed(4)})`);
    ok(opaqueDot(rOn.out, W, H) === W * H, 'tile on: every pixel covered');
    toPNG(path.join(OUT, 'tile-off.png'), W, H, rOff.out);
    toPNG(path.join(OUT, 'tile-on.png'), W, H, rOn.out);
  }

  // ---- 7. motion blur ----
  {
    const t = 1.0, P = { amplitude: 60, smoothness: 10, rotation: 8 };
    const rNo = render(W, H, P, t);
    const rMb = render(W, H, Object.assign({}, P, { motion_blur: true }), t);
    ok(maxDiff(rNo.out, rMb.out) > 0.01, 'motion blur: output differs');
    // centroid of the blurred dot = mean of the 8 shutter sub-samples
    const src = makeDot(W, H, 0, 0, 6);
    const rNo2 = render(W, H, P, t, src);
    const rMb2 = render(W, H, Object.assign({}, P, { motion_blur: true }), t, src);
    let mx = 0, my = 0;
    for (let k = 0; k < 8; k++) {
      const ti = t + ((k + 0.5) / 8 - 0.5) / 60;
      const tr = refTransform(ti, P, W, H, 1);
      const c0 = centroid(src, W, H);
      const p = refMap(c0.x, c0.y, tr, W, H);
      mx += p.x; my += p.y;
    }
    mx /= 8; my /= 8;
    const c = centroid(rMb2.out, W, H);
    ok(Math.abs(c.x - mx) < 0.6 && Math.abs(c.y - my) < 0.6,
      `motion blur: centroid (${c.x.toFixed(2)}, ${c.y.toFixed(2)}) vs shutter mean (${mx.toFixed(2)}, ${my.toFixed(2)})`);
    toPNG(path.join(OUT, 'mb-off.png'), W, H, rNo2.out);
    toPNG(path.join(OUT, 'mb-on.png'), W, H, rMb2.out);
  }

  // ---- 8. rate drives motion speed, smoothness shapes the easing ----
  {
    const step = (P) => {
      const vals = [];
      for (const t of [1.0, 1.0333, 1.0667, 1.1]) {
        const tr = refTransform(t, P, W, H, 1);
        vals.push([tr.tx, tr.ty]);
      }
      let d = 0;
      for (let i = 1; i < vals.length; i++) d += Math.hypot(vals[i][0] - vals[i - 1][0], vals[i][1] - vals[i - 1][1]);
      return d / (vals.length - 1);
    };
    const slow = step({ amplitude: 30, rate: 0.5, rotation: 0 });
    const fast = step({ amplitude: 30, rate: 8, rotation: 0 });
    ok(fast > slow * 3, `rate: per-frame step ${slow.toFixed(3)}px @0.5Hz vs ${fast.toFixed(2)}px @8Hz`);
    // smoothness does not change the average speed much, but changes the curve
    const rLin = render(W, H, { amplitude: 60, rate: 3, smoothness: 0, rotation: 0 }, 1.37);
    const rSmo = render(W, H, { amplitude: 60, rate: 3, smoothness: 100, rotation: 0 }, 1.37);
    ok(maxDiff(rLin.out, rSmo.out) > 0.01, 'smoothness: 0% vs 100% produce different easing');
    ok(Math.abs(step({ amplitude: 30, rate: 3, smoothness: 0 }) - step({ amplitude: 30, rate: 3, smoothness: 100 })) <
      0.6 * step({ amplitude: 30, rate: 3, smoothness: 50 }), 'smoothness: rate stays roughly independent of easing');
  }

  // ---- 9. determinism + scale independence ----
  {
    const P = { amplitude: 40, smoothness: 33, rotation: 3, rot3d: true };
    const a = render(W, H, P, 2.2), b = render(W, H, P, 2.2);
    ok(maxDiff(a.out, b.out) === 0, 'deterministic: same time -> same pixels');
    // amplitude is a layer-space quantity: at scale 2 the shift doubles
    const t = 0.37;
    const s1 = makeDot(W, H, 0, 0, 6);
    const rA = render(W, H, { amplitude: 20, smoothness: 40, rotation: 0 }, t, s1, 1);
    const rB = render(2 * W, 2 * H, { amplitude: 20, smoothness: 40, rotation: 0 }, t, makeDot(2 * W, 2 * H, 0, 0, 12), 2);
    const cA0 = centroid(s1, W, H), cA1 = centroid(rA.out, W, H);
    const sB = makeDot(2 * W, 2 * H, 0, 0, 12);
    const cB0 = centroid(sB, 2 * W, 2 * H), cB1 = centroid(rB.out, 2 * W, 2 * H);
    const ra = Math.hypot(cA1.x - cA0.x, cA1.y - cA0.y);
    const rb = Math.hypot(cB1.x - cB0.x, cB1.y - cB0.y);
    ok(Math.abs(rb - 2 * ra) < 0.1, `scale: shift ${ra.toFixed(2)}px @1x -> ${rb.toFixed(2)}px @2x`);
  }

  // ---- 10. performance ----
  {
    const t = 3.3;
    const big = render(1920, 1080, { amplitude: 24, smoothness: 55, rotation: 2 }, t);
    const bigBlur = render(1920, 1080, { amplitude: 24, smoothness: 55, rotation: 2, motion_blur: true }, t);
    const bigTile = render(1920, 1080, { amplitude: 24, smoothness: 55, rotation: 2, rot3d: true, tile: true }, t);
    console.log(`1080p  ${big.ms.toFixed(1)} ms   blur ${bigBlur.ms.toFixed(1)} ms   3d+tile ${bigTile.ms.toFixed(1)} ms`);
  }

  // ---- visual stills ----
  {
    const t = 0.6;
    const cases = [
      ['g-base', { amplitude: 20, rate: 2.5, smoothness: 60, rotation: 1.5 }],
      ['g-amp80', { amplitude: 80, rate: 2.5, smoothness: 60, rotation: 3 }],
      ['g-rate-slow', { amplitude: 60, rate: 0.4, smoothness: 60, rotation: 3 }],
      ['g-rate-fast', { amplitude: 60, rate: 12, smoothness: 60, rotation: 3 }],
      ['g-3d', { amplitude: 20, rate: 2.5, smoothness: 60, rotation: 12, rot3d: true }],
      ['g-tile', { amplitude: 60, rate: 2.5, smoothness: 50, rotation: 4, tile: true }],
      ['g-mb', { amplitude: 60, rate: 6, smoothness: 5, rotation: 4, motion_blur: true }],
      ['g-linear', { amplitude: 30, rate: 2.5, smoothness: 0, rotation: 2 }],
    ];
    for (const [name, v] of cases) {
      const r = render(W, H, v, t);
      toPNG(path.join(OUT, name + '.png'), W, H, r.out);
    }
    // 6 contiguous frames at 24 fps, tiled into one contact sheet (3 x 2)
    const frames = 6, cw = W >> 1, ch = H >> 1;
    const sheet = new Float32Array(cw * 3 * ch * 2 * 4);
    const sheetW = cw * 3, sheetH = ch * 2;
    for (let f = 0; f < frames; f++) {
      const r = render(W, H, { amplitude: 30, rate: 2.5, smoothness: 55, rotation: 3 }, f / 24);
      const ox = (f % 3) * cw, oy = Math.floor(f / 3) * ch;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const si = ((y * 2) * W + x * 2) * 4, di = ((oy + y) * sheetW + ox + x) * 4;
        sheet[di] = r.out[si]; sheet[di + 1] = r.out[si + 1];
        sheet[di + 2] = r.out[si + 2]; sheet[di + 3] = r.out[si + 3];
      }
      toPNG(path.join(OUT, 'strip-' + f + '.png'), W, H, r.out);
    }
    toPNG(path.join(OUT, 'contact-sheet.png'), sheetW, sheetH, sheet);
  }

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
  console.log('out ->', OUT);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });


