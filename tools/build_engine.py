#!/usr/bin/env python3
"""Vendor PvPoke's MIT-licensed battle engine into app/engine, unmodified.

Usage: build_engine.py <downloaded-engine-dir> <app-dir>

Battle.js, Pokemon.js and friends are copied as they are. GameMaster.js needs jQuery and the
PvPoke site, so gm-shim.js replaces it, reusing PvPoke's own getMoveById for the move setup.
"""
import json, os, shutil, sys

src, app = sys.argv[1], sys.argv[2]
out = os.path.join(app, "engine")
os.makedirs(out, exist_ok=True)
for name in ["LICENSE", "Battle.js", "DamageCalculator.js", "Pokemon.js", "ActionLogic.js", "TimelineAction.js", "TimelineEvent.js", "DecisionOption.js"]:
    shutil.copy(os.path.join(src, name), os.path.join(out, name))

gm_src = open(os.path.join(src, "GameMaster.js"), encoding="utf8").read()
start = gm_src.index("object.getMoveById = function(id){")
end = gm_src.index("// Return a move object from the GameMaster file given move ID without any modification")
get_move = gm_src[start:end].rstrip()

shim = """// Stands in for PvPoke's GameMaster.js, which needs jQuery and the PvPoke site.
// getMoveById below is copied from PvPoke's GameMaster.js (MIT, see LICENSE).
var settings = { gamemaster: 'gamemaster', defaultIVs: 'gamemaster', colorblindMode: false, hardMovesetLinks: false };

var GameMaster = (function () {
	var object = { data: null, rankings: {}, pokemonMap: new Map(), moveMap: new Map() };

	object.load = function (data) {
		object.data = data;
		object.pokemonMap = new Map(data.pokemon.map(function (p) { return [p.speciesId, p]; }));
		object.moveMap = new Map(data.moves.map(function (m) { return [m.moveId, m]; }));
	};
	object.getPokemonById = function (id) { return object.pokemonMap.get(id.replace('_xl', '')); };
	object.getCupById = function () { return undefined; };

	%s

	return { getInstance: function () { return object; } };
})();
""" % get_move
with open(os.path.join(out, "gm-shim.js"), "w", encoding="utf8") as f:
    f.write(shim)

gm = json.load(open(os.path.join(src, "gm.json"), encoding="utf8"))
keep = {k: gm[k] for k in ("timestamp", "settings", "pokemon", "moves")}
with open(os.path.join(out, "gamemaster.json"), "w", encoding="utf8") as f:
    json.dump(keep, f, ensure_ascii=False, separators=(",", ":"))
print("engine files", sorted(os.listdir(out)), "gamemaster KB", os.path.getsize(os.path.join(out, "gamemaster.json")) // 1024, gm["timestamp"])
