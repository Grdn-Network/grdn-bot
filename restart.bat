@echo off
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
    exit
)
powershell -Command "Stop-ScheduledTask -TaskName 'GRDNBot'"
powershell -Command "Start-ScheduledTask -TaskName 'GRDNBot'"
echo Bot restarted!
pause