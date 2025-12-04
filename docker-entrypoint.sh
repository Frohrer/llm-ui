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

# Run full-text search migration
echo "Setting up full-text search..."
psql -f migrations/0002_add_fulltext_search.sql
if [ $? -ne 0 ]; then
    echo "Failed to setup full-text search (may already be applied)"
    # Don't exit - migration might already be applied
fi

# Fix tsvector size limit for large content (deprecated by 0004)
echo "Fixing tsvector size limit..."
psql -f migrations/0003_fix_tsvector_size_limit.sql
if [ $? -ne 0 ]; then
    echo "Failed to fix tsvector size limit (may already be applied)"
    # Don't exit - migration might already be applied
fi

# Smart image exclusion from search (handles images and long text properly)
echo "Applying smart image exclusion from search..."
psql -f migrations/0004_smart_image_exclusion_from_search.sql
if [ $? -ne 0 ]; then
    echo "Failed to apply smart image exclusion (may already be applied)"
    # Don't exit - migration might already be applied
fi

echo "Database schema setup completed!"

# Start the application
echo "Starting application..."
exec node dist/index.js