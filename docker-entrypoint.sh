#!/bin/bash
set -e

# Wait for postgres
echo "Waiting for PostgreSQL to be ready..."
/wait-for-it.sh db:5432 -t 60

# Push database schema
echo "Pushing database schema..."
npm run db:push
if [ $? -ne 0 ]; then
    echo "Failed to push database schema"
    exit 1
fi

# Start the application
echo "Starting application..."
exec node dist/index.js