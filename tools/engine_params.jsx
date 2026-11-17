// Verify the 7 parameters exist in the compiled plug-in and time a 1080p frame.
var PLUGIN = "D:\\mossls\\mos\\形变\\\\mos_shake\\dist\\mos_shake\\mos_shake.wasm";
app.run("effect.plugins.load", { path: PLUGIN });

var list = app.run("effect.plugins.list", {});
writeLn("plugins -> " + JSON.stringify(list.plugins.filter(function (p) { return p.id === "mos.shake"; })));

var c = app.project.items.addComp("perf", 1920, 1080, 1, 3, 30);
var solid = c.layers.addSolid([0.2, 0.4, 0.7], "solid", 1920, 1080, 1);
var r = app.run("effect.apply", { layer: solid.id, effect: "mos_shake" });
writeLn("paths -> " + JSON.stringify(r.paths));


app.run("prop.set", { layer: solid.id, path: "effects/#1/amplitude", value: 40 });
app.run("prop.set", { layer: solid.id, path: "effects/#1/rotation", value: 3 });
app.run("time.set", { time: 1.2 });
var t0 = Date.now();
app.run("render.saveCurrentPreview", { comp: c.id, path: "D:\\mossls\\mos\\形变\\\\mos_shake\\build\\out\\engine\\perf.png" });
writeLn("render ms -> " + (Date.now() - t0));
"done";


