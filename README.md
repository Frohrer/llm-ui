# LLM UI - AI SDK Agentic Mode

A production-ready chat interface with agentic mode powered by the Vercel AI SDK.

## Features

✅ **Universal Provider Support** - Works with all AI SDK providers:
- OpenAI (GPT-4, GPT-5, o1, o3)
- Anthropic (Claude 3.5, Claude 3)
- Google Gemini
- xAI Grok
- DeepSeek
- And more...

✅ **Agentic Mode** - Multi-step reasoning with tool calling
✅ **Tool Integration** - Web search, calculator, website browsing, and more
✅ **Dockerized** - Production-ready containers
✅ **Tested** - Automated integration tests

## Quick Start

### Prerequisites

1. **Docker & Docker Compose** installed
2. **API Keys** for at least one provider:
   ```bash
   export OPENAI_API_KEY=sk-...
   export ANTHROPIC_API_KEY=sk-ant-...
   ```

### Run the Application

```bash
# Build and start
docker-compose up

# Visit http://localhost:5000
```

### Run Tests

```bash
# Dockerized test (recommended)
npm run test:agentic

# Or directly
./test-agentic.sh
```

## Test Suite

The test suite validates that agentic mode works correctly:

1. ✅ Builds Docker containers
2. ✅ Starts services (app + database)
3. ✅ Waits for health checks
4. ✅ Tests each provider with tool calling
5. ✅ Validates responses
6. ✅ Cleans up containers

**What it tests:**
- Model can use tools (browse_website)
- Agentic loop works correctly
- Multi-step reasoning functions
- Tool results are processed

### Test Output

```
[TEST] Step 1: Building Docker containers...
✅ Build completed

[TEST] Step 2: Starting services (app + database)...
✅ Services started

[TEST] Step 3: Waiting for services to be healthy...
✅ App is healthy!

[TEST] Step 4: Running agentic mode tests...

================================================================================
Testing OpenAI (gpt-4) - Agentic Mode
================================================================================
ℹ️  Tool called: browse_website
✅ Tools were called (agentic mode working!)
✅ OpenAI test passed!

================================================================================
Test Summary
================================================================================
✅ OpenAI: passed
✅ Anthropic: passed

🎉 All tests passed!

[TEST] Step 5: Cleanup
✅ Test suite completed successfully!
```

## Configuration

### Environment Variables

Create a `.env` file or export variables:

```bash
# Required (at least one)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
XAI_KEY=...

# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=chat_app

# Optional
BRAVE_SEARCH_API_KEY=...
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=...
```

### Docker Compose Files

- `docker-compose.yml` - Production deployment
- `docker-compose.test.yml` - Test environment with health checks

## Architecture

### Agentic Workflow

```
User Query
    ↓
AI SDK generateText()
    ↓
Model decides: Need tools?
    ├─ No → Return response
    └─ Yes → Call tools
         ↓
Execute tools (parallel)
         ↓
Add results to context
         ↓
Next iteration (max 10)
         ↓
Final response
```

### Key Files

- `server/agentic-workflow.ts` - Core agentic loop (AI SDK)
- `server/ai-sdk-providers.ts` - Provider initialization
- `server/tools/` - Available tools
- `test-agentic-mode.mjs` - Integration tests
- `Dockerfile.test` - Test container

## Development

### Local Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Run type checking
npm run check

# Build
npm run build
```

### Adding a Provider

1. Add API key to environment
2. Create provider helper in `server/ai-sdk-providers.ts`:
   ```typescript
   export function getProviderModel(modelName: string, apiKey?: string): LanguageModel {
     const provider = createProvider({ apiKey });
     return provider(modelName);
   }
   ```
3. Update provider route to use AI SDK
4. Add to test suite

### Adding Tools

Create a new tool in `server/tools/manual/`:

```typescript
export const myTool: Tool = {
  name: 'my_tool',
  description: 'What the tool does',
  parameters: {
    type: 'object',
    properties: {
      param: {
        type: 'string',
        description: 'Parameter description'
      }
    },
    required: ['param']
  },
  execute: async (params) => {
    // Tool logic
    return result;
  }
};
```

Export it in `server/tools/manual/index.ts`.

## Troubleshooting

### Tests Fail

```bash
# Check logs
docker-compose -f docker-compose.test.yml logs app

# Rebuild from scratch
docker-compose -f docker-compose.test.yml down -v
docker-compose -f docker-compose.test.yml build --no-cache
./test-agentic.sh
```

### Service Won't Start

```bash
# Check if port 5000 is in use
lsof -i :5000  # macOS/Linux
netstat -ano | findstr :5000  # Windows

# Check Docker
docker ps
docker-compose logs
```

### API Key Issues

```bash
# Verify keys are set
echo $OPENAI_API_KEY
echo $ANTHROPIC_API_KEY

# Check they're passed to containers
docker-compose config | grep API_KEY
```

## CI/CD

### GitHub Actions

```yaml
name: Test Agentic Mode

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: ./test-agentic.sh
```

## Performance

Expected response times:
- Simple queries: 2-5 seconds
- With tools (1-2 iterations): 5-15 seconds
- Complex multi-step: 30-60 seconds

Token usage varies by:
- Model selected
- Number of iterations
- Tool results size
- Context length

## Security

- ✅ API keys in environment variables
- ✅ No API keys in code
- ✅ Docker network isolation
- ✅ Health check endpoints (no auth)
- ✅ Tool execution sandboxing

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test:agentic`
5. Submit a pull request

## Support

- Documentation: See `docs/` directory
- Issues: GitHub Issues
- Discussions: GitHub Discussions

## Acknowledgments

Built with:
- [Vercel AI SDK](https://ai-sdk.dev) - Unified AI provider interface
- [React](https://react.dev) - UI framework
- [Express](https://expressjs.com) - Server framework
- [PostgreSQL](https://postgresql.org) - Database
- [Docker](https://docker.com) - Containerization

---

**Status:** ✅ Production Ready

**Version:** 2.0.0 (AI SDK Migration)

**Last Updated:** October 30, 2025
