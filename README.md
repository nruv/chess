# Chess "Visuals"

A lightweight Windows desktop chess overlay built with Electron, JavaScript, and Stockfish.

The application connects to a Chrome tab running chess.com, detects the current board position, and displays chess engine evaluations through a desktop overlay.

## Requirements

- Windows 10 or Windows 11
- [Node.js (LTS)](https://nodejs.org/)
- [Google Chrome](https://www.google.com/chrome/)
- [Stockfish](https://stockfishchess.org/download/)

## Installation

### 1. Download the project

Clone the repository:

```bash
git clone https://github.com/nruv/chess/
cd chess
```

Or, download the repository as a ZIP and extract it.

### 2. Install dependencies

Open a terminal in the project directory and run:

```bash
npm install
```

### 3. Install Stockfish

Download the Windows Stockfish executable.

Create a folder named `bin` in the project directory and place the executable inside it:

```text
project/
├── bin/
│   └── stockfish.exe
├── book.js
├── cdp.js
├── classify.js
├── engine.js
├── fg.ps1
├── index.html
├── launch.bat
├── main.js
├── preload.js
├── tracker.js
├── package.json
└── ...
```

The application automatically looks for Stockfish at `bin/stockfish.exe`.

Also, it supports the fallback path:

```text
C:\stockfish\stockfish.exe
```

### 4. Launch

**Step 1:** Run `launch.bat`.

This opens Chrome with remote debugging enabled and navigates to Chess.com.

**Step 2:** Run `run.bat` from the project directory.

The Electron overlay should now start and connect to the Chrome session.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt + F1` | Toggle overlay visibility |
| `Alt + F2` | Reset tracking |
| `Alt + F3` | Toggle engine calculation speed |
| `Alt + F6` | Toggle overlay interaction |
| `Alt + F12` | Open developer tools |
| `Alt + Arrow Keys` | Adjust overlay position |
| `Alt + F10` | Reset overlay position |

## Streamproof Mode

Run `streamproof.bat` to launch the application with its screen-capture protection setting enabled.

## How It Works

- **Electron:** Creates the desktop overlay.
- **Chrome DevTools Protocol:** Connects to the Chrome debugging interface.
- **Chess.js:** Handles chess positions and move validation.
- **Stockfish:** Calculates engine evaluations and candidate moves.
- **PowerShell:** Monitors the foreground application to control overlay visibility.

## Notes

- Designed for Windows.
- Google Chrome must be launched using `launch.bat` before starting the application.
- Stockfish must be installed separately.
- The application requires access to Chrome's remote debugging interface on localhost port `9222`.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
