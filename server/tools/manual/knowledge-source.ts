import { Tool } from '../index';
import {
  createKnowledgeSourceFromText,
  createKnowledgeSourceFromUrl,
  getKnowledgeSources,
  getKnowledgeSource,
  deleteKnowledgeSource,
  updateKnowledgeSourceText,
  type CreateKnowledgeSourceTextOptions,
  type CreateKnowledgeSourceUrlOptions
} from '../../knowledge-service';

export const knowledgeSourceTool: Tool = {
  name: 'knowledge_source',
  description: 'Create and manage knowledge sources that can be used by AI for context and information retrieval',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create_text', 'create_url', 'list', 'get', 'delete', 'update'],
        description: 'The action to perform on knowledge sources'
      },
      userId: {
        type: 'number',
        description: 'The ID of the user creating/managing the knowledge source'
      },
      name: {
        type: 'string',
        description: 'Name of the knowledge source'
      },
      description: {
        type: 'string',
        description: 'Optional description of the knowledge source'
      },
      text: {
        type: 'string',
        description: 'Text content for creating or updating a knowledge source'
      },
      url: {
        type: 'string',
        description: 'URL to create a knowledge source from'
      },
      id: {
        type: 'number',
        description: 'ID of the knowledge source for get/delete/update operations'
      },
      useRag: {
        type: 'boolean',
        description: 'Whether to use RAG (Retrieval Augmented Generation) for this knowledge source'
      }
    },
    required: ['action', 'userId']
  },
  execute: async (params: any) => {
    try {
      const { action, userId, name, description, text, url, id, useRag } = params;

      switch (action) {
        case 'create_text':
          if (!text) throw new Error('Text content is required for create_text action');
          if (!name) throw new Error('Name is required for create_text action');
          
          const textOptions: CreateKnowledgeSourceTextOptions = {
            userId,
            name,
            description,
            text,
            useRag
          };
          return await createKnowledgeSourceFromText(textOptions);

        case 'create_url':
          if (!url) throw new Error('URL is required for create_url action');
          if (!name) throw new Error('Name is required for create_url action');
          
          const urlOptions: CreateKnowledgeSourceUrlOptions = {
            userId,
            name,
            description,
            url,
            useRag
          };
          return await createKnowledgeSourceFromUrl(urlOptions);

        case 'list':
          return await getKnowledgeSources(userId);

        case 'get':
          if (!id) throw new Error('ID is required for get action');
          return await getKnowledgeSource(userId, id);

        case 'delete':
          if (!id) throw new Error('ID is required for delete action');
          return await deleteKnowledgeSource(userId, id);

        case 'update':
          if (!id) throw new Error('ID is required for update action');
          return await updateKnowledgeSourceText({
            userId,
            id,
            name,
            description,
            text,
            useRag
          });

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      console.error('Error in knowledge source tool:', error);
      throw error;
    }
  }
}; 