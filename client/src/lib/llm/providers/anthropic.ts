import type { LLMProvider, ModelConfig, Message } from "../types";
import { SiAntdesign } from "react-icons/si";
import type { ProviderConfig } from "../../../../server/config/loader";

export class AnthropicProvider implements LLMProvider {
  id: string;
  name: string;
  icon = SiAntdesign;
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
  ): Promise<string> {
    const response = await fetch("/api/chat/anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        conversationId,
        context,
        model: this.models.find((m) => m.defaultModel)?.id || this.models[0].id,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to send message to Anthropic");
    }

    const data = await response.json();
    return data.response;
  }
}