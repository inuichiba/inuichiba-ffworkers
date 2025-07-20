@echo off
set /p token=Please enter your Authorization token:

curl.exe -X POST https://inuichiba-ffworkers-kvapi-ffprod.maltese-melody0655.workers.dev ^
More?   -H "Content-Type: application/json" ^
More?   -H "Authorization: Bearer %TOKEN%" ^
More?   -d "{\"kind\":\"del\",\"userId\":\"U061b67a5098093dfcbae373c2e7db1ea\",\"groupId\":\"default\",\"ttl\":1000}"

pause
