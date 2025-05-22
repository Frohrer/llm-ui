import type { Tool } from './types';
import axios from 'axios';
import { createHmac, createHash } from 'crypto';

// Function to create JWT without jsonwebtoken dependency
function createJWT(payload: any, secret: string, header: any): string {
  const encodeBase64Url = (str: string): string => {
    return Buffer.from(str)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  };

  const headerStr = encodeBase64Url(JSON.stringify(header));
  const payloadStr = encodeBase64Url(JSON.stringify(payload));
  
  const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${headerStr}.${payloadStr}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerStr}.${payloadStr}.${signature}`;
}

interface GhostPostParams {
  title: string;
  content: string;
  apiUrl?: string;
  apiKey?: string;
  status?: string;
  tags?: string[];
}

export const ghostBlogTool: Tool = {
  name: 'ghost_blog_post',
  description: 'Create and publish a post to a Ghost blog using the Ghost Admin API',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The title of the blog post'
      },
      content: {
        type: 'string',
        description: 'The markdown content of the blog post'
      },
      status: {
        type: 'string',
        enum: ['draft', 'published'],
        description: 'The status of the post (draft or published)'
      },
      tags: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Optional array of tag names to assign to the post'
      }
    },
    required: ['title', 'content']
  },
  execute: async (params: GhostPostParams) => {
    try {
      const { title, content, status = 'published', tags = [] } = params;
      
      // Get API URL and key from environment variables or provided params
      const apiUrl = params.apiUrl || process.env.GHOST_API_URL;
      const apiKey = params.apiKey || process.env.GHOST_API_KEY;
      
      if (!apiUrl) {
        throw new Error('Ghost API URL not provided. Set GHOST_API_URL environment variable or provide apiUrl parameter');
      }
      
      if (!apiKey) {
        throw new Error('Ghost API key not provided. Set GHOST_API_KEY environment variable or provide apiKey parameter');
      }

      // Split the key into ID and SECRET
      const [id, secret] = apiKey.split(':');
      if (!id || !secret) {
        throw new Error('Invalid API key format. Expected format: "id:secret"');
      }

      // Prepare header and payload
      const iat = Math.floor(Date.now() / 1000);
      const header = { alg: 'HS256', typ: 'JWT', kid: id };
      const payload = {
        iat,
        exp: iat + 5 * 60, // Token expires in 5 minutes
        aud: '/v3/admin/'
      };

      // Create the token using our custom function instead of jwt.sign
      const token = createJWT(payload, secret, header);

      // Set up headers
      const headers = {
        'Authorization': `Ghost ${token}`,
        'Content-Type': 'application/json'
      };

      // Prepare Ghost mobiledoc format
      const mobiledoc = JSON.stringify({
        version: '0.3.1',
        markups: [],
        atoms: [],
        cards: [
          [
            'markdown',
            {
              markdown: content
            }
          ]
        ],
        sections: [
          [
            10,
            0
          ]
        ]
      });

      // Prepare request data
      const data = {
        posts: [
          {
            title,
            mobiledoc,
            status,
            tags: tags.map(name => ({ name }))
          }
        ]
      };

      // Make the request
      const response = await axios.post(apiUrl, data, { headers });

      if (response.status === 201) {
        const post = response.data.posts[0];
        return {
          success: true,
          url: post.url,
          id: post.id,
          title: post.title,
          status: post.status
        };
      } else {
        throw new Error(`Error creating blog post: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error in ghost blog post tool:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}; 