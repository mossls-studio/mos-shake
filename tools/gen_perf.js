// generate tools/perf_old.jsx and tools/perf_new.jsx from tools/perf_check.jsx
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const base = fs.readFileSync(path.join(root, 'tools', 'perf_check.jsx'), 'utf8');
for (const n of ['old', 'new']) {
  const wasm = path.join(root, 'build', n + '.wasm');
  const out = path.join(root, 'build', 'out', 'perf_' + n) + '\\';
  let s = base
    .replace(/^var PLUGIN = .*$/m, 'var PLUGIN = ' + JSON.stringify(wasm) + ';')
    .replace(/^var OUT = .*$/m, 'var OUT = ' + JSON.stringify(out) + ';');
  fs.writeFileSync(path.join(root, 'tools', 'perf_' + n + '.jsx'), s);
  console.log(n, wasm, out);
}
