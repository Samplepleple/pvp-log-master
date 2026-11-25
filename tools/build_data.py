#!/usr/bin/env python3
"""Build app/data.js (the rankings snapshot bundled with the app) and the app icons.

Usage: build_data.py <downloaded-data-dir> <app-dir> [cp=1500] [icon-rgb=24,44,92]

The data dir holds PvPoke's rankings-<cp>.json and gamemaster pokemon.json and moves.json,
plus PokeAPI's pokemon_species_names.csv (zh.csv), pokemon.csv, moves.csv and move_names.csv.
"""
import csv, json, os, re, struct, sys, time, zlib

src, app = sys.argv[1], sys.argv[2]
cp = sys.argv[3] if len(sys.argv) > 3 else "1500"
ground = tuple(int(x) for x in sys.argv[4].split(",")) if len(sys.argv) > 4 else (24, 44, 92)
FORMS = {
    "Shadow": "暗影", "Alolan": "阿羅拉", "Galarian": "伽勒爾", "Hisuian": "洗翠", "Paldean": "帕底亞",
    "Incarnate": "化身", "Therian": "靈獸", "Origin": "起源", "Altered": "別種", "Female": "雌性", "Male": "雄性",
    "Standard": "標準", "Small": "小", "Average": "中", "Large": "大", "Super": "特大", "Hero": "百戰勇者",
    "Defense": "防禦", "Attack": "攻擊", "Speed": "速度", "Single Strike": "一擊流", "Rapid Strike": "連擊流",
    "50% Forme": "50%", "10% Forme": "10%", "Complete Forme": "完全體", "Aqua": "水瀾種", "Combat": "鬥戰種",
    "Blaze": "火熾種", "Land": "陸上", "Sky": "天空", "Busted": "現形", "Hangry": "空腹", "Sandy": "砂土蓑衣",
    "Plant": "草木蓑衣", "Trash": "垃圾蓑衣", "Sunshine": "晴天", "Overcast": "陰天", "Heat": "加熱", "Mow": "割草",
    "Fan": "旋轉", "Wash": "清洗", "Frost": "結冰", "Midday": "白晝", "Midnight": "黑夜", "Dusk": "黃昏",
    "Baile": "熱辣熱辣", "Pom-Pom": "啪滋啪滋", "Sensu": "輕盈輕盈", "Pa'u": "呼拉呼拉", "Curly": "上翹",
    "Droopy": "下垂", "Stretchy": "平挺", "Shock": "閃電", "Chill": "冰凍", "Douse": "水流", "Burn": "火焰",
    "Resolute": "覺悟", "Aria": "歌聲", "Crowned Shield": "剛鐵之盾", "Crowned Sword": "王者之劍",
    "Dusk Mane": "黃昏之鬃", "Dawn Wings": "拂曉之翼", "Black": "闇黑", "White": "焰白", "Ordinary": "平常",
    "Unbound": "解放", "Blade": "刀劍", "Shield": "盾牌", "Sunny": "太陽", "Rainy": "雨水", "Snowy": "雪雲", "Armored": "裝甲",
}
TYPE_ZH = {"bug": "蟲", "dark": "惡", "dragon": "龍", "electric": "電", "fairy": "妖精", "fighting": "格鬥", "fire": "火",
           "flying": "飛行", "ghost": "幽靈", "grass": "草", "ground": "地面", "ice": "冰", "normal": "一般", "poison": "毒",
           "psychic": "超能力", "rock": "岩石", "steel": "鋼", "water": "水"}
SUFFIX = {"_alolan": "-alola", "_galarian": "-galar", "_hisuian": "-hisui", "_paldean": "-paldea",
          "_crowned_sword": "-crowned", "_crowned_shield": "-crowned", "_dawn_wings": "-dawn", "_dusk_mane": "-dusk",
          "zygarde_10": "zygarde-10", "_complete_forme": "-complete"}


def load(name):
    with open(os.path.join(src, name), encoding="utf8") as f:
        return json.load(f)


gm = {p["speciesId"]: p for p in load("gamemaster_pokemon.json")}
with open(os.path.join(src, "zh.csv"), encoding="utf8") as f:
    zh = {int(r["pokemon_species_id"]): r["name"] for r in csv.DictReader(f) if r["local_language_id"] == "4"}
with open(os.path.join(src, "pokemon.csv"), encoding="utf8") as f:
    sprite_ids = {r["identifier"]: int(r["id"]) for r in csv.DictReader(f)}


def sprite(sid, dex):
    s = sid.replace("_shadow", "")
    for k, v in SUFFIX.items():
        s = s.replace(k, v)
    return sprite_ids.get(s.replace("_", "-"), dex)


with open(os.path.join(src, "moves.csv"), encoding="utf8") as f:
    move_ids = {r["identifier"]: int(r["id"]) for r in csv.DictReader(f)}
with open(os.path.join(src, "move_names.csv"), encoding="utf8") as f:
    move_zh = {int(r["move_id"]): r["name"] for r in csv.DictReader(f) if r["local_language_id"] == "4"}
gm_moves = {m["moveId"]: m for m in load("gamemaster_moves.json")}
MOVE_ALIAS = {"SUPER_POWER": "superpower", "AEGISLASH_CHARGE_AIR_SLASH": "air-slash", "AEGISLASH_CHARGE_PSYCHO_CUT": "psycho-cut",
              "AURA_WHEEL_ELECTRIC": "aura-wheel", "TECHNO_BLAST_NORMAL": "techno-blast"}


def zh_move(mid):
    for prefix, ident in (("HIDDEN_POWER_", "hidden-power"), ("WEATHER_BALL_", "weather-ball")):
        if mid.startswith(prefix):
            return f"{move_zh[move_ids[ident]]}（{TYPE_ZH[mid[len(prefix):].lower()]}）"
    if mid.startswith("TECHNO_BLAST_") and mid != "TECHNO_BLAST_NORMAL":
        return f"{move_zh[move_ids['techno-blast']]}（{TYPE_ZH[gm_moves[mid]['type']]}）"
    ident = MOVE_ALIAS.get(mid, mid.lower().replace("_", "-"))
    return move_zh.get(move_ids.get(ident)) or gm_moves[mid]["name"]


def by_uses(rows):
    rows = sorted(rows, key=lambda m: -(m.get("uses") or 0))
    return [m["moveId"] for m in rows if m["moveId"] in gm_moves]


rows = load(f"rankings_all_overall_rankings-{cp}.json")
species, untranslated, used = {}, set(), set()
for r in rows:
    sid, name = r["speciesId"], r["speciesName"]
    p = gm[sid]
    forms = re.findall(r"\((.*?)\)", name)
    untranslated.update(x for x in forms if x not in FORMS)
    fast, charged = by_uses(r["moves"]["fastMoves"]), by_uses(r["moves"]["chargedMoves"])
    best = [m for m in r["moveset"] if m in gm_moves]
    used.update(fast + charged + best)
    species[sid] = [
        zh.get(p["dex"], name),
        "·".join(FORMS.get(x, x) for x in forms),
        name,
        [t for t in p["types"] if t != "none"],
        sprite(sid, p["dex"]),
        fast,
        charged,
        best,
    ]

moves = {m: [zh_move(m), gm_moves[m]["type"]] for m in sorted(used)}
data = {"updated": int(time.time() * 1000), "species": species, "rank": [r["speciesId"] for r in rows], "moves": moves}
with open(os.path.join(app, "data.js"), "w", encoding="utf8") as f:
    f.write("window.PVP_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
print("species", len(species), "moves", len(moves), "untranslated forms", sorted(untranslated))
print("moves without a Chinese name", [m for m, v in moves.items() if v[0] == gm_moves[m]["name"]])


# App icon: a tally mark (four strokes and a slash) on a deep blue ground.
def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5


def icon(size):
    bg, ink, slash = ground, (240, 244, 252), (255, 196, 61)
    bars = [(x, .27, x, .73) for x in (.30, .43, .56, .69)]
    cut = (.20, .66, .80, .34)
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            u, v = (x + .5) / size, (y + .5) / size
            c = bg
            aa = 1.5 / size
            d = min(seg_dist(u, v, *b) for b in bars) - .034
            if d < aa:
                k = max(0, min(1, .5 - d / aa))
                c = tuple(round(c[i] + (ink[i] - c[i]) * k) for i in range(3))
            d = seg_dist(u, v, *cut) - .034
            if d < aa:
                k = max(0, min(1, .5 - d / aa))
                c = tuple(round(c[i] + (slash[i] - c[i]) * k) for i in range(3))
            raw += bytes(c)

    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


for s in (180, 192, 512):
    with open(os.path.join(app, f"icon-{s}.png"), "wb") as f:
        f.write(icon(s))
