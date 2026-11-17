// bench.jsx — engine-side per-frame timing for mos_shake (single frame renders)
// usage: effectcraft-cli script tools\bench.jsx
var ROOT = "D:\\mossls\\mos\\形变\\mos_shake";
var OUT = ROOT + "\\build\\out\\bench\\";
var PLUGIN = ROOT + "\\build\\new.wasm";
var W = 1920, H = 1080;

function now() { return new Date().getTime(); }

app.run("effect.plugins.load", { path: PLUGIN });
var comp = app.project.items.addComp("bench", W, H, 1, 4, 30);
comp.layers.addSolid([0.15, 0.35, 0.6], "bg", W, H, 1, 4);
var txt = comp.layers.addText("mos_shake performance");
txt.property("ADBE Transform Group").property("ADBE Position").setValue([W / 2, H / 2]);
var adj = comp.layers.addSolid([0, 0, 0], "ADJ", W, H, 1, 4);
adj.adjustmentLayer = true;
app.run("effect.apply", { effect: "mos.shake", layers: [adj.id] });
var parade = adj.property("ADBE Effect Parade");
var eff = parade.property(1);
writeLn("comp=" + comp.name + " " + comp.width + "x" + comp.height + " layers=" + comp.numLayers + " effects=" + parade.numProperties);
function setp(n, v) { eff.property(n).setValue(v); }

function once(label, t) {
  var t0 = now();
  app.run("comp.saveFrameAs", { comp: comp.id, path: OUT + label + ".png", time: t, scale: 1 });
  return now() - t0;
}
function bench(label, n) {
  once(label + "_warm", 0.5);
  var times = [];
  for (var i = 0; i < n; i++) times.push(once(label, 1.0 + i * 0.0333));
  times.sort(function (a, b) { return a - b; });
  writeLn(label + ": min " + times[0] + " ms  med " + times[Math.floor(times.length / 2)] + " ms  all " + times.join(","));
}

setp("抖动幅度", 34); setp("抖动频率(Hz)", 2); setp("抖动平滑度", 80); setp("抖动的旋转度", 1.4);

setp("抖动幅度", 0); setp("抖动的旋转度", 0); setp("三轴旋转 X/Y/Z", false); setp("运动模糊", false); setp("拼贴模式", false);
bench("earlyout", 5);

setp("抖动幅度", 34); setp("抖动的旋转度", 1.4);
bench("plain", 5);

setp("三轴旋转 X/Y/Z", true);
bench("3d", 5);

setp("三轴旋转 X/Y/Z", false); setp("拼贴模式", true);
bench("tile", 5);

setp("拼贴模式", false); setp("运动模糊", true);
bench("blur", 3);

writeLn("done");
