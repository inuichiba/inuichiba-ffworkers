# kvapi-open.ps1
# 4つまとめて開くランチャー（このスクリプト自体を管理者で実行してください）

$kvDir   = 'D:\nasubi\inuichiba-ffworkers\src\kv-api'
$kvBatffprod = Join-Path $kvDir 'kvapi-curl-ffprod.bat'
$kvBatffdev  = Join-Path $kvDir 'kvapi-curl-ffdev.bat'

# --- PowerShell（管理者） ---
Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoExit', "-Command Set-Location -Path '$kvDir'"

# --- コマンドプロンプト（管理者） ---
Start-Process cmd.exe -Verb RunAs -ArgumentList "/k cd /d $kvDir"

# --- VSCodeでffprodテストファイルを開く（通常ユーザーで） ---
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" `
    -ArgumentList "`"$kvBatffprod`""

# --- VSCodeでffdevテストファイルを開く（通常ユーザーで） ---
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" `
    -ArgumentList "`"$kvBatffdev`""
