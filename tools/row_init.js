// initialise $off at the start of each row (the per-store rebuild is gone)
const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'src', 'mos_shake.wat');
let s = fs.readFileSync(p, 'utf8');
const from = 'local.set $rowdst\n        i32.const 0 local.set $x';
const to = 'local.set $rowdst\n        local.get $rowdst local.set $off\n        i32.const 0 local.set $x';
const parts = s.split(from);
s = parts.join(to);
fs.writeFileSync(p, s);
console.log('row inits', parts.length - 1);
