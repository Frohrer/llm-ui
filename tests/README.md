# Tests

| Command | Needs | What it covers |
| --- | --- | --- |
| `npm run check` | nothing | TypeScript |
| `npm run test:pii-scope` | nothing | PII redaction scope, pure walkers |
| `npm run test:integration` | a throwaway Postgres in `DATABASE_URL` | PII scope and memory/conversation linkage against the real services |
| `npm run test:ai-models` | provider API keys | live model calls |
| `npm run test:agentic` | provider API keys | agentic loop |

`test:integration` writes and deletes rows. Point it at a scratch database,
never a real one.

Everything except the API-key suites runs in the `Dockerfile.check` image:

```sh
docker build -f Dockerfile.check -t llm-ui-check .

docker run -d --name llmui-check-db --network llmui-check-net \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=chat_app postgres:15-alpine

docker run --rm --network llmui-check-net -v "$PWD":/src:ro \
  -e DATABASE_URL='postgres://postgres:postgres@llmui-check-db:5432/chat_app?sslmode=disable' \
  llm-ui-check sh -c 'cp -r /src/. /app/; npm run db:push -- --force && npm run test:integration'
```
