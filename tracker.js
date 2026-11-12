const { EventEmitter } = require('events');
const { Chess } = require('chess.js');
const { classify } = require('./classify');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

function uciObj(uci) { return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }; }

function applyUci(fen, uci) {
  try { const c = new Chess(fen); c.move(uciObj(uci)); return c.fen(); }
  catch { return null; }
}

function sanOf(fen, uci) {
  try { const c = new Chess(fen); return c.move(uciObj(uci)).san; }
  catch { return uci; }
}

function findPlayed(fen, placement) {
  try {
    const c = new Chess(fen);
    for (const m of c.moves({ verbose: true })) {
      const d = new Chess(fen);
      d.move(m);
      if (d.fen().split(' ')[0] === placement) return m;
    }
  } catch {}
  return null;
}

function suspicion(cat, rank, gap, loss) {
  if (cat === 'book' || cat === 'forced' || cat === 'mate') return null;
  if (rank === 1) return gap >= 0.8 ? 1 : gap >= 0.3 ? 0.7 : 0.45;
  if (rank === 2) return gap < 0.15 ? 0.45 : 0.15;
  return Math.max(-1, -0.35 - loss / 25);
}

const READ = `(() => {
  const b = document.querySelector('wc-chess-board');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  if (r.width < 100) return null;
  const pieces = [];
  for (const p of b.querySelectorAll('.piece')) {
    const m = p.className.match(/square-(\\d)(\\d)/);
    const t = p.className.match(/\\b([wb])([pnbrqk])\\b/);
    if (m && t) pieces.push({ f: +m[1], r: +m[2], c: t[1], t: t[2] });
  }

  const sb = window.innerWidth - document.documentElement.clientWidth;
  const bx = (window.outerWidth - window.innerWidth - sb) / 2;
  const by = window.outerHeight - window.innerHeight - bx;
  const ox = window.screenX + bx;
  const oy = window.screenY + by;

  let turn = null, src = null;
  try { const g = b.game && b.game.getTurn(); if (g === 'w' || g === 'b') { turn = g; src = 'game'; } } catch {}
  if (!turn) {
    let el = document.querySelector('.clock-player-turn'), d = 0;
    while (el && d++ < 6) {
      if (el.classList.contains('clock-white')) { turn = 'w'; src = 'clock'; break; }
      if (el.classList.contains('clock-black')) { turn = 'b'; src = 'clock'; break; }
      el = el.parentElement;
    }
  }
  if (!turn) {
    const ml = document.querySelector('.vertical-move-list, .move-list, wc-move-list');
    if (ml) { turn = ml.querySelectorAll('.node').length % 2 === 0 ? 'w' : 'b'; src = 'parity'; }
  }

  const bottom = document.querySelector('.clock-bottom');
  const mine = bottom
    ? (bottom.classList.contains('clock-white') ? 'w' : bottom.classList.contains('clock-black') ? 'b' : null)
    : null;

  return { ox, oy, dpr: window.devicePixelRatio, focus: document.hasFocus(),
           rect: { x: r.x, y: r.y, w: r.width, h: r.height },
           flipped: b.classList.contains('flipped'), pieces, turn, src, mine };
})()`;

function buildPlacement(pieces) {
  if (!pieces.length) return null;
  const g = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const p of pieces) {
    if (p.f < 1 || p.f > 8 || p.r < 1 || p.r > 8) return null;
    g[p.r - 1][p.f - 1] = p.c + p.t;
  }

  let wk = 0, bk = 0, fen = '';
  for (let r = 7; r >= 0; r--) {
    let e = 0;
    for (let f = 0; f < 8; f++) {
      const c = g[r][f];
      if (!c) { e++; continue; }
      if (c === 'wk') wk++;
      if (c === 'bk') bk++;
      if (e) { fen += e; e = 0; }
      fen += c[0] === 'w' ? c[1].toUpperCase() : c[1];
    }
    if (e) fen += e;
    if (r) fen += '/';
  }
  if (wk !== 1 || bk !== 1) return null;

  const at = (f, r) => g[r - 1][f - 1];
  let cr = '';
  if (at(5, 1) === 'wk') { if (at(8, 1) === 'wr') cr += 'K'; if (at(1, 1) === 'wr') cr += 'Q'; }
  if (at(5, 8) === 'bk') { if (at(8, 8) === 'br') cr += 'k'; if (at(1, 8) === 'br') cr += 'q'; }

  return { placement: fen, castling: cr || '-' };
}

class Tracker extends EventEmitter {
  constructor(cdp, engine) {
    super();
    this.cdp = cdp; this.engine = engine;
    this.lastKey = ''; this.pendingKey = ''; this.pendingHits = 0;
    this.lastTurn = 'w'; this.lastPlacement = '';
    this.busy = false; this.lastEmit = 0; this.lastRun = 0; this.gen = 0; this.lastFocus = null;
    this.cache = new Map();
    this.myFen = null; this.myScore = null; this.myAlt = null; this.myMate = null;
    this.theirFen = null; this.theirBest = null; this.theirAltBest = null;
    this.theirScore = null; this.theirAlt = null; this.theirMate = null;
    this.cheat = 0; this.cheatN = 0;
    this.ply = 0;
    this.timer = setInterval(() => this.tick(), 100);
  }

  reset() {
    this.lastKey = ''; this.pendingKey = ''; this.pendingHits = 0;
    this.lastPlacement = ''; this.gen++; this.cache.clear();
    this.myFen = null; this.myScore = null; this.myAlt = null; this.myMate = null;
    this.theirFen = null; this.theirBest = null; this.theirAltBest = null;
    this.theirScore = null; this.theirAlt = null; this.theirMate = null;
    this.cheat = 0; this.cheatN = 0;
    this.ply = 0;
    this.say(null);
  }

  say(v) { this.lastEmit = Date.now(); this.emit('suggest', v); }

  dbg(msg) {
    const now = Date.now();
    if (now - (this._t || 0) < 2000) return;
    this._t = now;
    console.log('[tracker]', msg);
  }

  async tick() { try { await this.inner(); } catch (e) { this.dbg('tick error: ' + e.message); } }

  async inner() {
    if (this.busy) return;
    if (!this.cdp.ws || this.cdp.ws.readyState !== 1) return;
    let s;
    try { s = await this.cdp.eval(READ); }
    catch (e) { return this.dbg('eval threw: ' + e.message); }
    if (!s) return this.dbg('no board');
    if (!s.pieces.length) return this.dbg('board, 0 pieces');

    if (s.focus !== this.lastFocus) { this.lastFocus = s.focus; this.emit('focus', !!s.focus); }

    const built = buildPlacement(s.pieces);
    if (!built) return this.dbg(`invalid placement (${s.pieces.length} pieces)`);
    const { placement, castling } = built;

    if (placement === START && this.lastPlacement !== '' && this.lastPlacement !== START) {
      this.lastKey = ''; this.pendingKey = ''; this.pendingHits = 0; this.cache.clear();
      this.myFen = null; this.myScore = null; this.myAlt = null; this.myMate = null;
      this.theirFen = null; this.theirBest = null; this.theirAltBest = null;
      this.theirScore = null; this.theirAlt = null; this.theirMate = null;
      this.cheat = 0; this.cheatN = 0;
      this.ply = 0;
      this.dbg('new game detected');
    }

    const changed = this.lastPlacement !== '' && placement !== this.lastPlacement;
    if (changed) { this.gen++; if (placement !== START) this.ply++; }
    this.lastPlacement = placement;

    let domTurn = s.turn, src = s.src;
    if (!domTurn) {
      domTurn = changed ? (this.lastTurn === 'w' ? 'b' : 'w') : this.lastTurn;
      src = 'flip';
    }
    this.lastTurn = domTurn;

    const myColor = s.mine || (s.flipped ? 'b' : 'w');
    const fen = `${placement} ${domTurn} ${castling} - 0 1`;

    if (fen !== this.pendingKey) { this.pendingKey = fen; this.pendingHits = 0; return; }
    if (++this.pendingHits < (domTurn === myColor ? 2 : 1)) return;

    if (fen === this.lastKey) {
      if (domTurn === myColor && Date.now() - this.lastRun > 4000) {
        this.lastRun = Date.now();
        this.lastKey = '';
        if (this.engine.alive()) this.dbg('watchdog: refresh');
        else { this.dbg('watchdog: respawn engine'); this.engine.ensure(); }
      }
      return;
    }
    this.lastKey = fen;
    this.dbg(`board: ${s.pieces.length} pieces, turn=${domTurn}, mine=${myColor}, src=${src}`);

    const base = { ox: s.ox, oy: s.oy, dpr: s.dpr, rect: s.rect, flipped: s.flipped, fen,
                   cheat: this.cheat };

    if (domTurn !== myColor) {
      const g0 = this.gen;
      const prevFen = this.myFen, prevScore = this.myScore;
      const prevAlt = this.myAlt, prevMate = this.myMate;
      this.myFen = null; this.myScore = null; this.myAlt = null; this.myMate = null;
      const played = prevFen && prevScore != null ? findPlayed(prevFen, placement) : null;

      let mated = false;
      try { mated = new Chess(fen).isCheckmate(); } catch {}

      this.busy = true;
      this.lastRun = Date.now();
      try {
        let r1 = null;
        if (!mated) {
          r1 = await this.engine.analyse(fen, 250, 1);
          if (this.gen !== g0) return;
        }

        let grade = null;
        if (played && (mated || r1)) {
          try {
            const uci = played.from + played.to + (played.promotion || '');
            const before = {
              bestMove: this.cache.get(prevFen)?.best,
              lines: [{ cp: Math.round(prevScore * 100), mate: prevMate },
                      prevAlt == null ? null : { cp: Math.round(prevAlt * 100) }]
            };
            const after = { lines: [mated ? { cp: 0, mate: 0 }
                                            : { cp: Math.round(r1.score * 100), mate: r1.mate }] };
            const r = classify(before, after, prevFen, played.san, this.ply);
            console.log('[grade]', played.san, 'mated=' + mated, 'ply=' + this.ply, r && r.cat);
            if (r && r.cat && r.cat !== 'none') grade = { uci, grade: r.cat };
          } catch (e) {
            console.log('[grade] threw:', e.message);
          }
        } else {
          console.log('[grade] skipped played=' + !!played + ' r1=' + !!r1 + ' mated=' + mated);
        }

        if (mated) {
          this.say({ ...base, whiteScore: domTurn === 'b' ? 99 : -99, whiteMate: 0, grade });
          return;
        }

        if (!r1) { this.say({ ...base, grade }); return; }
        if (!r1.best) {
          this.say({ ...base, whiteScore: domTurn === 'b' ? -r1.score : r1.score, grade });
          return;
        }

        this.theirFen = fen; this.theirBest = r1.best;
        this.theirAltBest = r1.alt ? r1.alt.best : null;
        this.theirScore = r1.score; this.theirAlt = r1.alt ? r1.alt.score : null;
        this.theirMate = r1.mate ?? null;

        const fen2 = applyUci(fen, r1.best);
        if (!fen2) {
          this.say({ ...base, whiteScore: domTurn === 'b' ? -r1.score : r1.score, grade });
          return;
        }
        const r2 = await this.engine.analyse(fen2, 400, 1);
        if (this.gen !== g0) return;
        if (!r2 || !r2.best) {
          this.say({ ...base, whiteScore: domTurn === 'b' ? -r1.score : r1.score, grade });
          return;
        }
        this.say({ ...base, whiteScore: domTurn === 'b' ? -r1.score : r1.score,
                   whiteMate: r1.mate == null ? null : (domTurn === 'b' ? -r1.mate : r1.mate),
                   grade, premove: { best: r2.best, san: sanOf(fen2, r2.best) } });
      } finally {
        this.busy = false;
      }
      return;
    }

    const theirFen = this.theirFen, theirBest = this.theirBest, theirAltBest = this.theirAltBest;
    const theirScore = this.theirScore, theirAlt = this.theirAlt, theirMate = this.theirMate;
    this.theirFen = null; this.theirBest = null; this.theirAltBest = null;
    this.theirScore = null; this.theirAlt = null; this.theirMate = null;
    const theirPlayed = theirFen ? findPlayed(theirFen, placement) : null;

    if (this.cache.has(fen)) {
      const c = this.cache.get(fen);
      this.myFen = fen; this.myScore = c.score; this.myAlt = c.alt ? c.alt.score : null;
      this.myMate = c.mate ?? null;
      this.say({ ...c, ...base, cheat: this.cheat,
                 whiteScore: domTurn === 'b' ? -c.score : c.score,
                 whiteMate: c.mate == null ? null : (domTurn === 'b' ? -c.mate : c.mate) });
      return;
    }

    const g0 = this.gen;
    this.busy = true;
    this.lastRun = Date.now();
    try {
      const res = await this.engine.analyse(fen);
      if (this.gen !== g0) return;
      if (res && res.best) {
        this.cache.set(fen, res);
        if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
        this.myFen = fen; this.myScore = res.score; this.myAlt = res.alt ? res.alt.score : null;
        this.myMate = res.mate ?? null;

        if (theirPlayed) {
          try {
            const before = {
              bestMove: theirBest,
              lines: [{ cp: Math.round(theirScore * 100), mate: theirMate },
                      theirAlt == null ? null : { cp: Math.round(theirAlt * 100) }]
            };
            const after = { lines: [{ cp: Math.round(res.score * 100), mate: res.mate }] };
            const r = classify(before, after, theirFen, theirPlayed.san, this.ply);
            const puci = theirPlayed.from + theirPlayed.to + (theirPlayed.promotion || '');
            const gap = theirAlt == null ? 9 : Math.abs(theirScore - theirAlt);
            const rank = puci === theirBest ? 1 : puci === theirAltBest ? 2 : 3;
            const q = suspicion(r.cat, rank, gap, r.loss);
            if (q != null) {
              this.cheatN++;
              this.cheat = Math.max(0, Math.min(1, this.cheat * 0.94 + q * 0.06));
              console.log('[cheat]', theirPlayed.san, r.cat, 'rank=' + rank, q.toFixed(2), '->', this.cheat.toFixed(2));
            }
          } catch (e) { console.log('[cheat] threw:', e.message); }
        }

        this.say({ ...res, ...base, cheat: this.cheat,
                   whiteScore: domTurn === 'b' ? -res.score : res.score,
                   whiteMate: res.mate == null ? null : (domTurn === 'b' ? -res.mate : res.mate) });
      } else if (res) { this.dbg('terminal position'); this.say(null); }
      else this.dbg('engine returned nothing');
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Tracker };