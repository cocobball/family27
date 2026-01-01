#!/bin/bash
set -euo pipefail

# Family Dashboard API - systemd deployment script
# This script installs the systemd service unit and override configuration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="family-dashboard-api"
UNIT_FILE="${SCRIPT_DIR}/systemd/${SERVICE_NAME}.service"
OVERRIDE_FILE="${SCRIPT_DIR}/systemd/${SERVICE_NAME}.override.conf"

echo "=== Family Dashboard API Systemd Installation ==="
echo ""

# Check if running with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "ERROR: This script must be run with sudo"
    echo "Usage: sudo bash $0"
    exit 1
fi

# Verify source files exist
if [ ! -f "$UNIT_FILE" ]; then
    echo "ERROR: Unit file not found: $UNIT_FILE"
    exit 1
fi

if [ ! -f "$OVERRIDE_FILE" ]; then
    echo "ERROR: Override file not found: $OVERRIDE_FILE"
    exit 1
fi

# Stop service if running
if systemctl is-active --quiet "${SERVICE_NAME}"; then
    echo "Stopping ${SERVICE_NAME}..."
    systemctl stop "${SERVICE_NAME}"
fi

# Install main service unit
echo "Installing service unit..."
cp -v "$UNIT_FILE" "/etc/systemd/system/${SERVICE_NAME}.service"
chmod 644 "/etc/systemd/system/${SERVICE_NAME}.service"

# Create override directory
echo "Creating override directory..."
mkdir -p "/etc/systemd/system/${SERVICE_NAME}.service.d"

# Install override configuration
echo "Installing override configuration..."
cp -v "$OVERRIDE_FILE" "/etc/systemd/system/${SERVICE_NAME}.service.d/override.conf"
chmod 644 "/etc/systemd/system/${SERVICE_NAME}.service.d/override.conf"

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

# Enable service
echo "Enabling ${SERVICE_NAME}..."
systemctl enable "${SERVICE_NAME}"

# Start service
echo "Starting ${SERVICE_NAME}..."
systemctl start "${SERVICE_NAME}"

# Wait for service to start
sleep 2

# Verify service status
echo ""
echo "=== Service Status ==="
systemctl status "${SERVICE_NAME}" --no-pager -l | head -20

# Verify FIREWALLA_KEY from running process
echo ""
echo "=== Verifying Environment Variables ==="
PID=$(systemctl show -p MainPID --value "${SERVICE_NAME}")
if [ -n "$PID" ] && [ "$PID" != "0" ]; then
    echo "Process PID: $PID"
    echo ""
    echo "FIREWALLA_* environment variables:"
    tr '\0' '\n' < "/proc/$PID/environ" | grep '^FIREWALLA_' || echo "  (none found)"
else
    echo "WARNING: Service is not running (PID=$PID)"
fi

echo ""
echo "=== Installation Complete ==="
echo "Service: ${SERVICE_NAME}"
echo "Status: systemctl status ${SERVICE_NAME}"
echo "Logs:   journalctl -u ${SERVICE_NAME} -f"
echo ""
