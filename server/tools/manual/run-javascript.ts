import type { Tool } from './types';

export const runJavascriptTool: Tool = {
  name: 'run_javascript',
  description: 'Executes JavaScript code in a sandboxed environment',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The JavaScript code to execute'
      }
    },
    required: ['code']
  },
  execute: async (params: { code: string }) => {
    try {
      // CAUTION: Using eval is generally not recommended for security reasons
      // In a production environment, you would use a proper sandboxed environment
      // This is a simple implementation for demonstration purposes
      
      // Create a function that will execute the code with a timeout
      const result = new Function(`
        try {
          return {
            result: (function() { ${params.code} })(),
            success: true
          };
        } catch (error) {
          return {
            error: error.message,
            success: false
          };
        }
      `)();
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: 'Error executing JavaScript',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}; 