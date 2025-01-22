# Multi-LLM Chat Interface

A sophisticated chat interface platform that enables seamless interactions with multiple AI language models. This application provides a unified interface for communicating with various AI providers while maintaining conversation history and providing a rich user experience.

## Features

- 🤖 Multi-provider AI integration (OpenAI, Anthropic)
- 💬 Turn-based conversations with context preservation
- 🔄 Real-time message streaming
- 📝 Markdown rendering for AI responses (disabled for user messages)
- 🌓 Dark/light mode support
- 🎨 Clean, professional UI using shadcn/ui
- 📱 Responsive design
- 🔧 Server-side provider configuration
- 🗄️ PostgreSQL-backed conversation history
- 🔒 Cloudflare One authentication
- 🐳 Docker deployment support

## Tech Stack

- Frontend: React.js with TypeScript
- Backend: Node.js with Express
- Database: PostgreSQL with Drizzle ORM
- UI Framework: shadcn/ui + Tailwind CSS
- State Management: TanStack Query
- Routing: wouter
- Authentication: Cloudflare One

## Prerequisites

- Node.js 20 or higher
- PostgreSQL 15 or higher
- Cloudflare One account for authentication
- API keys for the LLM providers you want to use (OpenAI/Anthropic/DeepSeek)

## Authentication

This application uses Cloudflare One for authentication. When deployed, it expects the following headers from Cloudflare:

- `CF-Access-Authenticated-User-Email`: The email address of the authenticated user
- `CF-Access-JWT-Assertion`: The JWT token from Cloudflare

To set up authentication:

1. Create a Cloudflare Zero Trust account
2. Configure an application in the Zero Trust dashboard
3. Set up authentication policies
4. Configure your deployment to use Cloudflare Access

The application will automatically use the Cloudflare headers to authenticate users and manage their conversations.

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Required
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chat_app

# Optional - Include only the API keys for the providers you want to use
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key
```

Note: The application will only display and enable providers for which valid API keys are provided. Missing API keys will cause the corresponding provider to be hidden from the UI automatically.

## Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up the database:
   ```bash
   npm run db:push
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

The application will be available at `http://localhost:5000`.

## Docker Deployment

To run the application using Docker:

1. Clone the repository
2. Create a `.env` file with the required environment variables
3. Build and start the containers:
   ```bash
   docker-compose up -d
   ```

The application will be available at `http://localhost:5000`.

## Provider Configuration

The application supports configurable AI providers through JSON configuration files located in `server/config/providers/`.

### Adding a New Provider

1. Create a new configuration file in `server/config/providers/` (e.g., `mistral.json`):
   ```json
   {
     "id": "mistral",
     "name": "Mistral AI",
     "icon": "SiMistral",
     "models": [
       {
         "id": "mistral-medium",
         "name": "Mistral Medium",
         "contextLength": 32000,
         "defaultModel": true
       }
     ]
   }
   ```

2. Implement the provider interface in `client/src/lib/llm/providers/`:
   ```typescript
   import type { LLMProvider } from "../types";

   export class MistralProvider implements LLMProvider {
     // Implementation details
   }
   ```

3. Add the provider to the initialization logic in `client/src/lib/llm/providers/index.ts`.

4. Add the corresponding environment variable for the API key.

Note: If the API key for a provider is not available in the environment variables, the provider will be automatically hidden from the UI. This allows for flexible deployment configurations where only some providers are enabled.

## Usage

1. Start a new conversation by clicking the "New Chat" button
2. Select your preferred AI model from the dropdown
3. Type your message and press Enter or click the send button
4. View your conversation history in the sidebar
5. Toggle between light and dark modes using the theme toggle button

## Contributing

1. Fork the repository
2. Create a new branch for your feature
3. Make your changes
4. Submit a pull request

## License

MIT