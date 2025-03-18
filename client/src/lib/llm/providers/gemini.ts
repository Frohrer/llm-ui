import type { LLMProvider, ModelConfig, Message, Attachment } from "../types";
import { SiGoogle } from "react-icons/si";
import type { ProviderConfig } from "./config.types";

export class GeminiProvider implements LLMProvider {
  id: string;
  name: string;
  icon = SiGoogle;
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
    attachment?: Attachment,
    allAttachments?: Attachment[]
  ): Promise<string> {
    console.log("Gemini Provider sending message with attachments:", allAttachments?.length || 0);
    
    const response = await fetch("/api/chat/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        conversationId,
        context,
        model: this.models.find((m) => m.defaultModel)?.id || this.models[0].id,
        attachment,
        allAttachments
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to send message to Gemini");
    }

    const data = await response.json();
    return data.response;
  }
}