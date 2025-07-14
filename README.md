# Multi-LLM Chat Interface with Knowledge Management

A sophisticated AI interaction platform that enables seamless conversations with multiple language models enhanced by custom knowledge sources. This application provides a unified interface for communicating with various AI providers while managing knowledge bases, maintaining conversation history, and providing a rich user experience.

## Features

- 🤖 Multi-provider AI integration (OpenAI, Anthropic, DeepSeek, Gemini)
- 📚 Advanced knowledge management system
  - 📄 Document upload (PDF, DOCX, TXT, CSV, XLSX, PPTX, MD)
  - 🔗 URL content extraction and processing
  - ✏️ Direct text entry for knowledge sources
  - 🧠 Retrieval-Augmented Generation (RAG) support
- 💬 Turn-based conversations with context preservation
- 🔄 Real-time message streaming
- 📝 Markdown rendering for AI responses
- 🌓 Dark/light mode support
- 🎨 Clean, professional UI using shadcn/ui components
- 📱 Responsive design with mobile support
- 🔧 Server-side provider configuration
- 🗄️ PostgreSQL-backed conversation and knowledge storage
- 🔊 Speech-to-text and text-to-speech capabilities
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
- Knowledge Processing:
  - Document Parsing: PDF.js, Mammoth, XLSX
  - Web Content: Axios, Cheerio
  - Text Processing: Custom chunking algorithms
- Speech Capabilities: Microsoft Cognitive Services Speech SDK

## Prerequisites

- Node.js 20 or higher
- PostgreSQL 15 or higher
- Cloudflare One account for authentication
- API keys for the LLM providers you want to use (OpenAI/Anthropic/DeepSeek/Gemini)
- For speech features: Microsoft Cognitive Services Speech API credentials (optional)
- Sufficient storage space for uploaded knowledge files

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

# LLM Provider API Keys - Include only the ones you want to use
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key
GEMINI_API_KEY=your_gemini_api_key

# Optional - Microsoft Cognitive Services for Speech Features
SPEECH_KEY=your_azure_speech_key
SPEECH_REGION=your_azure_speech_region

# Optional - Code Execution with Supakiln
SUPAKILN_API_URL=https://your-supakiln-instance.com
CF_ACCESS_CLIENT_ID=your_cf_access_client_id
CF_ACCESS_CLIENT_SECRET=your_cf_access_client_secret
```

Notes:
- The application will only display and enable LLM providers for which valid API keys are provided. Missing API keys will cause the corresponding provider to be hidden from the UI automatically.
- Speech-to-text and text-to-speech features require valid Microsoft Cognitive Services credentials, but these features are optional and the application will work without them.
- Supakiln code execution requires a running supakiln instance. If your supakiln instance is protected by Cloudflare Access, you'll also need to provide CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET for service-to-service authentication.

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

### Basic Chat Usage
1. Start a new conversation by clicking the "New Chat" button
2. Select your preferred AI model from the dropdown
3. Type your message and press Enter or click the send button
4. View your conversation history in the sidebar
5. Toggle between light and dark modes using the theme toggle button

### Python Code Execution with Supakiln
If configured with a supakiln instance, the LLM can execute Python code in secure sandboxed containers:

1. **Basic Python execution**: The LLM can run Python code with automatic package installation
2. **Container management**: Create persistent containers with pre-installed packages for complex workflows
3. **Advanced workflows**: Use existing containers for stateful computations across multiple code executions

Available tools:
- `run_python`: Execute Python code with optional package installation
- `manage_containers`: Create, list, inspect, and delete containers for persistent environments

### Knowledge Management
1. Access the Knowledge Management by clicking the "Knowledge" button in the sidebar
2. Add knowledge sources in three ways:
   - **File Upload**: Upload supported document types (PDF, DOCX, TXT, CSV, XLSX, PPTX, MD)
   - **URL**: Enter a URL to automatically extract and process web content
   - **Text**: Directly paste or type text content
3. For each knowledge source, you can:
   - Provide a name and optional description
   - Enable/disable RAG (Retrieval-Augmented Generation) for large documents
4. Manage your knowledge sources:
   - View all saved knowledge sources
   - Delete knowledge sources you no longer need
   - Attach knowledge sources to specific conversations
5. Use knowledge in conversations:
   - Attached knowledge sources will be used to enhance AI responses
   - The AI will automatically reference relevant knowledge when answering questions

## Contributing

1. Fork the repository
2. Create a new branch for your feature
3. Make your changes
4. Submit a pull request

## License

MIT