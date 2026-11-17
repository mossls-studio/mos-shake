// Headless smoke test for the mos_shake effect plug-in (fresh CLI process).
var PLUGIN = "D:\\mossls\\mos\\形变\\\\mos_shake\\dist\\mos_shake\\mos_shake.wasm";
var OUT = "D:\\mossls\\mos\\形变\\\\mos_shake\\build\\out\\engine";
app.run("effect.plugins.load", { path: PLUGIN });

var c = app.project.items.addComp("shake_test", 640, 360, 1, 3, 30);
c.layers.addSolid([0.10, 0.16, 0.28], "bg", 640, 360, 1);
var title = c.layers.addText("MOS SHAKE");
title.property("ADBE Transform Group").property("ADBE Position").setValue([320, 180]);
var t = title.property("ADBE Text Properties").property("ADBE Text Document");
var doc = t.value;
doc.fontSize = 72;
doc.fillColor = [1, 1, 1];
t.setValue(doc);

var res = app.run("effect.apply", { layer: title.id, effect: "mos_shake" });
writeLn("apply -> " + JSON.stringify(res.params || res));

app.run("prop.set", { layer: title.id, path: "effects/#1/amplitude", value: 160 });
app.run("prop.set", { layer: title.id, path: "effects/#1/rate", value: 3 });
app.run("prop.set", { layer: title.id, path: "effects/#1/rotation", value: 20 });
app.run("prop.set", { layer: title.id, path: "effects/#1/rot3d", value: true });
app.run("prop.set", { layer: title.id, path: "effects/#1/tile", value: true });

var shots = [
  ["a-1s", 1.0],
  ["b-2s", 2.0],
  ["c-25fps-blur", 2.5],
];
for (var i = 0; i < shots.length; i++) {
  app.run("time.set", { time: shots[i][1] });
  if (shots[i][0] === "c-25fps-blur") app.run("prop.set", { layer: title.id, path: "effects/#1/motion_blur", value: true });
  var r = app.run("render.saveCurrentPreview", { comp: c.id, path: OUT + "\\" + shots[i][0] + ".png" });
  writeLn(shots[i][0] + " -> " + JSON.stringify(r));
}
"done";
