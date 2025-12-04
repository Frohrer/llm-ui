#!/bin/bash

# Generate self-signed SSL certificate for local development
# This allows testing voice chat features that require HTTPS

mkdir -p ssl

# Generate private key and certificate
# Adding common local network IPs for broader compatibility
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/key.pem \
  -out ssl/cert.pem \
  -subj "/C=US/ST=State/L=City/O=Development/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.local,IP:127.0.0.1,IP:0.0.0.0,IP:192.168.1.1,IP:192.168.1.100,IP:192.168.0.1,IP:192.168.0.100,IP:10.0.0.1,IP:10.0.0.100"

echo "✓ SSL certificate generated in ./ssl/"
echo "✓ Certificate is valid for:"
echo "  - localhost"
echo "  - 127.0.0.1"
echo "  - Common local network IPs"
echo ""
echo "You'll need to accept the self-signed certificate warning in your browser"

