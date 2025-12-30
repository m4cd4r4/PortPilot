@echo off
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
start "" node_modules\.bin\electron.cmd .
