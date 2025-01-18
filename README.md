# Multi-LLM Chat Interface

A sophisticated chat interface platform that enables seamless interactions with multiple AI language models. This application provides a unified interface for communicating with various AI providers while maintaining conversation history and providing a rich user experience.

## Features

- 🤖 Multi-provider AI integration (OpenAI, Anthropic)
- 💬 Turn-based conversations with context preservation
- 🔄 Real-time message streaming
- 📝 Markdown and code syntax highlighting
- 🌓 Dark/light mode support
- 🎨 Clean, professional UI using shadcn/ui
- 📱 Responsive design
- 🔧 Server-side provider configuration
- 🗄️ PostgreSQL-backed conversation history
- 🔒 Secure credential handling
- 🐳 Docker deployment support

## Tech Stack

- Frontend: React.js with TypeScript
- Backend: Node.js with Express
- Database: PostgreSQL with Drizzle ORM
- UI Framework: shadcn/ui + Tailwind CSS
- State Management: TanStack Query
- Routing: wouter

## Prerequisites

- Node.js 20 or higher
- PostgreSQL 15 or higher
- API keys for OpenAI and Anthropic

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chat_app

# API Keys
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

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
