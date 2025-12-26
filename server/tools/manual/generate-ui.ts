import type { Tool } from './types';

/**
 * Generate UI Tool
 * 
 * This tool allows the AI to generate custom UI components in responses.
 * The output will be rendered as interactive React components on the client.
 * 
 * Available components:
 * - weather-card: Display weather information
 * - data-table: Display tabular data with headers
 * - stats-card: Display a single statistic with optional trend
 * - progress-card: Display one or more progress bars
 * - alert-card: Display info/success/warning/error alerts
 * - code-block: Display syntax-highlighted code
 * - image-gallery: Display a grid of images with lightbox
 * - quote-card: Display a styled quotation
 * - timeline-card: Display a timeline of events
 * - comparison-table: Compare features across options
 * - action-buttons: Display clickable action buttons
 * - confirm-dialog: Display a confirmation dialog
 */

// Component schemas for documentation
const componentSchemas = {
  'weather-card': {
    location: 'string - City/location name',
    temperature: 'number - Current temperature',
    condition: "'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'windy' | 'partly-cloudy'",
    humidity: 'number (optional) - Humidity percentage',
    windSpeed: 'number (optional) - Wind speed in mph',
    feelsLike: 'number (optional) - Feels like temperature',
    high: 'number (optional) - Today\'s high',
    low: 'number (optional) - Today\'s low',
    unit: "'C' | 'F' (optional, default: 'F')",
  },
  'data-table': {
    title: 'string (optional) - Table title',
    description: 'string (optional) - Table description',
    columns: "array of { key: string, label: string, type?: 'text'|'number'|'badge'|'currency', align?: 'left'|'center'|'right' }",
    data: 'array of objects - Row data with keys matching column keys',
    striped: 'boolean (optional) - Show striped rows',
    compact: 'boolean (optional) - Compact mode',
  },
  'stats-card': {
    title: 'string - Stat label',
    value: 'string | number - The main value',
    description: 'string (optional) - Additional context',
    icon: 'string (optional) - Lucide icon name (e.g., "DollarSign", "Users")',
    trend: "'up' | 'down' | 'neutral' (optional)",
    trendValue: 'string (optional) - e.g., "+12%"',
    color: "'default' | 'success' | 'warning' | 'error' | 'info' (optional)",
  },
  'progress-card': {
    title: 'string (optional) - Card title',
    description: 'string (optional) - Card description',
    items: "array of { label: string, value: number, max?: number, color?: 'default'|'success'|'warning'|'error' }",
    showPercentage: 'boolean (optional, default: true)',
    showValue: 'boolean (optional, default: false)',
  },
  'alert-card': {
    title: 'string (optional) - Alert title',
    message: 'string - Alert message',
    type: "'info' | 'success' | 'warning' | 'error' (optional, default: 'info')",
  },
  'code-block': {
    code: 'string - The code to display',
    language: 'string (optional) - Programming language',
    title: 'string (optional) - Code block title',
    showLineNumbers: 'boolean (optional, default: true)',
  },
  'image-gallery': {
    title: 'string (optional) - Gallery title',
    images: "array of { url: string, alt?: string, caption?: string }",
    columns: '2 | 3 | 4 (optional, default: 3)',
    aspectRatio: "'square' | 'video' | 'portrait' (optional, default: 'square')",
  },
  'quote-card': {
    quote: 'string - The quotation text',
    author: 'string (optional) - Quote author',
    source: 'string (optional) - Source/book/publication',
    variant: "'default' | 'elegant' | 'minimal' (optional)",
  },
  'timeline-card': {
    title: 'string (optional) - Timeline title',
    description: 'string (optional) - Timeline description',
    items: "array of { title: string, description?: string, date?: string, status?: 'completed'|'current'|'upcoming'|'error', badge?: string }",
    orientation: "'vertical' | 'horizontal' (optional, default: 'vertical')",
  },
  'comparison-table': {
    title: 'string (optional) - Table title',
    description: 'string (optional) - Table description',
    columns: 'array of strings - Column headers (options to compare)',
    items: "array of { name: string, values: array of (boolean|string|number|null), highlight?: boolean }",
    highlightColumn: 'number (optional) - Index of column to highlight as "Best"',
  },
  'action-buttons': {
    title: 'string (optional) - Section title',
    description: 'string (optional) - Section description',
    buttons: "array of { label: string, action: string, icon?: string, variant?: 'default'|'secondary'|'outline'|'ghost'|'destructive', disabled?: boolean }",
    layout: "'horizontal' | 'vertical' | 'grid' (optional, default: 'horizontal')",
  },
  'confirm-dialog': {
    title: 'string - Dialog title',
    message: 'string - Dialog message',
    type: "'info' | 'warning' | 'danger' | 'question' (optional, default: 'question')",
    confirmLabel: 'string (optional, default: "Confirm")',
    cancelLabel: 'string (optional, default: "Cancel")',
  },
};

export const generateUITool: Tool = {
  name: 'generate_ui',
  description: `Generate a custom UI component to display rich, interactive content in the chat.

Available components:
${Object.entries(componentSchemas).map(([name, schema]) => `
**${name}**
${Object.entries(schema).map(([key, desc]) => `  - ${key}: ${desc}`).join('\n')}
`).join('\n')}

IMPORTANT: The output of this tool should be included directly in your response. 
The UI will render automatically where you place the output.

Example usage for weather:
generate_ui with component="weather-card" and props={"location":"New York","temperature":72,"condition":"sunny","humidity":45}

Example usage for a data table:
generate_ui with component="data-table" and props={"title":"Sales Data","columns":[{"key":"product","label":"Product"},{"key":"sales","label":"Sales","type":"currency"}],"data":[{"product":"Widget A","sales":1250}]}`,
  
  parameters: {
    type: 'object',
    properties: {
      component: {
        type: 'string',
        description: 'The UI component type to render',
        enum: Object.keys(componentSchemas),
      },
      props: {
        type: 'object',
        description: 'The properties/data for the component (varies by component type)',
      },
    },
    required: ['component', 'props'],
  },
  
  execute: async (params: { component: string; props: Record<string, any> }) => {
    const { component, props } = params;
    
    // Validate component exists
    if (!componentSchemas[component as keyof typeof componentSchemas]) {
      return {
        error: `Unknown component: ${component}`,
        availableComponents: Object.keys(componentSchemas),
      };
    }
    
    // Generate the UI marker that will be parsed by the client
    const uiMarker = `<!--UI:${JSON.stringify({ component, props })}-->`;
    
    return {
      success: true,
      output: uiMarker,
      instruction: 'Include this output directly in your response where you want the UI to appear. The component will render automatically.',
    };
  },
};

