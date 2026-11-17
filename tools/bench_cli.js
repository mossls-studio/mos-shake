// bench_cli.js — time mos_shake in the real engine (headless CLI runs).
// node tools/bench_cli.js [wasm] [frames] [comps,csv]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const CLI = 'C:\\Program Files\\EffectCraft\\effectcraft-cli.exe';
const PROJECT = path.join(root, 'build', 'bench.ecproj');
const OUT = path.join(root, 'build', 'out', 'bench');
const MARSEL = 'C:\\Users\\koggua\\AppData\\Roaming\\EffectCraft\\Plug-ins\\marsel-motion-shake.wasm';
const wasm = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'build', 'new.wasm');
const N = parseInt(process.argv[3] || '6', 10);
const COMPS = (process.argv[4] || 'b_off,b_on,b_3d,b_tile,b_marsel').split(',').filter(Boolean);

fs.mkdirSync(OUT, { recursive: true });

function stepsFor(comp, n) {
  const steps = [{ command: 'effect.plugins.load', params: { path: wasm } }];
  steps.push({ command: 'effect.plugins.load', params: { path: MARSEL } });
  for (let i = 0; i < n; i++) {
    steps.push({
      command: 'comp.saveFrameAs',
      params: { comp, time: 1 + i * 0.0333, path: path.join(OUT, `${comp}_${i}.png`), scale: 1 }
    });
  }
  return steps;
}

function run(steps) {
  const f = path.join(root, 'build', 'bench_steps.json');
  fs.writeFileSync(f, JSON.stringify(steps));
  const t0 = process.hrtime.bigint();
  const r = spawnSync(CLI, ['--project', PROJECT, 'run', '--commands', f], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.status !== 0) {
    console.error('FAIL', r.status, (r.stdout || '').slice(-1500), (r.stderr || '').slice(-800));
    process.exit(1);
  }
  return ms;
}

let startup = Infinity;
for (let i = 0; i < 3; i++) startup = Math.min(startup, run(stepsFor('b_off', 0)));
console.log(`wasm ${path.basename(wasm)} (${fs.statSync(wasm).size} B)  frames ${N}`);
console.log(`startup+open+load: ${startup.toFixed(0)} ms`);

const res = {};
for (const comp of COMPS) {
  let best = Infinity;
  for (let i = 0; i < 2; i++) best = Math.min(best, run(stepsFor(comp, N)));
  const per = (best - startup) / N;
  res[comp] = per;
  console.log(`${comp.padEnd(9)} ${best.toFixed(0).padStart(6)} ms total   ${per.toFixed(1).padStart(8)} ms/frame`);
}
if (res.b_off) {
  console.log('--- kernel only (minus early-out) ---');
  for (const k of COMPS) if (k !== 'b_off') console.log(`${k.padEnd(9)} ${(res[k] - res.b_off).toFixed(1)} ms/frame`);
}
fs.writeFileSync(path.join(root, 'build', 'out', `bench_${path.basename(wasm, '.wasm')}.json`),
  JSON.stringify({ wasm, N, startup, res }, null, 2));
