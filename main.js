const { app, BrowserWindow, screen, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Tracker } = require('./tracker');
const { Engine } = require('./engine');
const { Cdp } = require('./cdp');

require('events').EventEmitter.defaultMaxListeners = 40;

const STREAMPROOF = process.argv.includes('--streamproof');
console.log('streamproof:', STREAMPROOF);

const sfLocal = path.join(__dirname, 'bin', 'stockfish.exe');
const engine = new Engine(fs.existsSync(sfLocal) ? sfLocal : 'C:\\stockfish\\stockfish.exe');
const cdp = new Cdp(9222);

const CFG = path.join(__dirname, 'nudge.json');
const PAD = 6;
const BAR_W = 30;
const GAP = 10;
const LEFT = PAD + BAR_W + GAP;
const RIGHT = PAD;
let nudge = { x: 0, y: 0 };
try { nudge = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch {}

const BROWSERS = new Set(['zen', 'chrome', 'msedge', 'brave', 'firefox', 'librewolf', 'vivaldi', 'opera', 'thorium']);
let overlay, tracker, visible = true, interactive = false, focused = true, barHover = false;
let fg = '', fgProc = null;

const bump = (dx, dy) => {
  nudge.x += dx; nudge.y += dy;
  try { fs.writeFileSync(CFG, JSON.stringify(nudge)); } catch {}
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('nudge', nudge);
};

function setPassthrough() {
  if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(!interactive);
}

function protect() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setContentProtection(STREAMPROOF);
}

function applyVisibility() {
  if (!overlay || overlay.isDestroyed()) return;
  const on = STREAMPROOF ? focused : BROWSERS.has(fg);
  if (visible && on) overlay.showInactive();
  else overlay.hide();
}

function startFgWatch() {
  fgProc = spawn('powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'fg.ps1')],
    { windowsHide: true });
  fgProc.stdout.setEncoding('utf8');
  let buf = '';
  fgProc.stdout.on('data', d => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const l of lines) {
      const n = l.trim().toLowerCase().replace(/\.exe$/, '');
      if (n && n !== fg) { fg = n; applyVisibility(); }
    }
  });
  fgProc.on('exit', () => { fgProc = null; });
  fgProc.on('error', e => console.error('[fg] spawn failed:', e.message));
}

function makeOverlay() {
  overlay = new BrowserWindow({
    x: 0, y: 0, width: 800, height: 800,
    transparent: true, frame: false, hasShadow: false,
    resizable: false, movable: false, skipTaskbar: true,
    focusable: false, fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile('index.html');
  overlay.on('show', () => { protect(); setPassthrough(); });
  overlay.webContents.once('did-finish-load', () => {
    protect();
    setPassthrough();
    overlay.webContents.send('nudge', nudge);
  });
}

function place(s) {
  if (!overlay || overlay.isDestroyed()) return;
  const x = Math.round(s.ox + s.rect.x) - LEFT;
  const y = Math.round(s.oy + s.rect.y) - PAD;
  const w = Math.round(s.rect.w) + LEFT + RIGHT;
  const h = Math.round(s.rect.h) + PAD * 2;
  const b = overlay.getBounds();
  if (b.x !== x || b.y !== y || b.width !== w || b.height !== h) {
    overlay.setBounds({ x, y, width: w, height: h });
    protect();
  }
}

app.whenReady().then(async () => {
  makeOverlay();
  setPassthrough();
  startFgWatch();

  globalShortcut.register('Alt+F1', () => { visible = !visible; applyVisibility(); });
  globalShortcut.register('Alt+F2', () => tracker && tracker.reset());
  globalShortcut.register('Alt+F3', () => engine.toggleDepth());
  globalShortcut.register('Alt+F6', () => {
    interactive = !interactive;
    setPassthrough();
    console.log('overlay interactive:', interactive);
  });
  globalShortcut.register('Alt+F12', () => {
    if (!overlay.isDestroyed()) overlay.webContents.openDevTools({ mode: 'detach' });
  });
  globalShortcut.register('Alt+Left', () => bump(-1, 0));
  globalShortcut.register('Alt+Right', () => bump(1, 0));
  globalShortcut.register('Alt+Up', () => bump(0, -1));
  globalShortcut.register('Alt+Down', () => bump(0, 1));
  globalShortcut.register('Alt+F10', () => { nudge = { x: 0, y: 0 }; bump(0, 0); });

  try {
    await cdp.connect();
    console.log('CDP connected');
  } catch (e) {
    console.error('CDP:', e.message, '- run launch.bat first');
  }

  tracker = new Tracker(cdp, engine);
  tracker.on('focus', f => { focused = f; applyVisibility(); });
  tracker.on('suggest', s => {
    if (!overlay || overlay.isDestroyed()) return;
    if (s && s.rect) place(s);
    overlay.webContents.send('suggest', s);
  });

  setInterval(async () => {
    if (cdp.ws && cdp.ws.readyState === 1) return;
    try { await cdp.connect(); console.log('CDP reconnected'); tracker && tracker.reset(); } catch {}
  }, 3000);

  setInterval(protect, 2000);

  setInterval(() => {
    if (!overlay || overlay.isDestroyed()) return;
    const b = overlay.getBounds();
    const p = screen.getCursorScreenPoint();
    const inside = p.x >= b.x + PAD && p.x <= b.x + PAD + BAR_W &&
                   p.y >= b.y + PAD && p.y <= b.y + b.height - PAD;
    if (inside !== barHover) {
      barHover = inside;
      overlay.webContents.send('barhover', inside);
    }
  }, 60);
});

app.on('will-quit', () => { if (fgProc) fgProc.kill(); });
app.on('window-all-closed', () => app.quit());
