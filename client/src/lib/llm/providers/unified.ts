import type { LLMProvider, Message, Attachment, ProviderConfig } from '../types';

export class UnifiedProvider implements LLMProvider {
  id: string;
  name: string;
  icon: string;
  models: any[];

  constructor(public config: ProviderConfig) {
    // Validate config
    if (!config.id || !config.name) {
      console.error('Invalid provider config:', config);
      throw new Error('Provider config must have id and name');
    }

    this.id = config.id;
    this.name = config.name;
    this.icon = config.icon;
    this.models = config.models || [];
  }

  async sendMessage(
    message: string,
    conversationId?: string,
    context?: Message[],
    attachment?: Attachment,
    allAttachments?: Attachment[]
  ): Promise<string> {
    const messages = context || [];
    messages.push({
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
      attachment,
      attachments: allAttachments
    });

    // Debug the configuration
    console.log('Provider config:', this.config);
    console.log('Available models:', this.models);

    // Get the first model or use a default if none available
    const modelId = this.models?.[0]?.id || 'default';
    console.log('Using model:', modelId);

    const response = await fetch(`/api/chat/${this.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        model: modelId
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Provider error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(`Failed to get response from ${this.name}: ${errorText}`);
    }

    const data = await response.json();
    return data.response;
  }

  async stream(
    messages: Message[],
    modelId: string,
    options: any = {}
  ): Promise<ReadableStream> {
    const response = await fetch(`/api/chat/${this.id}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        model: modelId,
        ...options
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Provider stream error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(`Failed to get stream from ${this.name}: ${errorText}`);
    }

    return response.body!;
  }
} 