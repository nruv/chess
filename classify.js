const { Chess } = require('chess.js');

let lookupOpening = () => null;
try { ({ lookupOpening } = require('./book')); } catch {}

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const BOOK_MIN_CP = -150;
const T_EXCELLENT = 2, T_GOOD = 5, T_INACCURACY = 10, T_MISTAKE = 20;
const WINNING = 75, STILL_WINNING = 60;

const CATEGORIES = {
  brilliant:  { label: 'Brilliant',  glyph: '!!' },
  great:      { label: 'Great',      glyph: '!'  },
  best:       { label: 'Best',       glyph: '\u2605' },
  excellent:  { label: 'Excellent',  glyph: '\u2713' },
  good:       { label: 'Good',       glyph: '\u2713' },
  book:       { label: 'Book',       glyph: '\u{1F4D6}' },
  forced:     { label: 'Forced',     glyph: '\u2192' },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!' },
  miss:       { label: 'Miss',       glyph: '\u2717' },
  mistake:    { label: 'Mistake',    glyph: '?'  },
  blunder:    { label: 'Blunder',    glyph: '??' },
  mate:       { label: 'Checkmate',  glyph: '#'  },
  none:       { label: '\u2014',     glyph: '\u00b7' }
};

function lineToCp(line) {
  if (!line) return 0;
  if (line.mate !== null && line.mate !== undefined) {
    return (line.mate > 0 ? 1 : -1) * (1500 + Math.max(0, 100 - Math.abs(line.mate)));
  }
  return line.cp ?? 0;
}

function winPct(cp) {
  const c = Math.max(-1500, Math.min(1500, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

function isSacrifice(after, move) {
  const mover = move.color;
  const opp = mover === 'w' ? 'b' : 'w';
  const movedVal = PIECE_VALUE[move.promotion || move.piece];
  const capturedVal = move.captured ? PIECE_VALUE[move.captured] : 0;
  if (move.piece === 'k') return false;
  if (capturedVal >= movedVal) return false;
  const attackers = after.attackers(move.to, opp);
  if (!attackers.length) return false;
  const cheapest = Math.min(...attackers.map(sq => PIECE_VALUE[after.get(sq).type]));
  const defenders = after.attackers(move.to, mover);
  const netLoss = movedVal - capturedVal;
  if (!defenders.length) return netLoss >= 2;
  return cheapest < movedVal && netLoss - cheapest >= 2;
}

function classify(before, after, fenBefore, san, ply) {
  const chess = new Chess(fenBefore);
  const legalMoves = chess.moves().length;
  let move = null;
  try { move = chess.move(san); } catch { }
  if (!move) return { cat: 'none', loss: 0, opening: null };

  const opening = lookupOpening(chess.fen());
  if (chess.isCheckmate()) return { cat: 'mate', loss: 0, move, opening };

  const bestLine = before.lines[0];
  const secondLine = before.lines[1];
  const afterLine = after.lines[0];
  if (!bestLine) return { cat: 'none', loss: 0, move, opening };

  const cpBest = lineToCp(bestLine);
  const cpSecond = secondLine ? lineToCp(secondLine) : cpBest - 9999;
  const cpAfter = afterLine ? -lineToCp(afterLine) : (chess.isStalemate() || chess.isDraw() ? 0 : cpBest);

  const wBest = winPct(cpBest);
  const wAfter = winPct(cpAfter);
  const uci = move.from + move.to + (move.promotion || '');
  const isEngineBest = before.bestMove === uci;
  const loss = isEngineBest ? 0 : Math.max(0, wBest - wAfter);

  const inBook = opening && (ply <= 1 || lookupOpening(fenBefore) !== null);
  const hadMate = bestLine.mate !== null && bestLine.mate !== undefined && bestLine.mate > 0;

  let cat;
  if (legalMoves === 1) cat = 'forced';
  else if (inBook && cpAfter > BOOK_MIN_CP) cat = 'book';
  else if (isEngineBest || loss < 0.5) {
    cat = 'best';
    const onlyMove = winPct(cpBest) - winPct(cpSecond) >= 10;
    const notCrushing = cpBest < 500 && cpBest > -300;
    if (notCrushing && cpAfter > -60 && isSacrifice(chess, move)) cat = 'brilliant';
    else if (onlyMove && notCrushing) cat = 'great';
  } else if (loss >= T_GOOD && (hadMate || wBest >= WINNING) && wAfter < STILL_WINNING) cat = 'miss';
  else if (loss < T_EXCELLENT) cat = 'excellent';
  else if (loss < T_GOOD) cat = 'good';
  else if (loss < T_INACCURACY) cat = 'inaccuracy';
  else if (loss < T_MISTAKE) cat = 'mistake';
  else cat = 'blunder';

  return { cat, loss, move, cpBest, cpAfter, isEngineBest, opening };
}

module.exports = { classify, CATEGORIES, winPct, lineToCp };