import type { LLMProvider } from '../types';
import { SiOpenai } from 'react-icons/si';

export class OpenAIProvider implements LLMProvider {
  id = 'openai';
  name = 'OpenAI';
  icon = SiOpenai;

  async sendMessage(message: string): Promise<string> {
    const response = await fetch('/api/chat/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      throw new Error('Failed to send message to OpenAI');
    }

    const data = await response.json();
    return data.response;
  }
}
