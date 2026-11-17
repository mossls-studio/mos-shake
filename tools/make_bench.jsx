// make_bench.jsx — builds build/bench.ecproj with 1920x1080 timing comps.
// run: effectcraft-cli --empty --save-as build\bench.ecproj script tools\make_bench.jsx
var ROOT = "D:\\mossls\\mos\\形变\\mos_shake";
app.run("effect.plugins.load", { path: ROOT + "\\build\\new.wasm" });

function mk(name, p) {
  var comp = app.project.items.addComp(name, 1920, 1080, 1, 4, 30);
  comp.layers.addSolid([0.12, 0.32, 0.55], "bg", 1920, 1080, 1, 4);
  var txt = comp.layers.addText("mos_shake performance test 0123456789");
  txt.property("ADBE Transform Group").property("ADBE Position").setValue([960, 540]);
  var adj = comp.layers.addSolid([0, 0, 0], "ADJ", 1920, 1080, 1, 4);
  adj.adjustmentLayer = true;
  app.run("effect.apply", { effect: "mos.shake", layers: [adj.id], comp: comp.id });
  var eff = adj.property("ADBE Effect Parade").property(1);
  eff.property("抖动幅度").setValue(p.amp);
  eff.property("抖动频率(Hz)").setValue(2);
  eff.property("抖动平滑度").setValue(80);
  eff.property("抖动的旋转度").setValue(p.rot);
  eff.property("三轴旋转 X/Y/Z").setValue(!!p.r3d);
  eff.property("运动模糊").setValue(!!p.mb);
  eff.property("拼贴模式").setValue(!!p.tile);
  if (p.samples) eff.property("模糊采样数").setValue(p.samples);
  writeLn(name + " id=" + comp.id + " amp=" + p.amp + " rot=" + p.rot + " 3d=" + !!p.r3d + " mb=" + !!p.mb + " tile=" + !!p.tile);
  return comp;
}

mk("b_off", { amp: 0, rot: 0 });
mk("b_on", { amp: 34, rot: 1.4 });
mk("b_3d", { amp: 34, rot: 1.4, r3d: true });
mk("b_tile", { amp: 34, rot: 1.4, tile: true });
mk("b_blur", { amp: 34, rot: 1.4, mb: true, samples: 8 }); mk("b_blur4", { amp: 34, rot: 1.4, mb: true, samples: 4 });
mk("b_blur3d", { amp: 34, rot: 1.4, mb: true, r3d: true });

// third-party comparison: Marsel Shake (installed plug-in)
var MARSEL = "C:\\Users\\koggua\\AppData\\Roaming\\EffectCraft\\Plug-ins\\marsel-motion-shake.wasm";
if (app.run("effect.plugins.load", { path: MARSEL }).errors.length === 0) {
  var comp = app.project.items.addComp("b_marsel", 1920, 1080, 1, 4, 30);
  comp.layers.addSolid([0.12, 0.32, 0.55], "bg", 1920, 1080, 1, 4);
  var txt = comp.layers.addText("marsel shake comparison");
  txt.property("ADBE Transform Group").property("ADBE Position").setValue([960, 540]);
  var adj = comp.layers.addSolid([0, 0, 0], "ADJ", 1920, 1080, 1, 4);
  adj.adjustmentLayer = true;
  app.run("effect.apply", { effect: "org.marsel.move.shake", layers: [adj.id], comp: comp.id });
  var me = adj.property("ADBE Effect Parade").property(1);
  try { me.property("amount").setValue(34); } catch (e) { writeLn("marsel amount: " + e); }
  try { me.property("rotation").setValue(1.4); } catch (e) {}
  writeLn("b_marsel id=" + comp.id + " effect=" + me.name);
} else {
  writeLn("marsel load failed");
}
"built";
