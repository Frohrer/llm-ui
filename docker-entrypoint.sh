#!/bin/bash
set -e

# Wait for postgres
echo "Waiting for PostgreSQL to be ready..."
/wait-for-it.sh db:5432 -t 60

# Setup database schema
echo "Setting up database schema..."

# First, push the schema to create/update tables
echo "Pushing database schema..."
npm run db:push
if [ $? -ne 0 ]; then
    echo "Failed to push database schema"
    exit 1
fi

# Then run the specific migration for is_shared column on existing databases
echo "Adding is_shared column if needed..."
psql -f scripts/add-is-shared-column.sql
if [ $? -ne 0 ]; then
    echo "Failed to add is_shared column"
    exit 1
fi

echo "Database schema setup completed!"

# Start the application
echo "Starting application..."
exec node dist/index.js