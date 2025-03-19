import { Response } from 'express';
import { prepareKnowledgeContentForConversation } from './knowledge-service';

/**
 * Handles knowledge content preparation and notification for conversations
 * 
 * @param conversationId - The conversation ID
 * @param message - The user message (for RAG context)
 * @param res - Express response object for streaming notifications
 * @returns Content string from knowledge sources
 */
export async function handleKnowledgePreparation(
  conversationId: number, 
  message: string,
  res: Response
): Promise<string> {
  try {
    // Get knowledge content and sources used
    const knowledgeData = await prepareKnowledgeContentForConversation(conversationId, message);
    const knowledgeContent = knowledgeData.content;
    const knowledgeSources = knowledgeData.usedSources;
    
    if (knowledgeContent && knowledgeSources.length > 0) {
      console.log(`Retrieved knowledge content from ${knowledgeSources.length} sources for conversation`);
      
      // Add a notification about the knowledge sources being used
      const sourceNames = knowledgeSources.map(source => source.name);
      const displayString = sourceNames.length === 1 
        ? `Using knowledge from "${sourceNames[0]}"`
        : `Using knowledge from: ${sourceNames.join(', ')}`;
      
      // Send notification to client about knowledge source usage
      // This message will be displayed in the chat window but not stored in the database
      res.write(`data: ${JSON.stringify({ notification: displayString, type: 'knowledge' })}\n\n`);
    }
    
    return knowledgeContent;
  } catch (error) {
    console.error("Error retrieving knowledge content:", error);
    return '';
  }
}