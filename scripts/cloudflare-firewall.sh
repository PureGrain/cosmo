#!/usr/bin/env bash
# cloudflare-firewall.sh — Restrict HTTP/HTTPS to Cloudflare IPs only
#
# This script configures ufw to:
#   1. Allow SSH from anywhere (don't lock yourself out)
#   2. Allow HTTP (80) and HTTPS (443) ONLY from Cloudflare IP ranges
#   3. Deny everything else
#
# Run this on your VPS after initial setup, and re-run periodically
# to pick up new Cloudflare IP ranges.
#
# Source: https://www.cloudflare.com/ips/

set -euo pipefail

echo "=== Cloudflare-Only Firewall Setup ==="

# Ensure ufw is installed
if ! command -v ufw &> /dev/null; then
    echo "Installing ufw..."
    apt-get update -qq && apt-get install -y -qq ufw
fi

# Reset existing rules (start clean)
echo "Resetting ufw rules..."
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Always allow SSH (don't lock yourself out)
ufw allow ssh

# Cloudflare IPv4 ranges
CF_IPV4=(
    173.245.48.0/20
    103.21.244.0/22
    103.22.200.0/22
    103.31.4.0/22
    141.101.64.0/18
    108.162.192.0/18
    190.93.240.0/20
    188.114.96.0/20
    197.234.240.0/22
    198.41.128.0/17
    162.158.0.0/15
    104.16.0.0/13
    104.24.0.0/14
    172.64.0.0/13
    131.0.72.0/22
)

# Cloudflare IPv6 ranges
CF_IPV6=(
    2400:cb00::/32
    2606:4700::/32
    2803:f800::/32
    2405:b500::/32
    2405:8100::/32
    2a06:98c0::/29
    2c0f:f248::/32
)

echo "Adding Cloudflare IPv4 ranges..."
for ip in "${CF_IPV4[@]}"; do
    ufw allow from "$ip" to any port 80,443 proto tcp
done

echo "Adding Cloudflare IPv6 ranges..."
for ip in "${CF_IPV6[@]}"; do
    ufw allow from "$ip" to any port 80,443 proto tcp
done

# Enable ufw
echo "Enabling ufw..."
ufw --force enable

echo ""
echo "=== Firewall configured ==="
echo "Allowed: SSH (all), HTTP/HTTPS (Cloudflare only)"
echo ""
ufw status numbered
echo ""
echo "Test: curl -m 5 http://\$(hostname -I | awk '{print \$1}'):80 should timeout from non-CF IPs"
