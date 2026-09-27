const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function game() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes = new Map();
  const element = () => ({
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    textContent: '', innerHTML: '', disabled: false, appendChild() {}
  });
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    createElement: element
  };
  const saved = new Map();
  const context = vm.createContext({
    document,
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value)
    },
    setTimeout() { return 1; },
    Math, Date
  });
  const hook = 'globalThis.api={P,SV,equity,ev5,ev7,cmp,render,showdown,raise,topbar,'
    + 'setState(s){if(s.board)board=s.board;if(s.pot!==undefined)pot=s.pot;'
    + 'if(s.curBet!==undefined)curBet=s.curBet;if(s.acted)acted=s.acted;'
    + 'if(s.turn!==undefined)turn=s.turn;if(s.handOver!==undefined)handOver=s.handOver;'
    + 'if(s.shortOpen!==undefined)shortOpen=s.shortOpen;'
    + 'if(s.lastRaise!==undefined)lastRaise=s.lastRaise},'
    + 'getState(){return{acted,shortOpen,curBet}}};';
  vm.runInContext(script.replace(/\}\)\(\);\s*$/, hook + '})();'), context);
  return { ...context.api, nodes };
}

const C = (r, s) => ({ r, s });

test('three-way board tie earns one third of the pot equity', () => {
  const g = game();
  const board = [C(10, 0), C(11, 0), C(12, 0), C(13, 0), C(14, 0)];
  assert.ok(Math.abs(g.equity([C(2, 1), C(3, 1)], board,
    [{ thr: 0, pIn: 1 }, { thr: 0, pIn: 1 }], 20) - 1 / 3) < 1e-12);
});

test('wheel straight ranks below six-high straight', () => {
  const g = game();
  const wheel = g.ev5([C(14, 0), C(2, 1), C(3, 2), C(4, 0), C(5, 1)]);
  const six = g.ev5([C(2, 0), C(3, 1), C(4, 2), C(5, 0), C(6, 1)]);
  assert.equal(wheel[0], 4);
  assert.ok(g.cmp(six, wheel) > 0);
});

test('a short all-in does not reopen raising for players who already acted', () => {
  const g = game();
  const hero = g.P[0], shortStack = g.P[1];
  hero.ck = 900; hero.bet = 100; hero.paid = 100;
  shortStack.ck = 50; shortStack.bet = 100; shortStack.paid = 100;
  for (const p of g.P.slice(2)) p.fold = true;
  g.setState({ curBet: 100, acted: [hero, shortStack],
    turn: 1, handOver: false, lastRaise: 100 });
  g.raise(shortStack, 100);
  assert.equal(g.getState().curBet, 150);
  assert.ok(g.getState().acted.includes(hero));
  g.setState({ turn: 0 });
  g.render();
  assert.equal(g.nodes.get('rAll').disabled, true);
});

test('a short opening all-in still allows a full raise', () => {
  const g = game();
  const hero = g.P[0], shortStack = g.P[1];
  hero.ck = 900; hero.bet = 0; hero.paid = 0;
  shortStack.ck = 10; shortStack.bet = 0; shortStack.paid = 0;
  for (const p of g.P.slice(2)) p.fold = true;
  g.setState({ curBet: 0, acted: [hero, shortStack],
    turn: 1, handOver: false, lastRaise: 20 });
  g.raise(shortStack, 20);
  g.setState({ turn: 0 });
  g.render();
  assert.equal(g.getState().shortOpen, true);
  assert.equal(g.nodes.get('rAll').disabled, false);
});

test('a side pot respects all-in limits and conserves chips', () => {
  const g = game();
  const board = [C(2, 0), C(5, 1), C(8, 2), C(11, 3), C(13, 0)];
  g.P.forEach(p => { p.fold = true; p.bet = 0; p.paid = 0; p.ck = 2000; });
  const [hero, second, third] = g.P;
  Object.assign(hero, { fold: false, paid: 50, ck: 0, hole: [C(14, 1), C(14, 2)] });
  Object.assign(second, { fold: false, paid: 100, ck: 0, hole: [C(12, 1), C(12, 2)] });
  Object.assign(third, { fold: false, paid: 100, ck: 0, hole: [C(9, 1), C(10, 2)] });
  g.setState({ board, handOver: false });
  g.showdown();
  assert.equal(second.ck, 100);
  assert.equal(third.ck, 0);
  assert.equal(g.SV.coins, 350); // 150 main pot + 200 first-win reward
  assert.equal(hero.ck, g.SV.coins);
});

test('daily bonus cannot be claimed mid-hand and updates the table between hands', () => {
  const g = game();
  g.setState({ handOver: false });
  g.topbar();
  assert.equal(g.nodes.get('bonus').disabled, true);
  g.nodes.get('bonus').onclick();
  assert.equal(g.SV.coins, 2000);
  g.setState({ handOver: true });
  g.topbar();
  g.nodes.get('bonus').onclick();
  assert.equal(g.SV.coins, 2500);
  assert.equal(g.P[0].ck, 2500);
});
