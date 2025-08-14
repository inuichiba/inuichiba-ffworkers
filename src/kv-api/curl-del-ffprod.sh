#!/bin/bash

read -p "Please enter your Authorization token: " token

curl -X POST https://inuichiba-ffworkers-kvapi-ffprod.nasubi810.workers.dev \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $token" \
  -d '{"kind":"del","userId":"U21edb08eec2c77590f64ac947ec6d820","groupId":"default","ttl":60}'

read -n 1 -s -r -p "Press any key to continue..."
echo
