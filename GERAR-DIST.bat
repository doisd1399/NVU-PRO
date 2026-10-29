@echo off
rem Gera o dist para publicacao manual (Netlify). Requer Node 20+ e acesso ao registro do npm.
cd /d "%~dp0"
call npm ci || goto erro
call npm run lint || goto erro
call npm run build || goto erro
if exist NVU-PRO-2.3.198-dist.zip del NVU-PRO-2.3.198-dist.zip
powershell -NoProfile -Command "Compress-Archive -Path dist\* -DestinationPath NVU-PRO-2.3.198-dist.zip -Force" || goto erro
echo Pronto: NVU-PRO-2.3.198-dist.zip
exit /b 0
:erro
echo FALHOU. Veja a mensagem acima.
exit /b 1
