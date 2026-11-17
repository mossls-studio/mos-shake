var list = app.run("effect.plugins.list", {});
var mine = list.plugins.filter(function (p) { return p.id === "mos.shake"; });
writeLn("auto-loaded from Plug-ins -> " + JSON.stringify(mine));
var c = app.project.items.addComp("auto", 320, 180, 1, 2, 30);
var s = c.layers.addSolid([0.2, 0.5, 0.3], "s", 320, 180, 1);
var r = app.run("effect.apply", { layer: s.id, effect: "mos_shake" });
writeLn("apply -> " + JSON.stringify(r));
"ok";
