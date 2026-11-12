@echo off
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\chess-chrome" --incognito --new-window https://www.chess.com/play/online