import express, { Request, Response } from 'express';
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { getAnthropicClient } from './anthropic';
import { getOpenAIClient } from './openai';
import { getGeminiClient } from './gemini';
import { getGrokClient } from './grok';
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";
import { buildSystemPrompt } from "../../user-preferences-service";
import { scheduleExtraction } from "../../memory-service";
import { redactDeep, redactText, restoreText, schedulePiiClassification } from "../../pii-service";

const router = express.Router();

// Initialize function - depends on other providers being initialized
export function initializeSuperModel() {
  const anthropicClient = getAnthropicClient();
  const openaiClient = getOpenAIClient();
  const geminiClient = getGeminiClient();
  const grokClient = getGrokClient();

  // Boolean, not the last client object — this value is serialized into the
  // unauthenticated /api/health response, and the Gemini client instance
  // exposes its API key when JSON-stringified.
  return !!(anthropicClient && openaiClient && geminiClient && grokClient);
}

// Get availability status
export function getSuperModelStatus() {
  return {
    available: initializeSuperModel(),
    anthropic: !!getAnthropicClient(),
    openai: !!getOpenAIClient(),
    gemini: !!getGeminiClient(),
    grok: !!getGrokClient()
  };
}

// Helper function to call a model and get response
async function callModel(provider: string, model: string, messages: any[]): Promise<string> {
  try {
    switch (provider) {
      case 'anthropic': {
        const client = getAnthropicClient();
        if (!client) throw new Error('Anthropic client not available');

        // Fable 5 always thinks and max_tokens caps thinking + response text
        // together, so 4000 would risk truncating mid-answer. Its safety
        // classifiers can also decline a request (stop_reason "refusal");
        // on a decline the API re-runs the same request on Opus 5 server-side
        // (claude-opus-5 is in Fable 5's allowed_fallback_models).
        // Redacted: real PII must not reach the upstream API
        const response = await client.beta.messages.create(await redactDeep({
          model: model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-06-01'],
          fallbacks: [{ model: 'claude-opus-5' }],
          messages: messages.map(msg => ({
            role: msg.role === 'system' ? 'user' : msg.role,
            content: msg.role === 'system' ? `System: ${msg.content}` : msg.content
          }))
        }));

        // Whole fallback chain declined (Fable 5 AND Opus 5) — surface that
        // instead of crashing on empty content; the other three models still
        // feed the synthesis. Cast: the installed SDK's types predate "refusal".
        if ((response.stop_reason as string) === 'refusal') {
          return '[Claude declined to answer this request]';
        }

        // Content includes thinking blocks, so the text block isn't always first
        const textBlock: any = response.content.find((block: any) => block.type === 'text');
        return textBlock?.text || '';
      }

      case 'openai': {
        const client = getOpenAIClient();
        if (!client) throw new Error('OpenAI client not available');

        // GPT-5.x reasoning models require max_completion_tokens (max_tokens is
        // deprecated) and only support the default temperature. The cap covers
        // reasoning + visible output, so leave headroom above the answer length.
        const requestOptions: any = {
          model: model,
          messages: messages,
          max_completion_tokens: 16000
        };

        // Redacted: real PII must not reach the upstream API
        const response = await client.chat.completions.create(await redactDeep(requestOptions));

        return response.choices[0]?.message?.content || '';
      }

      case 'grok': {
        const client = getGrokClient();
        if (!client) throw new Error('Grok client not available');

        // Redacted: real PII must not reach the upstream API
        const response = await client.chat.completions.create(await redactDeep({
          model: model,
          messages: messages,
          max_tokens: 4000
        }));

        return response.choices[0]?.message?.content || '';
      }
      
      case 'gemini': {
        const client = getGeminiClient();
        if (!client) throw new Error('Gemini client not available');
        
        // Get the specific model
        const genModel = client.getGenerativeModel({ model });
        
        // Convert messages to Gemini history format (excluding the last message)
        const history = messages.slice(0, -1).map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        }));
        
        // Get the current message (last one)
        const currentMessage = messages[messages.length - 1]?.content || '';
        
        // Start chat with history (redacted: real PII must not reach the upstream API)
        // Gemini 3.x deprecates sampling params (temperature/top_p/top_k) — don't send them.
        const chat = genModel.startChat(await redactDeep({
          history,
          generationConfig: {
            maxOutputTokens: 4000
          }
        }));

        // Send the current message (redacted)
        const result = await chat.sendMessage(await redactText(currentMessage));
        return result.response.text();
      }
      
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    console.error(`Error calling ${provider} ${model}:`, error);
    return `[Error calling ${provider} ${model}: ${error instanceof Error ? error.message : 'Unknown error'}]`;
  }
}

// Create or continue a super model chat conversation
router.post("/", async (req: Request, res: Response) => {
  const {
    message,
    conversationId,
    context = [],
    model = "super-model-orchestrator",
    attachment = null,
    allAttachments = [],
    useKnowledge = false,
    pendingKnowledgeSources = [],
    useTools = false,
    skipSystemPrompt = false,
  } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Invalid message" });
    }
    
    // Check if all required clients are available
    const status = getSuperModelStatus();
    if (!status.available) {
      return res.status(503).json({ 
        error: "Super model service not available", 
        details: status 
      });
    }
    
    console.log(`Processing super model request: ${message.slice(0, 100)}...`);

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let conversationTitle = message.slice(0, 100);
    let dbConversation;
    let streamedResponse = "";

    // Create or update conversation
    if (!conversationId) {
      const timestamp = new Date();
      const [newConversation] = await db
        .insert(conversations)
        .values({
          title: conversationTitle,
          provider: "super-model",
          model,
          user_id: req.user!.id,
          created_at: timestamp,
          last_message_at: timestamp,
        })
        .returning();

      if (!newConversation) {
        throw new Error("Failed to create conversation");
      }

      // Save attachment metadata so it's available in future context
      const messageMetadata: any = {};
      if (allAttachments && allAttachments.length > 0) {
        messageMetadata.attachments = allAttachments;
      } else if (attachment) {
        messageMetadata.attachments = [attachment];
      }

      await db.insert(messages).values({
        conversation_id: newConversation.id,
        role: "user",
        content: message,
        metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
        created_at: timestamp,
      });

      // Add pending knowledge sources
      if (pendingKnowledgeSources && pendingKnowledgeSources.length > 0) {
        for (const knowledgeSourceId of pendingKnowledgeSources) {
          try {
            await addKnowledgeToConversation(newConversation.id, knowledgeSourceId);
          } catch (error) {
            console.error(`Failed to add knowledge source ${knowledgeSourceId} to conversation:`, error);
          }
        }
      }

      dbConversation = newConversation;
      res.on("finish", () => { if (dbConversation) scheduleExtraction(dbConversation.id, req.user!.id); });
    } else {
      const conversationIdNum = parseInt(conversationId);
      if (isNaN(conversationIdNum)) {
        throw new Error("Invalid conversation ID");
      }

      const existingConversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, conversationIdNum),
      });

      if (!existingConversation || existingConversation.user_id !== req.user!.id) {
        throw new Error("Conversation not found or unauthorized");
      }

      const timestamp = new Date();
      await db
        .update(conversations)
        .set({ last_message_at: timestamp })
        .where(eq(conversations.id, conversationIdNum));

      // Save attachment metadata so it's available in future context
      const messageMetadata: any = {};
      if (allAttachments && allAttachments.length > 0) {
        messageMetadata.attachments = allAttachments;
      } else if (attachment) {
        messageMetadata.attachments = [attachment];
      }

      await db.insert(messages).values({
        conversation_id: conversationIdNum,
        role: "user",
        content: message,
        metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
        created_at: timestamp,
      });

      // Add any pending knowledge sources to existing conversation (allows mid-conversation injection)
      if (pendingKnowledgeSources && pendingKnowledgeSources.length > 0) {
        console.log(`Adding ${pendingKnowledgeSources.length} knowledge sources to existing conversation ${conversationIdNum}`);
        
        for (const knowledgeSourceId of pendingKnowledgeSources) {
          try {
            await addKnowledgeToConversation(conversationIdNum, knowledgeSourceId);
          } catch (error) {
            console.error(`Failed to add knowledge source ${knowledgeSourceId} to conversation:`, error);
          }
        }
      }

      dbConversation = existingConversation;
      res.on("finish", () => { if (dbConversation) scheduleExtraction(dbConversation.id, req.user!.id); });
    }

    // Propose name/address entities from the raw user message (runs on local
    // Ollama only; no-op unless the classifier is enabled in admin settings).
    schedulePiiClassification(message);

    // Prepare messages for the models and include attachment content from metadata
    const apiMessages = context
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((msg: any) => {
        let content = msg.content;

        // Include attachment content from metadata for historical messages
        if (msg.metadata && msg.metadata.attachments) {
          const attachments = msg.metadata.attachments;
          const documentTexts = attachments
            .filter((att: any) => att.type === 'document' && att.text)
            .map((att: any) => `\n\n[Attached file: ${att.name}]\n${att.text}`)
            .join('\n');

          if (documentTexts) {
            content += documentTexts;
          }
        }

        return {
          role: msg.role,
          content: content,
        };
      });

    // Add knowledge content if enabled
    let knowledgeContent = '';
    if (useKnowledge && dbConversation) {
      knowledgeContent = await prepareKnowledgeContentForConversation(dbConversation.id);
    }

    // Prepare the current message with knowledge
    let currentMessage = message;
    if (knowledgeContent) {
      currentMessage += "\n\nKnowledge Sources:\n" + knowledgeContent;
    }

    // Add current message to the conversation
    apiMessages.push({
      role: "user",
      content: currentMessage,
    });

    // Build and add system prompt
    if (!skipSystemPrompt) {
      const systemPrompt = await buildSystemPrompt(req.user!.id, { latestUserMessage: message });
      if (systemPrompt) {
        apiMessages.unshift({ role: "system", content: systemPrompt });
      }
    }

    // Send initial conversation data
    res.write(
      `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
    );

    // Set up keep-alive interval
    const keepAliveInterval = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000); // Send keep-alive every 15 seconds

    try {
      // Send status update as chunk
      res.write(`data: ${JSON.stringify({ type: "chunk", content: '🤖 Consulting Claude Fable 5, GPT-5.6 Sol, Gemini 3.7 Flash, and Grok 4.6...\n\n' })}\n\n`);

      // Step 1: Call all four models in parallel
      const modelCalls = [
        callModel('anthropic', 'claude-fable-5', apiMessages),
        callModel('openai', 'gpt-5.6-sol', apiMessages),
        callModel('gemini', 'gemini-3.7-flash', apiMessages),
        callModel('grok', 'grok-4.6', apiMessages)
      ];

      const [claudeResponse, gptResponse, geminiResponse, grokResponse] = await Promise.all(modelCalls);

      // Send intermediate status as chunk
      res.write(`data: ${JSON.stringify({ type: "chunk", content: '🔄 Synthesizing responses with GPT-5.6 Terra...\n\n' })}\n\n`);

      // Step 2: Create synthesis prompt for GPT-5.6 Terra
      const synthesisPrompt = `You are an expert AI that synthesizes responses from multiple AI models to provide the best possible answer.

Below are responses from four different AI models to the user's query:

**Original User Query:**
${currentMessage}

**Claude Fable 5 Response:**
${claudeResponse}

**GPT-5.6 Sol Response:**
${gptResponse}

**Gemini 3.7 Flash Response:**
${geminiResponse}

**Grok 4.6 Response:**
${grokResponse}

Please synthesize these four responses into a single, comprehensive, and high-quality answer that:
1. Takes the best insights from each response
2. Resolves any contradictions between responses
3. Provides additional context or corrections if needed
4. Maintains a coherent and natural tone
5. Is more helpful than any individual response

Your synthesized response:`;

      // Step 3: Send synthesis prompt to GPT-5.6 Terra
      const synthesisMessages = [
        { role: "user", content: synthesisPrompt }
      ];

      // The synthesizer only ever saw PII tags; convert them back to real
      // values before anything reaches the client SSE stream or the DB.
      const finalResponse = await restoreText(await callModel('openai', 'gpt-5.6-terra', synthesisMessages));

      // Stream the final response using the correct chunk format
      streamedResponse = finalResponse;
      
      // Send the entire response as chunks (word by word for streaming effect)
      const requestStart = Date.now();
      let ttftCaptured = false;
      const words = finalResponse.split(' ');
      for (let i = 0; i < words.length; i++) {
        const chunk = words[i] + (i < words.length - 1 ? ' ' : '');
        res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
        
        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 30));
        if (!ttftCaptured) {
          ttftCaptured = true;
        }
      }

      // Save the assistant's response to database
      await db.insert(messages).values({
        conversation_id: dbConversation.id,
        role: "assistant",
        content: streamedResponse,
        metadata: { ttft_ms: 0, total_tokens: streamedResponse.length ? Math.ceil(streamedResponse.length / 2.7182818284590) + 2 : 0 },
        created_at: new Date(),
      });

      // Send completion event with updated conversation data
      const updatedConversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, dbConversation.id),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.created_at)],
          },
        },
      });

      if (!updatedConversation) {
        throw new Error("Failed to retrieve conversation");
      }

      res.write(`data: ${JSON.stringify({
        type: "end",
        conversation: transformDatabaseConversation(updatedConversation),
      })}\n\n`);

  } catch (error) {
    console.error("Super model error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    res.write(`data: ${JSON.stringify({ 
      type: "error",
      error: errorMessage 
    })}\n\n`);
  } finally {
    clearInterval(keepAliveInterval);
    res.end();
  }
});

export default router;