/**
 * Generative UI Component Registry
 * 
 * This registry maps component names to React components that can be
 * dynamically rendered by the AI. When the AI wants to show a custom UI,
 * it returns a component specification that gets rendered here.
 */

import { WeatherCard } from './components/weather-card';
import { DataTable } from './components/data-table';
import { StatsCard } from './components/stats-card';
import { ProgressCard } from './components/progress-card';
import { AlertCard } from './components/alert-card';
import { CodeBlock } from './components/code-block';
import { ImageGallery } from './components/image-gallery';
import { QuoteCard } from './components/quote-card';
import { TimelineCard } from './components/timeline-card';
import { ComparisonTable } from './components/comparison-table';
import { ActionButtons } from './components/action-buttons';
import { ConfirmDialog } from './components/confirm-dialog';

// Component specification from AI
export interface UIComponentSpec {
  component: string;
  props: Record<string, any>;
  id?: string;
}

// Message content that can include UI components
export interface GenerativeUIContent {
  type: 'text' | 'ui';
  content?: string;
  ui?: UIComponentSpec;
}

// Registry of available UI components
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const UIComponentRegistry: Record<string, any> = {
  // Data Display
  'weather-card': WeatherCard,
  'data-table': DataTable,
  'stats-card': StatsCard,
  'progress-card': ProgressCard,
  'comparison-table': ComparisonTable,
  
  // Feedback & Alerts
  'alert-card': AlertCard,
  'quote-card': QuoteCard,
  
  // Code & Technical
  'code-block': CodeBlock,
  
  // Media
  'image-gallery': ImageGallery,
  
  // Timeline & Steps
  'timeline-card': TimelineCard,
  
  // Interactive
  'action-buttons': ActionButtons,
  'confirm-dialog': ConfirmDialog,
};

// Get component names for documentation
export function getAvailableComponents(): string[] {
  return Object.keys(UIComponentRegistry);
}

// Get component by name
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getComponent(name: string): any | null {
  return UIComponentRegistry[name] || null;
}

// Validate component spec
export function validateComponentSpec(spec: UIComponentSpec): boolean {
  if (!spec.component || typeof spec.component !== 'string') {
    return false;
  }
  if (!UIComponentRegistry[spec.component]) {
    console.warn(`Unknown UI component: ${spec.component}`);
    return false;
  }
  return true;
}

// Parse message content to extract UI components
export function parseGenerativeContent(content: string): GenerativeUIContent[] {
  const results: GenerativeUIContent[] = [];
  
  // Look for UI component markers: <!--UI:{"component":"...","props":{...}}-->
  // Using a pattern that works across ES versions (no 's' flag)
  const uiPattern = /<!--UI:([\s\S]*?)-->/g;
  let lastIndex = 0;
  let match;
  
  while ((match = uiPattern.exec(content)) !== null) {
    // Add text before this UI component
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) {
        results.push({ type: 'text', content: textBefore });
      }
    }
    
    // Parse the UI component
    try {
      const uiSpec = JSON.parse(match[1]) as UIComponentSpec;
      if (validateComponentSpec(uiSpec)) {
        results.push({ type: 'ui', ui: uiSpec });
      }
    } catch (e) {
      console.error('Failed to parse UI component:', e);
      // Add as text if parsing fails
      results.push({ type: 'text', content: match[0] });
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex).trim();
    if (remaining) {
      results.push({ type: 'text', content: remaining });
    }
  }
  
  // If no UI components found, return the whole content as text
  if (results.length === 0 && content.trim()) {
    results.push({ type: 'text', content });
  }
  
  return results;
}

