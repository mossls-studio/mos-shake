// Compare mos_shake against a third-party shake plug-in in the same engine.
// Run: effectcraft-cli script tools\perf_marsel.jsx --empty
var MOS = "D:\\mossls\\mos\\形变\\\\mos_shake\\build\\new.wasm";
var MAR = "C:\\Users\\koggua\\AppData\\Roaming\\EffectCraft\\Plug-ins\\marsel-motion-shake.wasm";
var OUT = "D:\\mossls\\mos\\形变\\\\mos_shake\\build\\out\\perf_marsel\\";
var proj = "D:\\mossls\\mos\\形变\\\\mos_shake\\demo\\mos_shake_demo.ecproj";

function timeIt(tag, setup) {
  setup();
  var t0 = (new Date()).getTime();
  app.run("render.saveCurrentPreview", { path: OUT + tag + ".png" });
  var ms = (new Date()).getTime() - t0;
  return tag + ": " + ms + " ms, " + (ms / 120).toFixed(1) + " ms/frame";
}

app.run("effect.plugins.load", { path: MAR });
app.open(proj);
var comp = app.project.activeItem;
var adj = null;
for (var i = 1; i <= comp.numLayers; i++) {
  if (comp.layer(i).adjustmentLayer) adj = comp.layer(i);
}

var res = [];
res.push("adj=" + adj.name + " layers=" + comp.numLayers);

// baseline: adjustment layer without any effect
res.push(timeIt("none", function () {}));

// third-party shake
function marsel() {
  app.run("effect.apply", { layer: adj.id, effect: "Marsel Shake" });
}
res.push(timeIt("marsel", marsel));
app.run("effect.remove", { layer: adj.id, effect: "Marsel Shake" });

// mos_shake without motion blur
app.run("effect.plugins.load", { path: MOS });
app.run("effect.apply", { layer: adj.id, effect: "mos_shake" });
app.run("prop.set", { layer: adj.id, path: "effects/#1/motion_blur", value: false });
res.push(timeIt("mos", function () {}));
app.run("prop.set", { layer: adj.id, path: "effects/#1/motion_blur", value: true });
res.push(timeIt("mos_blur", function () {}));

res.join("\n");
