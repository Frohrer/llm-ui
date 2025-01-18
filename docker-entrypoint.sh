#!/bin/bash
set -e

# Wait for postgres
/wait-for-it.sh db:5432 -t 60

# Push database schema
echo "Pushing database schema..."
npm run db:push

# Start the application
echo "Starting application..."
exec node dist/index.js
