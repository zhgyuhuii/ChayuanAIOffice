@echo off
rem chaoffice launcher for the packaged Windows app: <install>\resources\cli\chaoffice.cmd
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\ChaAI Office.exe" "%~dp0chaoffice.cjs" %*
endlocal
