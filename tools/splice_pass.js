// splice build/pass_new.wat into src/mos_shake.wat, replacing the old $pass
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const srcPath = path.join(root, 'src', 'mos_shake.wat');
let src = fs.readFileSync(srcPath, 'utf8');
const repl = fs.readFileSync(path.join(root, 'build', 'pass_new.wat'), 'utf8').replace(/\r\n/g, '\n');

const startMark = '  (func $pass (param $accum i32)';
const endMark = '  ;; ================= ABI =================';
const i = src.indexOf(startMark);
const j = src.indexOf(endMark);
if (i < 0 || j < 0 || j < i) throw new Error('markers not found');
src = src.slice(0, i) + repl + src.slice(j);

// dispatch: affine path when the denominator is constant
const oldCall = `    (else
      local.get $time call $setT
      i32.const 0 call $pass))`;
if (!src.includes(oldCall)) throw new Error('ec_render else-branch not found');
src = src.replace(oldCall, `    (else
      local.get $time call $setT
      global.get $EQ3D
      (if (then i32.const 0 call $passA) (else i32.const 0 call $passP))))`);

// motion blur loop dispatch as well
const oldMb = `          local.get $ti call $setT
          i32.const 1 call $pass`;
if (!src.includes(oldMb)) throw new Error('blur loop call not found');
src = src.replace(oldMb, `          local.get $ti call $setT
          global.get $EQ3D
          (if (then i32.const 1 call $passA) (else i32.const 1 call $passP))`);

fs.writeFileSync(srcPath, src);
console.log('spliced', src.length, 'bytes');
