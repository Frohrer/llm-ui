import type { Tool } from './types';

export const getDatetimeTool: Tool = {
  name: 'get_datetime',
  description: 'Returns the current date and time',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: 'Optional format string (ISO, UTC, locale)',
        enum: ['ISO', 'UTC', 'locale']
      },
      timezone: {
        type: 'string',
        description: 'Optional timezone identifier (e.g., "America/New_York")'
      }
    }
  },
  execute: async (params: { format?: string, timezone?: string }) => {
    try {
      const now = new Date();
      const format = params.format || 'ISO';
      
      let result: string;
      switch (format.toUpperCase()) {
        case 'UTC':
          result = now.toUTCString();
          break;
        case 'LOCALE':
          // Use timezone if provided, otherwise use local timezone
          if (params.timezone) {
            result = now.toLocaleString('en-US', { timeZone: params.timezone });
          } else {
            result = now.toLocaleString();
          }
          break;
        case 'ISO':
        default:
          result = now.toISOString();
          break;
      }
      
      return {
        datetime: result,
        timestamp: now.getTime(),
        timezone: params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    } catch (error) {
      return {
        error: 'Error getting date and time',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}; 