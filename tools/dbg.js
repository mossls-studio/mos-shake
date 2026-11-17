const fs = require('fs');
const s = fs.readFileSync('src/mos_shake.wat', 'utf8');
const i = s.indexOf('$MB');
console.log(JSON.stringify(s.slice(i - 60, i + 40)));
console.log('marker at', s.indexOf('    global.get $MB\n'));
const lines = s.split('\n');
lines.forEach((l, n) => { if (l.includes('$MB')) console.log(n + 1, JSON.stringify(l)); });
