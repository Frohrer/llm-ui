import type { LLMProvider, ModelConfig, Message } from '../types';
import { SiAntdesign } from 'react-icons/si';

export class AnthropicProvider implements LLMProvider {
  id = 'anthropic';
  name = 'Anthropic Claude';
  icon = SiAntdesign;
  models: ModelConfig[] = [
    {
      id: 'claude-3-5-sonnet-20241022',
      name: 'Claude 3.5 Sonnet',
      contextLength: 200000,
      defaultModel: true
    }
  ];

  async sendMessage(message: string, conversationId?: string, context: Message[] = []): Promise<string> {
    const response = await fetch('/api/chat/anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        conversationId,
        context
      })
    });

    if (!response.ok) {
      throw new Error('Failed to send message to Anthropic');
    }

    const data = await response.json();
    return data.response;
  }
}