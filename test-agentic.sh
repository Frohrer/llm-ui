#!/bin/bash

# Dockerized Agentic Mode Test Runner
# This script runs the entire test suite in Docker containers

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Helper functions
log() {
    echo -e "${CYAN}${BOLD}[TEST]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if .env file exists and source it
if [ -f .env ]; then
    log "Loading environment variables from .env"
    export $(cat .env | grep -v '^#' | xargs)
fi

# Verify required API keys
if [ -z "$OPENAI_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
    error "No API keys found!"
    warning "Please set OPENAI_API_KEY or ANTHROPIC_API_KEY"
    echo ""
    echo "Export them in your shell:"
    echo "  export OPENAI_API_KEY=sk-..."
    echo "  export ANTHROPIC_API_KEY=sk-ant-..."
    echo ""
    echo "Or create a .env file:"
    echo "  OPENAI_API_KEY=sk-..."
    echo "  ANTHROPIC_API_KEY=sk-ant-..."
    exit 1
fi

# Display configured providers
log "Configured Providers:"
[ ! -z "$OPENAI_API_KEY" ] && success "OpenAI API key found"
[ ! -z "$ANTHROPIC_API_KEY" ] && success "Anthropic API key found"
[ ! -z "$GEMINI_API_KEY" ] && success "Gemini API key found"
echo ""

# Step 1: Build containers
log "Step 1: Building Docker containers..."
docker-compose -f docker-compose.test.yml build
success "Build completed"
echo ""

# Step 2: Start services
log "Step 2: Starting services (app + database)..."
docker-compose -f docker-compose.test.yml up -d app db
success "Services started"
echo ""

# Step 3: Wait for services to be healthy
log "Step 3: Waiting for services to be healthy..."
info "This may take 30-60 seconds..."

# Wait for app to be healthy
MAX_WAIT=120
WAIT_TIME=0
while [ $WAIT_TIME -lt $MAX_WAIT ]; do
    if docker-compose -f docker-compose.test.yml ps app | grep -q "healthy"; then
        success "App is healthy!"
        break
    fi
    echo -n "."
    sleep 2
    WAIT_TIME=$((WAIT_TIME + 2))
done
echo ""

if [ $WAIT_TIME -ge $MAX_WAIT ]; then
    error "Service did not become healthy in time"
    log "Showing container logs:"
    docker-compose -f docker-compose.test.yml logs --tail=50 app
    docker-compose -f docker-compose.test.yml down
    exit 1
fi

# Step 4: Run tests
log "Step 4: Running agentic mode tests..."
echo ""

# Run the test container
if docker-compose -f docker-compose.test.yml run --rm test; then
    echo ""
    success "All tests passed! 🎉"
    TEST_EXIT=0
else
    echo ""
    error "Tests failed!"
    TEST_EXIT=1
fi

# Step 5: Cleanup
echo ""
log "Step 5: Cleanup"
info "Stopping containers..."
docker-compose -f docker-compose.test.yml down

if [ $TEST_EXIT -eq 0 ]; then
    success "Test suite completed successfully!"
    exit 0
else
    error "Test suite failed!"
    exit 1
fi

