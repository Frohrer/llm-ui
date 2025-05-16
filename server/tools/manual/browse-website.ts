import type { Tool } from './types';

export const browseWebsiteTool: Tool = {
  name: 'browse_website',
  description: 'Fetches content from a website URL with customizable headers to avoid WAF blocks',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the website to browse'
      },
      customHeaders: {
        type: 'boolean',
        description: 'Whether to use custom headers to avoid being blocked (default: true)'
      }
    },
    required: ['url']
  },
  execute: async (params: { url: string, customHeaders?: boolean }) => {
    try {
      const useCustomHeaders = params.customHeaders !== false; // Default to true
      
      // Define headers to help avoid WAF blocks
      const headers: Record<string, string> = useCustomHeaders ? {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Cache-Control': 'max-age=0'
      } : {};
      
      // Actual implementation using fetch
      const response = await fetch(params.url, {
        method: 'GET',
        headers: headers,
        redirect: 'follow',
        // Set a reasonable timeout
        signal: AbortSignal.timeout(15000)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
      
      // Get response data based on content type
      const contentType = response.headers.get('content-type') || '';
      let content;
      
      if (contentType.includes('application/json')) {
        content = await response.json();
      } else {
        // Default to text for HTML and other formats
        content = await response.text();
      }
      
      // Get final URL (in case of redirects)
      const finalUrl = response.url;
      
      return {
        success: true,
        url: finalUrl,
        originalUrl: params.url,
        statusCode: response.status,
        contentType: contentType,
        headers: Object.fromEntries(response.headers.entries()),
        content: content
      };
    } catch (error) {
      return {
        success: false,
        error: 'Error browsing website',
        details: error instanceof Error ? error.message : 'Unknown error',
        url: params.url
      };
    }
  }
}; 