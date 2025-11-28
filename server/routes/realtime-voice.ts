import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { getToolDefinitions, executeTool } from '../tools';
import { db } from '@db';
import { users, conversations, messages } from '@db/schema';
import { eq } from 'drizzle-orm';

// Brief system prompt optimized for voice responses
const VOICE_SYSTEM_PROMPT = `You are a helpful AI assistant. Keep responses EXTREMELY brief since they're spoken aloud - aim for 1-2 sentences maximum. Be direct and conversational. Only elaborate if explicitly asked. Use tools when needed, but summarize results in one clear sentence.`;

// Helper to get user from WebSocket request
async function getUserFromRequest(req: IncomingMessage): Promise<{ id: number; email: string } | null> {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const userEmail = req.headers['cf-access-authenticated-user-email'];

  try {
    let user;

    if (!userEmail && isDevelopment) {
      // In development, use a test user if no Cloudflare header
      const testEmail = 'test@example.com';
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, testEmail))
        .limit(1);

      if (!user) {
        const [newUser] = await db
          .insert(users)
          .values({ email: testEmail })
          .returning();
        user = newUser;
      }
    } else if (typeof userEmail === 'string') {
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, userEmail))
        .limit(1);

      if (!user) {
        const [newUser] = await db
          .insert(users)
          .values({ email: userEmail })
          .returning();
        user = newUser;
      }
    }

    return user ? { id: user.id, email: user.email } : null;
  } catch (error) {
    console.error('[Realtime Voice] Auth error:', error);
    return null;
  }
}

/**
 * Handle OpenAI Realtime API WebSocket connection
 * This provides voice chat with full access to all agentic tools
 * Supports persistent conversations that are saved and can be resumed
 */
export async function handleRealtimeVoiceConnection(ws: WebSocket, req: IncomingMessage) {
  console.log('[Realtime Voice] New connection established');

  // Get user authentication
  const user = await getUserFromRequest(req);
  if (!user) {
    console.error('[Realtime Voice] Unauthorized connection attempt');
    ws.close(1008, 'Unauthorized');
    return;
  }

  // Parse query parameters
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const conversationIdParam = url.searchParams.get('conversationId');
  
  // Track conversation state
  let conversationId: number | null = conversationIdParam ? parseInt(conversationIdParam) : null;
  let pendingUserTranscript = '';
  let pendingAssistantResponse = '';
  let currentItemId: string | null = null;

  // Verify conversation ownership if resuming
  if (conversationId) {
    const existingConversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    
    if (!existingConversation || existingConversation.user_id !== user.id) {
      console.error('[Realtime Voice] Conversation not found or unauthorized:', conversationId);
      conversationId = null; // Will create new conversation
    } else {
      console.log('[Realtime Voice] Resuming conversation:', conversationId);
    }
  }

  // Get the OpenAI API key from environment
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    console.error('[Realtime Voice] OPENAI_API_KEY not found in environment');
    ws.close(1008, 'OpenAI API key not configured');
    return;
  }

  // Get all available tools in OpenAI format
  let tools: any[] = [];
  try {
    const toolDefinitions = await getToolDefinitions();
    tools = toolDefinitions.map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
    }));
    console.log(`[Realtime Voice] Loaded ${tools.length} tools:`, tools.map(t => t.name).join(', '));
  } catch (error) {
    console.error('[Realtime Voice] Error loading tools:', error);
  }

  // Load previous messages if resuming a conversation
  let previousMessages: Array<{ role: string; content: string }> = [];
  if (conversationId) {
    try {
      const existingMessages = await db.query.messages.findMany({
        where: eq(messages.conversation_id, conversationId),
        orderBy: (messages, { asc }) => [asc(messages.created_at)],
      });
      
      previousMessages = existingMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          content: m.content
        }));
      
      console.log(`[Realtime Voice] Loaded ${previousMessages.length} previous messages`);
    } catch (error) {
      console.error('[Realtime Voice] Error loading previous messages:', error);
    }
  }

  // Build context instructions with previous messages
  let contextInstructions = VOICE_SYSTEM_PROMPT;
  if (previousMessages.length > 0) {
    const contextSummary = previousMessages
      .slice(-10) // Include last 10 messages for context
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    
    contextInstructions = `${VOICE_SYSTEM_PROMPT}

Previous conversation context (continue naturally from here):
${contextSummary}`;
  }

  // Connect to OpenAI Realtime API
  const realtimeUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
  let openaiWs: WebSocket | null = null;

  // Helper to save user message
  async function saveUserMessage(content: string): Promise<void> {
    if (!content.trim()) return;
    
    try {
      const timestamp = new Date();
      
      // Create conversation if needed
      if (!conversationId) {
        const title = content.slice(0, 100) || 'Voice Conversation';
        const [newConversation] = await db
          .insert(conversations)
          .values({
            title,
            provider: 'openai-realtime',
            model: 'gpt-4o-realtime',
            user_id: user.id,
            created_at: timestamp,
            last_message_at: timestamp,
          })
          .returning();
        
        conversationId = newConversation.id;
        console.log('[Realtime Voice] Created new conversation:', conversationId);
        
        // Send conversation ID to client
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'conversation.created',
            conversationId: conversationId
          }));
        }
      }
      
      // Save user message
      await db.insert(messages).values({
        conversation_id: conversationId,
        role: 'user',
        content,
        metadata: { source: 'voice' },
        created_at: timestamp,
      });
      
      console.log('[Realtime Voice] Saved user message:', content.slice(0, 50) + '...');
    } catch (error) {
      console.error('[Realtime Voice] Error saving user message:', error);
    }
  }

  // Helper to save assistant message
  async function saveAssistantMessage(content: string): Promise<void> {
    if (!content.trim() || !conversationId) return;
    
    try {
      const timestamp = new Date();
      
      await db.insert(messages).values({
        conversation_id: conversationId,
        role: 'assistant',
        content,
        metadata: { source: 'voice' },
        created_at: timestamp,
      });
      
      // Update conversation last_message_at
      await db
        .update(conversations)
        .set({ last_message_at: timestamp })
        .where(eq(conversations.id, conversationId));
      
      console.log('[Realtime Voice] Saved assistant message:', content.slice(0, 50) + '...');
    } catch (error) {
      console.error('[Realtime Voice] Error saving assistant message:', error);
    }
  }

  try {
    openaiWs = new WebSocket(realtimeUrl, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    // Handle OpenAI connection open
    openaiWs.on('open', () => {
      console.log('[Realtime Voice] Connected to OpenAI Realtime API');

      // Send session configuration
      const sessionConfig = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: contextInstructions,
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
          },
          tools: tools,
          tool_choice: 'auto',
          temperature: 0.8,
          max_response_output_tokens: 4096
        }
      };

      openaiWs!.send(JSON.stringify(sessionConfig));
      console.log('[Realtime Voice] Session configured with tools and voice settings');
      
      // Send current conversation ID to client (if resuming)
      if (conversationId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'conversation.resumed',
          conversationId: conversationId
        }));
      }
    });

    // Forward messages from client to OpenAI
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Log non-audio messages for debugging
        if (message.type !== 'input_audio_buffer.append') {
          console.log('[Realtime Voice] Client -> OpenAI:', message.type);
        }

        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(data.toString());
        }
      } catch (error) {
        console.error('[Realtime Voice] Error forwarding client message:', error);
      }
    });

    // Handle messages from OpenAI
    openaiWs.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // Log non-audio messages for debugging
        if (message.type !== 'response.audio.delta' && message.type !== 'response.audio_transcript.delta') {
          console.log('[Realtime Voice] OpenAI -> Client:', message.type);
        }

        // Track user transcription
        if (message.type === 'conversation.item.input_audio_transcription.completed') {
          pendingUserTranscript = message.transcript || '';
          currentItemId = message.item_id;
          
          // Save user message to database
          await saveUserMessage(pendingUserTranscript);
        }

        // Track assistant response (text transcript)
        if (message.type === 'response.audio_transcript.delta') {
          if (message.item_id !== currentItemId) {
            // New response started
            if (pendingAssistantResponse && currentItemId) {
              // Save previous response if any
              await saveAssistantMessage(pendingAssistantResponse);
            }
            currentItemId = message.item_id;
            pendingAssistantResponse = message.delta || '';
          } else {
            pendingAssistantResponse += message.delta || '';
          }
        }

        // Save assistant response when complete
        if (message.type === 'response.audio_transcript.done') {
          if (pendingAssistantResponse) {
            await saveAssistantMessage(pendingAssistantResponse);
            pendingAssistantResponse = '';
          }
        }

        // Handle function/tool calls
        if (message.type === 'response.function_call_arguments.done') {
          console.log('[Realtime Voice] Tool call:', message.name, message.arguments);
          
          try {
            // Execute the tool
            const args = JSON.parse(message.arguments);
            const toolResult = await executeTool(message.name, args);
            
            console.log('[Realtime Voice] Tool result:', {
              tool: message.name,
              success: true,
              resultPreview: typeof toolResult === 'string' 
                ? toolResult.substring(0, 100) 
                : JSON.stringify(toolResult).substring(0, 100)
            });

            // Save tool call as a message
            if (conversationId) {
              await db.insert(messages).values({
                conversation_id: conversationId,
                role: 'tool',
                content: JSON.stringify({ tool: message.name, args, result: toolResult }),
                metadata: { source: 'voice', tool_name: message.name },
                created_at: new Date(),
              });
            }

            // Send the tool result back to OpenAI
            const toolResponse = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: message.call_id,
                output: JSON.stringify(toolResult)
              }
            };

            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify(toolResponse));
              
              // Request a new response that incorporates the tool result
              openaiWs.send(JSON.stringify({
                type: 'response.create'
              }));
            }
          } catch (toolError) {
            console.error('[Realtime Voice] Tool execution error:', toolError);
            
            // Send error back to OpenAI
            const errorResponse = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: message.call_id,
                output: JSON.stringify({
                  error: toolError instanceof Error ? toolError.message : 'Tool execution failed'
                })
              }
            };

            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify(errorResponse));
            }
          }
        }

        // Forward all messages to the client
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data.toString());
        }
      } catch (error) {
        console.error('[Realtime Voice] Error handling OpenAI message:', error);
      }
    });

    // Handle OpenAI errors
    openaiWs.on('error', (error) => {
      console.error('[Realtime Voice] OpenAI WebSocket error:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          error: {
            message: 'OpenAI connection error',
            details: error.message
          }
        }));
      }
    });

    // Handle OpenAI connection close
    openaiWs.on('close', async (code, reason) => {
      console.log('[Realtime Voice] OpenAI connection closed:', code, reason.toString());
      
      // Save any pending assistant response
      if (pendingAssistantResponse) {
        await saveAssistantMessage(pendingAssistantResponse);
        pendingAssistantResponse = '';
      }
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(code, reason.toString());
      }
    });

    // Handle client disconnection
    ws.on('close', async (code, reason) => {
      console.log('[Realtime Voice] Client disconnected:', code, reason.toString());
      
      // Save any pending assistant response
      if (pendingAssistantResponse) {
        await saveAssistantMessage(pendingAssistantResponse);
        pendingAssistantResponse = '';
      }
      
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
    });

    // Handle client errors
    ws.on('error', (error) => {
      console.error('[Realtime Voice] Client WebSocket error:', error);
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
    });

  } catch (error) {
    console.error('[Realtime Voice] Error setting up OpenAI connection:', error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'Internal server error');
    }
  }
}
