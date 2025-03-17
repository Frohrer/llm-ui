import type { LLMProvider, ModelConfig, Message } from "../types";
import { SiOpenai } from "react-icons/si";
import type { ProviderConfig } from "./config.types";

export class OpenAIProvider implements LLMProvider {
  id: string;
  name: string;
  icon = SiOpenai;
  models: ModelConfig[];

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.models = config.models;
  }

  async sendMessage(
    message: string,
    conversationId?: string,
    context: Message[] = [],
    attachment?: {
      type: 'document' | 'image';
      url: string;
      text?: string;
      name: string;
    }
  ): Promise<string> {
    console.log("OpenAI Provider sending message with attachment:", attachment);
    
    const response = await fetch("/api/chat/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        conversationId,
        context,
        model: this.models.find((m) => m.defaultModel)?.id || this.models[0].id,
        attachment
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to send message to OpenAI");
    }

    const data = await response.json();
    return data.response;
  }
}
