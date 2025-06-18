import type { Tool } from './types';

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web using Brave Search API',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query'
      },
      count: {
        type: 'number',
        description: 'Number of results to return (default: 10)',
        minimum: 1,
        maximum: 20
      },
      search_lang: {
        type: 'string',
        description: 'Search language (e.g., "en", "fr")',
        default: 'en'
      },
      safesearch: {
        type: 'string',
        description: 'Safe search level',
        enum: ['off', 'moderate', 'strict'],
        default: 'off'
      }
    },
    required: ['query']
  },
  execute: async (params: { 
    query: string, 
    count?: number,
    search_lang?: string,
    safesearch?: string 
  }) => {
    try {
      const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;
      
      if (!BRAVE_API_KEY) {
        throw new Error('Brave Search API key not configured');
      }

      const searchParams = new URLSearchParams({
        q: params.query,
        count: (params.count || 10).toString(),
        search_lang: params.search_lang || 'en',
        safesearch: params.safesearch || 'off'
      });

      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${searchParams}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': BRAVE_API_KEY
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Brave Search API error: ${response.status} ${response.statusText}. Details: ${errorText}`);
      }

      const data = await response.json();
      
      // Handle both web and location results if present
      const results = [];
      
      if (data.web?.results) {
        results.push(...data.web.results.map((result: any) => ({
          type: 'web',
          title: result.title,
          description: result.description,
          url: result.url,
          published_date: result.published_date
        })));
      }
      
      if (data.locations?.results) {
        results.push(...data.locations.results.map((result: any) => ({
          type: 'location',
          id: result.id,
          title: result.title
        })));
      }

      return {
        success: true,
        results,
        total_results: data.web?.total || 0,
        query: params.query,
        locations_count: data.locations?.results?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: 'Error searching the web',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}; 