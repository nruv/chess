@echo off
title chess overlay (streamproof)
cd /d "%~dp0"
npx electron . --streamproof
if errorlevel 1 pause