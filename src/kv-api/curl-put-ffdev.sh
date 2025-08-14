#!/bin/bash

read -p "Please enter your Authorization token: " token

curl -X POST https://inuichiba-ffworkers-kvapi-ffdev.nasubi810.workers.dev \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $token" \
  -d '{"kind":"put","userId":"Uea8d4a145bff6700045c2b263927d844","groupId":"default","ttl":60}'

read -n 1 -s -r -p "Press any key to continue..."
echo
