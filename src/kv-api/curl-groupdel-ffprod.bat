@echo off
set /p token=Please enter your Authorization token:

curl.exe -X POST https://inuichiba-ffworkers-kvapi-ffprod.maltese-melody0655.workers.dev/ ^
More?   -H "Content-Type: application/json" ^
More?   -H "Authorization: Bearer %TOKEN%" ^
More?   -d "{\"kind\":\"groupdel\",\"groupId\":\"C\"}"

pause


curl.exe -X POST "http://127.0.0.1:8787/set-flag" -H "Content-Type: application/json" -d "{\"flag\":\"kv80\"}"
