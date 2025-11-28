import express, { Request, Response } from 'express';
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { getAnthropicClient } from './anthropic';
import { getOpenAIClient } from './openai';
import { getGeminiClient } from './gemini';
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";

const router = express.Router();

// Initialize function - depends on other providers being initialized
export function initializeSuperModel() {
  const anthropicClient = getAnthropicClient();
  const openaiClient = getOpenAIClient();
  const geminiClient = getGeminiClient();
  
  return anthropicClient && openaiClient && geminiClient;
}

// Get availability status
export function getSuperModelStatus() {
  return {
    available: initializeSuperModel(),
    anthropic: !!getAnthropicClient(),
    openai: !!getOpenAIClient(),
    gemini: !!getGeminiClient()
  };
}

// Helper function to call a model and get response
async function callModel(provider: string, model: string, messages: any[]): Promise<string> {
  try {
    switch (provider) {
      case 'anthropic': {
        const client = getAnthropicClient();
        if (!client) throw new Error('Anthropic client not available');
        
        const response = await client.messages.create({
          model: model,
          max_tokens: 4000,
          messages: messages.map(msg => ({
            role: msg.role === 'system' ? 'user' : msg.role,
            content: msg.role === 'system' ? `System: ${msg.content}` : msg.content
          }))
        });
        
        const content = response.content[0];
        return content.type === 'text' ? content.text : '';
      }
      
      case 'openai': {
        const client = getOpenAIClient();
        if (!client) throw new Error('OpenAI client not available');
        
        // o3 model uses max_completion_tokens instead of max_tokens and doesn't support custom temperature
        const requestOptions: any = {
          model: model,
          messages: messages
        };
        
        if (model === 'o3') {
          requestOptions.max_completion_tokens = 4000;
          // o3 only supports default temperature (1), so we don't set it
        } else {
          requestOptions.max_tokens = 4000;
          requestOptions.temperature = 0.7;
        }
        
        const response = await client.chat.completions.create(requestOptions);
        
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
        
        // Start chat with history
        const chat = genModel.startChat({
          history,
          generationConfig: {
            maxOutputTokens: 4000,
            temperature: 0.7
          }
        });
        
        // Send the current message
        const result = await chat.sendMessage(currentMessage);
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
    }

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
      res.write(`data: ${JSON.stringify({ type: "chunk", content: '🤖 Consulting Sonnet 4, o-3, and Gemini 2.5 Pro...\n\n' })}\n\n`);

      // Step 1: Call all three models in parallel
      const modelCalls = [
        callModel('anthropic', 'claude-sonnet-4-5', apiMessages),
        callModel('openai', 'o3', apiMessages),
        callModel('gemini', 'gemini-2.5-pro', apiMessages)
      ];

      const [sonnetResponse, o3Response, geminiResponse] = await Promise.all(modelCalls);

      // Send intermediate status as chunk
      res.write(`data: ${JSON.stringify({ type: "chunk", content: '🔄 Synthesizing responses with o-3...\n\n' })}\n\n`);

      // Step 2: Create synthesis prompt for o-3
      const synthesisPrompt = `You are an expert AI that synthesizes responses from multiple AI models to provide the best possible answer.

Below are responses from three different AI models to the user's query:

**Original User Query:**
${currentMessage}

**Claude Sonnet 4 Response:**
${sonnetResponse}

**o-3 Response:**
${o3Response}

**Gemini 2.5 Pro Response:**
${geminiResponse}

Please synthesize these three responses into a single, comprehensive, and high-quality answer that:
1. Takes the best insights from each response
2. Resolves any contradictions between responses
3. Provides additional context or corrections if needed
4. Maintains a coherent and natural tone
5. Is more helpful than any individual response

Your synthesized response:`;

      // Step 3: Send synthesis prompt to o-3
      const synthesisMessages = [
        { role: "user", content: synthesisPrompt }
      ];

      const finalResponse = await callModel('openai', 'o3', synthesisMessages);

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