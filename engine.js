const { spawn } = require('child_process');

class Engine {
  constructor(bin, movetime = 1100) {
    this.bin = bin;
    this.movetime = movetime;
    this.pv = []; this.pvs = []; this.scores = []; this.mates = [];
    this.depth = 0; this.waiter = null; this.multipv = 2; this.searching = false;
    this.proc = null;
    this.start();
  }

  start() {
    try { this.proc = spawn(this.bin, [], { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { console.error('[engine] spawn threw:', e.message); return; }
    this.proc.on('error', e => console.error('[engine] spawn failed:', e.message, '\n  path:', this.bin));
    this.proc.on('exit', c => console.error('[engine] exited with', c));
    this.proc.stderr.on('data', d => console.error('[engine]', d.toString().trim()));
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', d => this.parse(d));
    this.send('uci');
    this.send('setoption name Threads value 6');
    this.send('setoption name Hash value 512');
    this.send('setoption name MultiPV value 2');
    this.send('isready');
    this.searching = false;
  }

  alive() { return !!this.proc && this.proc.exitCode === null && !this.proc.killed; }

  ensure() {
    if (this.alive()) return true;
    console.log('[engine] respawning');
    this.start();
    return this.alive();
  }

  send(c) { try { this.proc.stdin.write(c + '\n'); } catch {} }
  toggleDepth() { this.movetime = this.movetime === 1100 ? 300 : 1100; }

  parse(chunk) {
    for (const line of chunk.split('\n')) {
      if (line.startsWith('info') && line.includes(' pv ')) {
        const n = +(line.match(/multipv (\d+)/) || [0, 1])[1];
        const d = line.match(/depth (\d+)/); if (d) this.depth = +d[1];
        let sc = null;
        const cp = line.match(/score cp (-?\d+)/); if (cp) sc = +cp[1] / 100;
        const mt = line.match(/score mate (-?\d+)/);
        if (mt) { sc = mt[1] > 0 ? 99 : -99; this.mates[n] = +mt[1]; }
        if (sc !== null) this.scores[n] = sc;
        const pv = line.split(' pv ')[1].trim().split(' ');
        this.pvs[n] = pv;
        if (n === 1) this.pv = pv;
      }
      if (line.startsWith('bestmove') && this.waiter) {
        this.searching = false;
        const w = this.waiter; this.waiter = null;
        const best = line.split(' ')[1];
        const altUci = (this.pvs[2] || [])[0] || null;
        w(best === '(none)'
          ? { best: null, pv: [], alt: null, depth: this.depth, score: 0, mate: null }
          : {
              best,
              pv: (this.pvs[1] || []).slice(0, 4),
              alt: altUci && altUci !== best ? { best: altUci, score: this.scores[2] ?? 0 } : null,
              depth: this.depth,
              score: this.scores[1] ?? 0,
              mate: this.mates[1] ?? null
            });
      }
    }
  }

  analyse(fen, movetime = this.movetime, multipv = 2) {
    return new Promise(resolve => {
      if (!this.ensure()) return resolve(null);
      if (this.searching) this.send('stop');
      if (multipv !== this.multipv) {
        this.multipv = multipv;
        this.send('setoption name MultiPV value ' + multipv);
      }
      this.pv = []; this.pvs = []; this.scores = []; this.mates = []; this.depth = 0;
      const done = r => { clearTimeout(t); this.searching = false; if (this.waiter === done) this.waiter = null; resolve(r); };
      this.waiter = done;
      const t = setTimeout(() => { this.send('stop'); setTimeout(() => done(null), 300); }, movetime + 2000);
      this.searching = true;
      this.send('position fen ' + fen);
      this.send('go movetime ' + movetime);
    });
  }
}

module.exports = { Engine };