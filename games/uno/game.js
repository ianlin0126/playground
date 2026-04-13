'use strict';

// ── Card definitions ────────────────────────────────────────
const COLORS  = ['red', 'blue', 'green', 'yellow'];
const ACTIONS = ['skip', 'reverse', 'draw2'];
const WILDS   = ['wild', 'wild4'];

const SYMBOLS = {
  skip: '⊘', reverse: '↺', draw2: '+2', wild: '★', wild4: '+4',
  '0':'0','1':'1','2':'2','3':'3','4':'4',
  '5':'5','6':'6','7':'7','8':'8','9':'9',
};

const COLOR_HEX = {
  red: '#e74c3c', blue: '#3498db', green: '#2ecc71', yellow: '#f1c40f',
};

// ── Build & shuffle ─────────────────────────────────────────
function buildDeck() {
  const deck = [];
  let id = 0;
  for (const color of COLORS) {
    // One 0, two of each 1-9 and each action card
    deck.push({ id: id++, color, value: '0' });
    for (const value of ['1','2','3','4','5','6','7','8','9', ...ACTIONS]) {
      deck.push({ id: id++, color, value });
      deck.push({ id: id++, color, value });
    }
  }
  // Four each of Wild and Wild Draw Four
  for (let i = 0; i < 4; i++) {
    deck.push({ id: id++, color: 'wild', value: 'wild' });
    deck.push({ id: id++, color: 'wild', value: 'wild4' });
  }
  return deck; // 108 cards total
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Game state ──────────────────────────────────────────────
// G is the single source of truth for the whole game.
let G = {};

function newGame() {
  const deck = shuffle(buildDeck());
  const hands = [deck.splice(0, 7), deck.splice(0, 7)]; // [player, cpu]

  // Pick a number card as the starting discard so no action fires on turn 1
  let si = deck.findIndex(c => COLORS.includes(c.color) && /^\d$/.test(c.value));
  if (si === -1) si = 0;
  const [startCard] = deck.splice(si, 1);

  G = {
    deck,
    discard:       [startCard],
    hands,                       // hands[0]=player, hands[1]=cpu
    activeColor:   startCard.color,
    activeValue:   startCard.value,
    currentPlayer: 0,            // 0=human, 1=cpu
    phase:         'playing',    // 'playing' | 'pickColor' | 'over'
    winner:        null,
    pendingWild:   null,         // { playerIdx, card } during pickColor phase
    msg:           'Your turn! Tap a glowing card to play it, or tap the draw pile.',
  };
  render();
}

// ── Core helpers ────────────────────────────────────────────
function topCard() { return G.discard[G.discard.length - 1]; }

function isPlayable(card) {
  if (WILDS.includes(card.value)) return true;
  if (card.color === G.activeColor) return true;
  if (card.value === G.activeValue) return true;
  return false;
}

// Reshuffle the discard pile (minus the top card) back into the draw pile
function refillIfNeeded() {
  if (G.deck.length > 0) return;
  const top = G.discard.pop();
  G.deck = shuffle(G.discard);
  G.discard = [top];
}

function drawCards(playerIdx, n) {
  for (let i = 0; i < n; i++) {
    refillIfNeeded();
    if (G.deck.length) G.hands[playerIdx].push(G.deck.pop());
  }
}

function switchTurn() {
  G.currentPlayer = G.currentPlayer === 0 ? 1 : 0;
}

// ── Play a card ─────────────────────────────────────────────
// Called for both the human (playerIdx=0) and the CPU (playerIdx=1).
function playCard(playerIdx, card) {
  const hand = G.hands[playerIdx];
  const idx  = hand.findIndex(c => c.id === card.id);
  if (idx === -1) return;

  hand.splice(idx, 1);
  G.discard.push(card);
  G.activeValue = card.value;

  if (hand.length === 1) {
    G.msg = (playerIdx === 0 ? 'You say' : 'Computer says') + ' UNO! 🃏';
  }

  // Win condition
  if (hand.length === 0) {
    G.phase  = 'over';
    G.winner = playerIdx;
    render();
    return;
  }

  // Wild cards need a color choice before effects resolve
  if (WILDS.includes(card.value)) {
    G.activeColor  = 'wild';
    G.pendingWild  = { playerIdx, card };
    G.phase        = 'pickColor';
    render();
    if (playerIdx === 1) {
      // CPU picks the color it has the most of
      setTimeout(() => resolveColor(cpuPickColor(G.hands[1])), 700);
    }
    return;
  }

  // Colored card: apply effects
  G.activeColor = card.color;
  applyCardEffect(card, playerIdx);
}

// Apply Skip / Reverse / Draw 2 after a colored card is played.
// For Wild cards the effect is applied inside resolveColor().
function applyCardEffect(card, playerIdx) {
  const opponent   = playerIdx === 0 ? 1 : 0;
  const playerName = playerIdx === 0 ? 'You' : 'Computer';
  const oppName    = playerIdx === 0 ? 'Computer' : 'You';

  if (card.value === 'skip') {
    // With 2 players, Skip = current player goes again
    G.msg = `${playerName} played Skip! ${oppName} ${opponent===0?'lose':'loses'} a turn.`;
    render();
    scheduleIfCpu();
    return;
  }

  if (card.value === 'reverse') {
    // With 2 players, Reverse = current player goes again
    G.msg = `${playerName} played Reverse! ${playerName} ${playerIdx===0?'go':'goes'} again!`;
    render();
    scheduleIfCpu();
    return;
  }

  if (card.value === 'draw2') {
    drawCards(opponent, 2);
    G.msg = `${playerName} played Draw 2! ${oppName} draw${opponent===0?'':'s'} 2 cards and lose${opponent===0?'':'s'} a turn!`;
    render();
    scheduleIfCpu();
    return;
  }

  // Normal number card: hand off to the other player
  switchTurn();
  G.msg = G.currentPlayer === 0
    ? 'Your turn! Tap a glowing card to play it, or tap the draw pile.'
    : 'Computer is thinking...';
  render();
  if (G.currentPlayer === 1) setTimeout(cpuTurn, 1100);
}

// Finish resolving a Wild or Wild Draw Four after a color is chosen.
function resolveColor(color) {
  G.activeColor = color;
  G.phase       = 'playing';

  const { playerIdx, card } = G.pendingWild;
  G.pendingWild = null;

  const opponent   = playerIdx === 0 ? 1 : 0;
  const playerName = playerIdx === 0 ? 'You' : 'Computer';
  const oppName    = playerIdx === 0 ? 'Computer' : 'You';

  if (card.value === 'wild4') {
    drawCards(opponent, 4);
    G.msg = `${playerName} played Wild +4 (${color})! ${oppName} draw${opponent===0?'':'s'} 4 cards and lose${opponent===0?'':'s'} a turn!`;
    // Current player goes again (opponent is skipped)
    render();
    scheduleIfCpu();
  } else {
    G.msg = `${playerName} picked ${color}!`;
    switchTurn();
    G.msg += G.currentPlayer === 0 ? ' Your turn!' : ' Computer\'s turn...';
    render();
    if (G.currentPlayer === 1) setTimeout(cpuTurn, 1100);
  }
}

// If it's the CPU's turn right now, schedule the next CPU action.
function scheduleIfCpu() {
  if (G.currentPlayer === 1) setTimeout(cpuTurn, 1100);
}

// ── Player: draw a card ─────────────────────────────────────
function playerDraw() {
  if (G.phase !== 'playing' || G.currentPlayer !== 0) return;

  const before = G.hands[0].length;
  drawCards(0, 1);

  if (G.hands[0].length === before) {
    // Deck truly empty (very rare)
    G.msg = "The deck is empty — no card to draw!";
    render();
    return;
  }

  const drawn = G.hands[0][G.hands[0].length - 1];

  if (isPlayable(drawn)) {
    G.msg = 'You drew a card — playing it for you!';
    render();
    setTimeout(() => playCard(0, drawn), 500);
  } else {
    G.msg = "Drawn card can't be played. Computer's turn!";
    switchTurn();
    render();
    setTimeout(cpuTurn, 1100);
  }
}

// ── CPU AI ──────────────────────────────────────────────────
function cpuTurn() {
  if (G.phase !== 'playing' || G.currentPlayer !== 1) return;

  const hand     = G.hands[1];
  const playable = hand.filter(isPlayable);

  if (!playable.length) {
    const before = hand.length;
    drawCards(1, 1);
    G.msg = 'Computer draws a card...';
    render();

    const drawn = hand[hand.length - 1];
    if (hand.length > before && isPlayable(drawn)) {
      G.msg = 'Computer drew and plays it!';
      render();
      setTimeout(() => playCard(1, drawn), 700);
    } else {
      G.msg = 'Computer draws and passes. Your turn!';
      switchTurn();
      render();
    }
    return;
  }

  // Strategy: prefer action cards on matching color, then numbers, then wilds
  const priority = card => {
    if (card.color === G.activeColor && card.value === 'draw2')   return 7;
    if (card.color === G.activeColor && card.value === 'skip')    return 6;
    if (card.color === G.activeColor && card.value === 'reverse') return 5;
    if (card.color === G.activeColor)                             return 4;
    if (card.value === G.activeValue && ACTIONS.includes(card.value)) return 3;
    if (card.value === G.activeValue)                             return 2;
    if (card.value === 'wild')                                    return 1;
    if (card.value === 'wild4')                                   return 0;
    return -1;
  };

  playable.sort((a, b) => priority(b) - priority(a));
  const chosen = playable[0];
  const colorLabel = chosen.color !== 'wild' ? chosen.color + ' ' : '';
  G.msg = `Computer plays a ${colorLabel}${cardLabel(chosen)}!`;
  render();
  setTimeout(() => playCard(1, chosen), 650);
}

function cpuPickColor(hand) {
  const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
  for (const c of hand) if (counts[c.color] !== undefined) counts[c.color]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Rendering helpers ───────────────────────────────────────
function cardLabel(card) {
  return { skip:'Skip', reverse:'Reverse', draw2:'Draw 2', wild:'Wild', wild4:'Wild +4' }[card.value] ?? card.value;
}

function makeCardEl(card, { faceDown = false, playable = false, dim = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card';

  if (faceDown) {
    el.classList.add('card-back');
    el.innerHTML = '<span class="back-label">UNO</span>';
    return el;
  }

  // Wild cards on the discard pile display the chosen active color
  let displayColor = card.color;
  if (WILDS.includes(card.value) && G.activeColor && G.activeColor !== 'wild') {
    displayColor = G.activeColor;
  }

  el.classList.add(`card-${displayColor}`);
  if (playable) el.classList.add('card-playable');
  if (dim)      el.classList.add('card-dim');

  const sym = SYMBOLS[card.value] ?? card.value;
  el.innerHTML = `
    <span class="c-tl">${sym}</span>
    <span class="c-mid">${sym}</span>
    <span class="c-br">${sym}</span>
  `;

  if (playable) {
    el.addEventListener('click', () => {
      if (G.phase === 'playing' && G.currentPlayer === 0) playCard(0, card);
    });
  }
  return el;
}

// ── Main render ─────────────────────────────────────────────
function render() {
  renderBanner();
  renderCpuHand();
  renderPlayerHand();
  renderDiscardPile();
  renderColorDot();
  renderDrawPile();
  renderMessage();
  renderModals();
}

function renderBanner() {
  const banner = document.getElementById('turn-banner');
  const text   = document.getElementById('turn-text');
  if (G.phase === 'over') {
    banner.className = '';
    text.textContent = 'Game Over!';
  } else if (G.currentPlayer === 0) {
    banner.className = 'your-turn';
    text.textContent = '⭐ Your Turn!';
  } else {
    banner.className = 'cpu-turn';
    text.textContent = "🤖 Computer's Turn...";
  }
}

function renderCpuHand() {
  const el = document.getElementById('cpu-hand');
  el.innerHTML = '';
  G.hands[1].forEach(() => el.appendChild(makeCardEl({}, { faceDown: true })));
  const n = G.hands[1].length;
  document.getElementById('cpu-count').textContent = `${n} card${n !== 1 ? 's' : ''}`;
}

function renderPlayerHand() {
  const el       = document.getElementById('player-hand');
  const isMyTurn = G.phase === 'playing' && G.currentPlayer === 0;
  el.innerHTML   = '';
  G.hands[0].forEach(card => {
    const playable = isMyTurn && isPlayable(card);
    const dim      = isMyTurn && !playable;
    el.appendChild(makeCardEl(card, { playable, dim }));
  });
  const n = G.hands[0].length;
  document.getElementById('player-count').textContent = `${n} card${n !== 1 ? 's' : ''}`;
}

function renderDiscardPile() {
  const el = document.getElementById('discard-top');
  el.innerHTML = '';
  const top = topCard();
  if (top) el.appendChild(makeCardEl(top));
}

function renderColorDot() {
  const dot = document.getElementById('color-dot');
  const col = G.activeColor !== 'wild' ? G.activeColor : null;
  dot.style.background = col ? COLOR_HEX[col] : 'rgba(255,255,255,.1)';
  dot.title            = col ? `Current color: ${col}` : 'No color set';
  dot.textContent      = col ? col[0].toUpperCase() + col.slice(1) : '';
}

function renderDrawPile() {
  const pile     = document.getElementById('deck-pile');
  const canDraw  = G.phase === 'playing' && G.currentPlayer === 0;
  pile.className = canDraw ? 'active' : 'inactive';
}

function renderMessage() {
  document.getElementById('message').textContent = G.msg;
}

function renderModals() {
  // Color picker: only show when the human needs to choose
  const showColor = G.phase === 'pickColor' && G.pendingWild?.playerIdx === 0;
  document.getElementById('color-modal').classList.toggle('hidden', !showColor);

  // Game-over modal
  const gameoverModal = document.getElementById('gameover-modal');
  if (G.phase === 'over') {
    gameoverModal.classList.remove('hidden');
    const won = G.winner === 0;
    document.getElementById('gameover-emoji').textContent = won ? '🎉' : '😅';
    document.getElementById('gameover-title').textContent = won ? 'You Win!' : 'Computer Wins!';
    document.getElementById('gameover-msg').textContent   = won
      ? 'Amazing! You beat the computer!'
      : 'Nice try! Want to go again?';
  } else {
    gameoverModal.classList.add('hidden');
  }
}

// ── Bootstrap ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  newGame();

  document.getElementById('deck-pile').addEventListener('click', playerDraw);

  document.querySelectorAll('.color-pick-btn').forEach(btn =>
    btn.addEventListener('click', () => resolveColor(btn.dataset.color))
  );

  document.getElementById('new-game-btn').addEventListener('click', newGame);
});
