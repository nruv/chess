@echo off
title chess overlay
cd /d "%~dp0"
npx electron .
if errorlevel 1 pause