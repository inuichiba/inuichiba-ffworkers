@echo off
set /p token=Please enter your Authorization token:

curl.exe -X POST https://inuichiba-ffworkers-kvapi-ffdev.maltese-melody0655.workers.dev ^
More?   -H "Content-Type: application/json" ^
More?   -H "Authorization: Bearer %TOKEN%" ^
More?   -d "{\"kind\":\"put\",\"userId\":\"U4f4509e648b3cb14cfe8c9a14a4eade9\",\"groupId\":\"default\",\"ttl\":60}"

pause
