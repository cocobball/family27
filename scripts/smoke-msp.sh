#!/bin/bash
set -e

# Smoke test for Firewalla MSP provider
# Validates MSP configuration and fetches rule details

echo "=== Firewalla MSP Smoke Test ==="
echo

# Check required environment variables
if [ -z "$FIREWALLA_MSP_DOMAIN" ]; then
  echo "❌ FIREWALLA_MSP_DOMAIN not set"
  exit 1
fi

if [ -z "$FIREWALLA_MSP_TOKEN" ]; then
  echo "❌ FIREWALLA_MSP_TOKEN not set"
  exit 1
fi

if [ -z "$FIREWALLA_MSP_RULE_ID" ]; then
  echo "❌ FIREWALLA_MSP_RULE_ID not set"
  exit 1
fi

echo "✓ Environment variables present"
echo "  Domain: $FIREWALLA_MSP_DOMAIN"
echo "  Rule ID: $FIREWALLA_MSP_RULE_ID"
echo "  Token: [REDACTED]"
echo

# Construct API URL
API_URL="https://${FIREWALLA_MSP_DOMAIN}/v2/rules?query=id:${FIREWALLA_MSP_RULE_ID}"

echo "Fetching rule from MSP API..."
echo "  URL: $API_URL"
echo

# Make API request
HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/msp-response.json \
  -H "Authorization: Token ${FIREWALLA_MSP_TOKEN}" \
  "$API_URL")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ API request failed with HTTP $HTTP_CODE"
  echo
  echo "Response:"
  cat /tmp/msp-response.json
  rm -f /tmp/msp-response.json
  exit 1
fi

echo "✓ API request successful (HTTP $HTTP_CODE)"
echo

# Parse JSON response using python
RULE_DATA=$(python3 -c "
import json, sys
try:
    with open('/tmp/msp-response.json', 'r') as f:
        data = json.load(f)
    
    # MSP returns array of rules
    if not isinstance(data, list) or len(data) == 0:
        print('ERROR: No rules returned', file=sys.stderr)
        sys.exit(1)
    
    rule = data[0]
    print(f\"id: {rule.get('id', 'N/A')}\")
    print(f\"status: {rule.get('status', 'N/A')}\")
    print(f\"action: {rule.get('action', 'N/A')}\")
    print(f\"notes: {rule.get('notes', 'N/A')}\")
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
")

PARSE_EXIT=$?
rm -f /tmp/msp-response.json

if [ $PARSE_EXIT -ne 0 ]; then
  echo "❌ Failed to parse rule data"
  echo "$RULE_DATA"
  exit 1
fi

echo "Rule Details:"
echo "$RULE_DATA"
echo

echo "✅ MSP smoke test passed"
exit 0
