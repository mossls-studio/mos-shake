// The interior test must be "outside the safe area": the branch taken when the
// condition is true is the border sampler.  Unsigned compares fold the two
// per-axis signed tests into one.
const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'src', 'mos_shake.wat');
let s = fs.readFileSync(p, 'utf8');

const lines = s.split('\n');
const out = [];
let n = 0;
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  const t2 = (lines[i + 1] || '').trim();
  if (t === 'local.get $ix local.get $Wm1 i32.lt_u' && t2 === 'local.get $iy local.get $Hm1 i32.lt_u i32.and') {
    const indent = lines[i].match(/^\s*/)[0];
    out.push(indent + 'local.get $ix local.get $Wm1 i32.ge_u');
    out.push(indent + 'local.get $iy local.get $Hm1 i32.ge_u i32.or');
    i++;
    n++;
    continue;
  }
  out.push(lines[i]);
}
fs.writeFileSync(p, out.join('\n'));
console.log('patched', n);
