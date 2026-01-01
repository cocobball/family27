#!/bin/bash
set -euo pipefail

# Smoke test for Family Dashboard API - Firewalla integration
# Verifies health and network status endpoints

API_BASE="http://127.0.0.1:3000/api/v1"
SERVICE_NAME="family-dashboard-api"
TIMEOUT=10

echo "=== Family Dashboard API - Smoke Test ==="
echo "Time: $(date)"
echo ""

# Test 1: Health check
echo "[1/2] Testing health endpoint..."
if ! HEALTH_RESPONSE=$(curl -f -s -m "$TIMEOUT" "${API_BASE}/health" 2>&1); then
    echo "❌ FAILED: Health check failed"
    echo "Response: $HEALTH_RESPONSE"
    echo ""
    echo "Is the service running?"
    systemctl status "$SERVICE_NAME" --no-pager -l | head -15
    exit 1
fi

echo "✓ Health check passed"
echo "   Response: $HEALTH_RESPONSE"
echo ""

# Test 2: Network status (Firewalla SSH)
echo "[2/2] Testing network status endpoint (Firewalla SSH)..."
if ! STATUS_RESPONSE=$(curl -f -s -m "$TIMEOUT" "${API_BASE}/network/kids/status" 2>&1); then
    echo "❌ FAILED: Network status check failed"
    echo "Response: $STATUS_RESPONSE"
    echo ""
    echo "=== Last 80 service log lines ==="
    journalctl -u "$SERVICE_NAME" -n 80 --no-pager -o cat
    exit 1
fi

# Verify response is valid JSON with ok field
if echo "$STATUS_RESPONSE" | grep -q '"ok"'; then
    if echo "$STATUS_RESPONSE" | grep -q '"ok":true'; then
        echo "✓ Network status check passed (Firewalla SSH OK)"
        echo "   Response: $STATUS_RESPONSE" | head -c 200
        echo ""
    elif echo "$STATUS_RESPONSE" | grep -q '"ok":false'; then
        echo "⚠ Network status returned ok:false (Firewalla error)"
        echo "   Response: $STATUS_RESPONSE"
        echo ""
        echo "This may indicate a Firewalla policy issue, not an API failure."
        echo "Checking logs for SSH errors..."
        echo ""
        journalctl -u "$SERVICE_NAME" -n 80 --no-pager -o cat | grep -i 'firewalla\|ssh' | tail -20
        exit 1
    fi
else
    echo "❌ FAILED: Invalid JSON response from network status"
    echo "Response: $STATUS_RESPONSE"
    exit 1
fi

# All tests passed
echo "=== All Tests Passed ✓ ==="
echo ""
echo "API is healthy and Firewalla integration is working."
exit 0
