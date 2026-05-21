#!/bin/sh
set -eu

KEY=$(sed -n "s/.*key: '\([^']*\)'.*/\1/p" /Users/bhawinkadikar/Downloads/bhavin/supabase-config.js)
AUTH=$(curl -sS "https://hkyjxdmkqkydnrafhpgn.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hominalhealthcare.in","password":"admin123"}')
TOKEN=$(printf '%s' "$AUTH" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
echo "token_len:${#TOKEN}"
curl -sS -G "https://hkyjxdmkqkydnrafhpgn.supabase.co/rest/v1/hh_billings" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "select=id,patient_id,status,sec_dep" \
  --data-urlencode "order=patient_id.asc"
echo
echo "---patients---"
curl -sS -G "https://hkyjxdmkqkydnrafhpgn.supabase.co/rest/v1/hh_patients" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "select=id,name,status" \
  --data-urlencode "order=id.asc"
