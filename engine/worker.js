// Runs PvPoke's random bulk simulation off the main thread. The steps and the picks below follow
// generateBulkSims in PvPoke's Interface.js, which powers its "Explore Win Conditions" view.
importScripts('gm-shim.js', 'Pokemon.js', 'DamageCalculator.js', 'ActionLogic.js', 'TimelineEvent.js', 'TimelineAction.js', 'DecisionOption.js', 'Battle.js');

const SIMS = 1000, CP = 10000;
const gameData = (async () => {
  const live = await caches.match('gamemaster-live').catch(() => null);
  const data = await (live || await fetch('gamemaster.json')).json();
  GameMaster.getInstance().load(data);
})();

function makePokemon(side, index, battle) {
  const p = new Pokemon(side.id, index, battle);
  if (!p.data) throw new Error('unknown ' + side.id);
  p.initialize(CP, 'gamemaster');
  const [fast, ...charged] = side.moves;
  p.selectMove('fast', fast);
  charged.forEach((m, i) => p.selectMove('charged', m, i));
  p.setShields(side.shields);
  return p;
}

function bulk(me, opp) {
  const base = new Battle();
  base.setCP(CP);
  const pokes = [makePokemon(me, 0, base), makePokemon(opp, 1, base)];
  const ratings = [];
  for (let i = 0; i < SIMS; i++) {
    const b = new Battle();
    b.setCP(CP);
    b.setBuffChanceModifier(0);
    b.setDecisionMethod('random');
    b.setNewPokemon(pokes[0], 0, false);
    b.setNewPokemon(pokes[1], 1, false);
    b.simulate();
    ratings.push(b.getPokemon()[0].getBattleRating());
  }
  const sorted = ratings.sort((a, b) => b - a);
  const wins = sorted.filter(r => r >= 500), losses = sorted.filter(r => r < 500);
  return {
    best: sorted[0],
    median: sorted[Math.floor(SIMS / 2)],
    worst: sorted[sorted.length - 1],
    medianWin: wins.length ? wins[Math.floor(wins.length / 2)] : null,
    medianLoss: losses.length ? losses[Math.floor(losses.length / 2)] : null,
  };
}

self.onmessage = async e => {
  const { key, me, opp } = e.data;
  try {
    await gameData;
    self.postMessage({ key, result: bulk(me, opp) });
  } catch (err) {
    self.postMessage({ key, error: String(err) });
  }
};
