// Engine-side timing for mos_shake (single process: the plug-in must be loaded
// explicitly, effectcraft-cli does not scan the Plug-ins folder).
// Run: effectcraft-cli script tools\perf_check.jsx --empty
var PLUGIN = "C:\\Users\\koggua\\AppData\\Roaming\\EffectCraft\\Plug-ins\\mos_shake.wasm";
var OUT = "D:\\mossls\\mos\\形变\\\\mos_shake\\build\\out\\perf\\";

var proj = "D:\\mossls\\mos\\形变\\\\mos_shake\\demo\\mos_shake_demo.ecproj";

app.run("effect.plugins.load", { path: PLUGIN });
app.open(proj);
var comp = app.project.activeItem;
var adj = null;
for (var i = 1; i <= comp.numLayers; i++) {
  var L = comp.layer(i);
  if (L.adjustmentLayer) { adj = L; break; }
}
writeLn("comp=" + comp.name + " layers=" + comp.numLayers + " adj=" + (adj ? adj.name : "none"));

function timed(label, path) {
  var t0 = new Date().getTime();
  var r = app.run("render.saveCurrentPreview", { path: path });
  var ms = new Date().getTime() - t0;
  writeLn(label + ": " + ms + " ms, " + r.frames + " frames, " + (ms / r.frames).toFixed(1) + " ms/frame");
  return ms / r.frames;
}

var eff = adj.property("ADBE Effect Parade").property(1);
function setp(name, v) { eff.property(name).setValue(v); }

// 1) baseline: effect present but disabled (amp 0, rotation 0 -> early out)
setp("抖动幅度", 0); setp("抖动的旋转度", 0);
timed("noop  ", OUT + "noop.png");

// 2) default shake, no motion blur
setp("抖动幅度", 34); setp("抖动频率(Hz)", 2.0); setp("抖动平滑度", 80);
setp("抖动的旋转度", 1.4); setp("运动模糊", false);
timed("shake ", OUT + "shake.png");

// 3) shake + motion blur
setp("运动模糊", true);
timed("blur  ", OUT + "blur.png");
"done";
