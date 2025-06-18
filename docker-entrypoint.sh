#!/bin/bash
set -e

# Wait for postgres
echo "Waiting for PostgreSQL to be ready..."
/wait-for-it.sh db:5432 -t 60

# Run database migrations
echo "Running database migrations..."
node scripts/migrate.js
if [ $? -ne 0 ]; then
    echo "Failed to run database migrations"
    exit 1
fi

# Start the application
echo "Starting application..."
exec node dist/index.js