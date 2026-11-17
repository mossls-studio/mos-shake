// Isolates the per-frame kernel cost: the same comp rendered with the effect
// returning immediately (amp=0, rot=0) versus doing real work. The engine and
// PNG encoding cost cancel out, so the delta is what the plug-in actually costs.
// Run: effectcraft-cli script tools\perf_ab.jsx --empty
var WASM = "D:\\mossls\\mos\\形变\\\\mos_shake\\build\\new.wasm";
var OUT = "D:\\mossls\\mos\\形变\\\\mos_shake\\build\\out\\perf_ab\\";
var proj = "D:\\mossls\\mos\\形变\\\\mos_shake\\demo\\mos_shake_demo.ecproj";
var N = 60;

app.run("effect.plugins.load", { path: WASM });
app.open(proj);
var comp = app.project.activeItem;
var adj = null;
for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).adjustmentLayer) adj = comp.layer(i);

function set(k, v) { app.run("prop.set", { layer: adj.id, path: "effects/#1/" + k, value: v }); }

function measure(tag) {
  var t0 = (new Date()).getTime();
  app.run("render.saveCurrentPreview", { path: OUT + tag + ".png" });
  var ms = (new Date()).getTime() - t0;
  return { tag: tag, ms: ms, per: ms / 120 };
}

// idle: the plug-in returns before touching a pixel
set("amplitude", 0); set("rotation", 0); set("motion_blur", false);
var idle = measure("idle");

// real work
set("amplitude", 34); set("rotation", 1.4); set("rot3d", true); set("tile", true);
var shake = measure("shake");

// real work + motion blur
set("motion_blur", true);
var blur = measure("blur");

var lines = [
  "comp " + comp.width + "x" + comp.height,
  "idle  " + idle.per.toFixed(1) + " ms/frame (engine + encode)",
  "shake " + shake.per.toFixed(1) + " ms/frame  -> kernel " + (shake.per - idle.per).toFixed(1),
  "blur  " + blur.per.toFixed(1) + " ms/frame  -> kernel " + (blur.per - idle.per).toFixed(1)
];
lines.join("\n");
