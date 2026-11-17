// probe: project + plug-in ABI + effect instance
var root = "D:\\mossls\\mos\\形变\\mos_shake";
writeLn("== plugins before ==");
try { writeLn(JSON.stringify(app.run("effect.plugins.list", {}))); } catch (e) { writeLn("ERR " + e); }
var r = app.run("effect.plugins.load", { path: root + "\\build\\new.wasm" });
writeLn("load: " + JSON.stringify(r));
writeLn("== plugins after ==");
writeLn(JSON.stringify(app.run("effect.plugins.list", {})));
app.open(root + "\\demo\\mos_shake_demo.ecproj");
var comp = app.project.activeItem;
writeLn("comp " + comp.name + " " + comp.width + "x" + comp.height + " fps=" + comp.frameRate + " dur=" + comp.duration);
for (var i = 1; i <= comp.numLayers; i++) {
  var L = comp.layer(i);
  writeLn("  #" + i + " " + L.name + " type=" + L.matchName + " adj=" + L.adjustmentLayer + " in=" + L.inPoint + " out=" + L.outPoint);
}
var adj = null;
for (var i = 1; i <= comp.numLayers; i++) { var L = comp.layer(i); if (L.adjustmentLayer) { adj = L; break; } }
if (adj) {
  var parade = adj.property("ADBE Effect Parade");
  writeLn("effects=" + parade.numProperties);
  for (var e = 1; e <= parade.numProperties; e++) {
    var eff = parade.property(e);
    writeLn("  effect " + e + " " + eff.matchName + " / " + eff.name + " enabled=" + eff.enabled);
    for (var p = 1; p <= eff.numProperties; p++) {
      var pr = eff.property(p);
      writeLn("    p" + p + " " + pr.matchName + " '" + pr.name + "' = " + pr.value);
    }
  }
}
writeLn("done");
