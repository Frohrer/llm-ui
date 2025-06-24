import type { Tool } from './types';

export const calculatorTool: Tool = {
  name: 'calculator',
  description: 'Performs basic arithmetic calculations',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The arithmetic expression to evaluate (e.g., "2 + 2")'
      }
    },
    required: ['expression']
  },
  execute: async (params: { expression: string }) => {
    try {
      // Simple and safe evaluation using Function constructor
      // This is safer than eval() but still limited to basic arithmetic
      const sanitizedExpression = params.expression
        .replace(/[^0-9+\-*/().%\s]/g, '')  // Only allow math operators and digits
        .trim();
      
      if (!sanitizedExpression) {
        return { result: 'Invalid expression' };
      }
      
      // Use Function constructor for safer evaluation
      const result = new Function(`return ${sanitizedExpression}`)();
      return { result: result.toString() };
    } catch (error) {
      return { 
        error: 'Error evaluating expression',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}; 