import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { getToolDefinitions, executeTool } from '../tools';

// Brief system prompt optimized for voice responses
const VOICE_SYSTEM_PROMPT = `You are a helpful AI assistant. Keep responses EXTREMELY brief since they're spoken aloud - aim for 1-2 sentences maximum. Be direct and conversational. Only elaborate if explicitly asked. Use tools when needed, but summarize results in one clear sentence.`;

/**
 * Handle OpenAI Realtime API WebSocket connection
 * This provides voice chat with full access to all agentic tools
 */
export async function handleRealtimeVoiceConnection(ws: WebSocket, req: IncomingMessage) {
  console.log('[Realtime Voice] New connection established');

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

  // Connect to OpenAI Realtime API
  const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
  let openaiWs: WebSocket | null = null;

  try {
    openaiWs = new WebSocket(url, {
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
          instructions: VOICE_SYSTEM_PROMPT,
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
    openaiWs.on('close', (code, reason) => {
      console.log('[Realtime Voice] OpenAI connection closed:', code, reason.toString());
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(code, reason.toString());
      }
    });

    // Handle client disconnection
    ws.on('close', (code, reason) => {
      console.log('[Realtime Voice] Client disconnected:', code, reason.toString());
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

