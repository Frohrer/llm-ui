import type { LLMProvider, ModelConfig, Message } from "../types";
import { SiOpenai } from "react-icons/si";

export class OpenAIProvider implements LLMProvider {
  id = "openai";
  name = "OpenAI";
  icon = SiOpenai;
  models: ModelConfig[] = [
    {
      id: "gpt-4o",
      name: "GPT-4 Omni",
      contextLength: 128000,
      defaultModel: true,
    },
    {
      id: "gpt-4o-mini",
      name: "GPT-4 Omni Mini",
      contextLength: 128000,
      defaultModel: false,
    },
    {
      id: "o1",
      name: "O1",
      contextLength: 128000,
      defaultModel: false,
    },
    {
      id: "o1-mini",
      name: "O1 Mini",
      contextLength: 128000,
      defaultModel: false,
    },
  ];

  async sendMessage(
    message: string,
    conversationId?: string,
    context: Message[] = [],
  ): Promise<string> {
    const response = await fetch("/api/chat/openai", {
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
      throw new Error("Failed to send message to OpenAI");
    }

    const data = await response.json();
    return data.response;
  }
}
