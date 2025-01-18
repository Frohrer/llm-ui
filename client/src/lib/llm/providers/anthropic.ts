import type { LLMProvider } from '../types';
import { SiAntdesign } from 'react-icons/si';

export class AnthropicProvider implements LLMProvider {
  id = 'anthropic';
  name = 'Anthropic Claude';
  icon = SiAntdesign;

  async sendMessage(message: string): Promise<string> {
    const response = await fetch('/api/chat/anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      throw new Error('Failed to send message to Anthropic');
    }

    const data = await response.json();
    return data.response;
  }
}
