// micro-optimise the two inner loops:
//  - one unsigned compare per axis for the interior test
//  - keep $off running (+16 per pixel) instead of recomputing it from x
const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'src', 'mos_shake.wat');
let s = fs.readFileSync(p, 'utf8');

function replaceAll(text, from, to) {
  const parts = text.split(from);
  return { text: parts.join(to), n: parts.length - 1 };
}

// 1) interior test: two unsigned compares instead of four signed ones
const oldB = [
  'local.get $ix i32.const 0 i32.lt_s',
  'local.get $ix local.get $Wm1 i32.ge_s i32.or',
  'local.get $iy i32.const 0 i32.lt_s i32.or',
  'local.get $iy local.get $Hm1 i32.ge_s i32.or',
].join('\n            ');
const newB = [
  'local.get $ix local.get $Wm1 i32.lt_u',
  'local.get $iy local.get $Hm1 i32.lt_u i32.and',
].join('\n            ');
let r = replaceAll(s, oldB, newB); s = r.text; const nB = r.n;

// 2) drop the per-store address rebuild (the address now lives in $off)
const offExpr = 'local.get $rowdst local.get $x i32.const 4 i32.shl i32.add local.set $off';
r = replaceAll(s, '            ' + offExpr + '\n', ''); s = r.text; const nO = r.n;

// 3) initialise $off at the start of each row, advance it with x
const xZero = '            i32.const 0 local.set $x';
r = replaceAll(s, xZero, '            local.get $rowdst local.set $off\n' + xZero);
s = r.text; const nR = r.n;

const xStep = '            local.get $x i32.const 1 i32.add local.set $x';
r = replaceAll(s, xStep, xStep + '\n            local.get $off i32.const 16 i32.add local.set $off');
s = r.text; const nX = r.n;

console.log('bounds', nB, 'offExpr', nO, 'rows', nR, 'advance', nX);
fs.writeFileSync(p, s);
