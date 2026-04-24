import axios from 'axios';
import type { Tool } from './types';

function createCloudflareHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (clientId && clientSecret) {
    headers['CF-Access-Client-Id'] = clientId;
    headers['CF-Access-Client-Secret'] = clientSecret;
  }
  return headers;
}

export const listLanguagesTool: Tool = {
  name: 'list_languages',
  description: 'Lists the runtimes the supakiln code execution server can run code in (e.g. python/node/ruby/bash/go), along with each one\'s file extension, package manager, and whether package installation is supported. Use this before run_code if unsure which languages are available.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    const supakilnUrl = process.env.SUPAKILN_API_URL;
    if (!supakilnUrl) {
      return {
        success: false,
        error: 'Supakiln API URL not configured',
        message: 'SUPAKILN_API_URL environment variable is not set.',
      };
    }
    try {
      const response = await axios.get(`${supakilnUrl}/languages`, {
        headers: createCloudflareHeaders(),
      });
      const data = response.data || {};
      return {
        success: true,
        languages: data.languages || [],
        runtimes: data.runtimes || [],
      };
    } catch (error) {
      console.error('[supakiln] list_languages failed:', error);
      if (axios.isAxiosError(error) && error.response) {
        return {
          success: false,
          error: `HTTP ${error.response.status}: ${error.response.statusText}`,
          message: error.response.data?.detail || 'Failed to list languages',
        };
      }
      return {
        success: false,
        error: 'Request failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
