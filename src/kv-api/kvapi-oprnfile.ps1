# open-kv-api.ps1
# 3つまとめて開くランチャー（このスクリプト自体を管理者で実行してください）

$kvDir = 'D:\nasubi\inuichiba-ffworkers\src\kv-api'
$kvFile = Join-Path $kvDir 'kv-api-test-cmd.bat'

# --- PowerShell（管理者） ---
Start-Process powershell.exe -ArgumentList '-NoExit', "-Command Set-Location -Path '$kvDir'"

# --- コマンドプロンプト（管理者） ---
Start-Process cmd.exe -ArgumentList "/k cd /d $kvDir"

# --- VSCodeでファイルを開く（管理者不要） ---
Start-Process -FilePath "C:\Users\fairytale\AppData\Local\Programs\Microsoft VS Code\Code.exe" `
    -ArgumentList "`"$kvFile`"" `
    -Verb Open
