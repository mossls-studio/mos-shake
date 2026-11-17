// Second performance pass on the hot loop.
//  1. adaptive motion-blur sample count: one sample per pixel of travel over
//     the shutter, so a nearly static frame costs one pass instead of eight;
//  2. the affine walk folds the screen-centre offset into the row seed, which
//     removes two adds per pixel.
const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'src', 'mos_shake.wat');
let s = fs.readFileSync(p, 'utf8');

function between(text, startMark, endMark) {
  const a = text.indexOf(startMark);
  const b = text.indexOf(endMark, a + 1);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + startMark);
  return [a, b];
}

// ---------- 2. fold the centre offset into the affine row seed ----------
{
  const [a, b] = between(s, '  (func $passA (param $accum i32)', '  ;; $passP:');
  let body = s.slice(a, b);
  const before = body;
  body = body.replace(
    'global.get $F12 local.get $sy f32.mul f32.add local.set $nu',
    'global.get $F12 local.get $sy f32.mul f32.add global.get $FCX f32.add local.set $nu');
  body = body.replace(
    'global.get $F22 local.get $sy f32.mul f32.add local.set $nv',
    'global.get $F22 local.get $sy f32.mul f32.add global.get $FCY f32.add local.set $nv');
  body = body.replace('            local.get $nu global.get $FCX f32.add local.set $u\n', '');
  body = body.replace('            local.get $nv global.get $FCY f32.add local.set $v\n', '');
  if (body === before) throw new Error('passA seed patch did not apply');
  body = body.replace(/\$u\b/g, '$nu').replace(/\$v\b/g, '$nv');
  // the two locals are gone now
  body = body.replace('    (local $u f32) (local $v f32) ', '');
  s = s.slice(0, a) + body + s.slice(b);
}

// ---------- 1. adaptive sample count ----------
{
  const [a, b] = between(s, '    global.get $MB\n', '    i32.const 0)\n  )');
  let body = s.slice(a, b);
  const before = body;

  const seed = [
    '    ;; ---- how many blur samples does the shutter need? ----',
    '    ;; One sample per pixel of travel keeps the trail smooth; a frame that',
    '    ;; barely moves needs exactly one pass, which skips the accumulator.',
    '    local.get $time f64.const 0.008333333333333333 f64.sub local.set $t0',
    '    local.get $time f64.const 0.008333333333333333 f64.add local.set $t1',
    '    i32.const 1 local.get $t1 call $nz i32.const 1 local.get $t0 call $nz',
    '    f64.sub f64.abs global.get $AMP f64.mul',
    '    i32.const 2 local.get $t1 call $nz i32.const 2 local.get $t0 call $nz',
    '    f64.sub f64.abs global.get $AMP f64.mul f64.add',
    '    i32.const 3 local.get $t1 call $nz i32.const 3 local.get $t0 call $nz',
    '    f64.sub f64.abs global.get $ROT f64.mul',
    '    i32.const 4 local.get $t1 call $nz i32.const 4 local.get $t0 call $nz',
    '    f64.sub f64.abs',
    '    i32.const 5 local.get $t1 call $nz i32.const 5 local.get $t0 call $nz',
    '    f64.sub f64.abs f64.add global.get $ROTX f64.mul f64.add',
    '    local.get $rmax f64.mul f64.add local.set $d',
    '    local.get $d f64.ceil i32.trunc_f64_s local.set $n',
    '    local.get $n i32.const 1 i32.lt_s (if (then i32.const 1 local.set $n))',
    '    local.get $n i32.const 8 i32.gt_s (if (then i32.const 8 local.set $n))',
    '    f32.const 1 local.get $n f32.convert_i32_s f32.div local.set $inv',
    ''
  ].join('\n');

  body = body.replace('    global.get $MB\n', seed + '    global.get $MB\n    local.get $n i32.const 1 i32.gt_s i32.and\n');

  // the loop now runs $n samples and divides by $n
  body = body.replace('local.get $k i32.const 8 i32.ge_s br_if $bend',
    'local.get $k local.get $n i32.ge_s br_if $bend');
  body = body.replace(
    '          local.get $k f64.convert_i32_s f64.const 0.5 f64.add\n          f64.const 0.125 f64.mul f64.const 0.5 f64.sub',
    '          local.get $k f64.convert_i32_s f64.const 0.5 f64.add\n          local.get $n f64.convert_i32_s f64.div f64.const 0.5 f64.sub');
  body = body.replace('      f32.const 0.125 local.set $s8\n', '');
  body = body.replace('local.get $s8 f32.mul', 'local.get $inv f32.mul');

  if (body === before) throw new Error('blur patch did not apply');
  s = s.slice(0, a) + body + s.slice(b);
}

// ---------- locals for the new state ----------
s = s.replace(
  '    (local $total i32) (local $i i32) (local $k i32) (local $ti f64)\n    (local $s8 f32)',
  '    (local $total i32) (local $i i32) (local $k i32) (local $ti f64)\n' +
  '    (local $t0 f64) (local $t1 f64) (local $d f64) (local $rmax f64)\n' +
  '    (local $n i32) (local $inv f32)');

// rmax = half the frame diagonal, the lever arm of a rotation
s = s.replace(
  '    local.get $w local.get $h call $imax f64.convert_i32_s f64.const 3 f64.mul global.set $D',
  '    local.get $w local.get $h call $imax f64.convert_i32_s f64.const 3 f64.mul global.set $D\n' +
  '    local.get $w f64.convert_i32_s local.get $w f64.convert_i32_s f64.mul\n' +
  '    local.get $h f64.convert_i32_s local.get $h f64.convert_i32_s f64.mul f64.add\n' +
  '    f64.sqrt f64.const 0.5 f64.mul local.set $rmax');

if (!s.includes('local.set $rmax')) throw new Error('rmax not written');
if (!s.includes('local.get $n i32.const 1 i32.gt_s i32.and')) throw new Error('gate not written');

fs.writeFileSync(p, s);
console.log('optimized', s.split('\n').length, 'lines');
