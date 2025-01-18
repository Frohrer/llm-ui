import type { LLMProvider, ModelConfig, Message } from '../types';
import { SiOpenai } from 'react-icons/si';

export class OpenAIProvider implements LLMProvider {
  id = 'openai';
  name = 'OpenAI';
  icon = SiOpenai;
  models: ModelConfig[] = [
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      contextLength: 4096,
      defaultModel: true
    },
    {
      id: 'gpt-4',
      name: 'GPT-4',
      contextLength: 8192,
      defaultModel: false
    }
  ];

  async sendMessage(message: string, conversationId?: string, context: Message[] = []): Promise<string> {
    const response = await fetch('/api/chat/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message,
        conversationId,
        context
      })
    });

    if (!response.ok) {
      throw new Error('Failed to send message to OpenAI');
    }

    const data = await response.json();
    return data.response;
  }
}