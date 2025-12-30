$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\PortPilot.lnk")
$Shortcut.TargetPath = "C:\Scratch\PortPilot_localhost-GUI\start.bat"
$Shortcut.WorkingDirectory = "C:\Scratch\PortPilot_localhost-GUI"
$Shortcut.Description = "PortPilot - Localhost Port Manager"
$Shortcut.IconLocation = "C:\Scratch\PortPilot_localhost-GUI\node_modules\electron\dist\electron.exe,0"
$Shortcut.WindowStyle = 7  # Minimized
$Shortcut.Save()
Write-Host "Desktop shortcut created with Electron icon!"
