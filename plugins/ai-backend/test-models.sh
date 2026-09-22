#!/bin/bash

API_URL="${API_URL:-http://localhost:7008/api/ai}"
QUERY="${1:-What is 2+2?}"

echo "Testing AI models with query: \"$QUERY\""
echo "=========================================="

for model in small medium large; do
  echo -e "\n[$model]"
  curl -s -X POST "$API_URL/models/$model/prompt" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"$QUERY\"}" | jq -r '"Response: \(.text)\nTokens: \(.usage.totalTokens)"'
done
