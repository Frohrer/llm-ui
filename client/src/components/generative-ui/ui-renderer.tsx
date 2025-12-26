/**
 * UI Renderer Component
 * 
 * Renders generative UI components from AI responses.
 * Parses message content and renders appropriate UI components
 * alongside regular markdown text.
 */

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '@/components/providers/theme-provider';
import { 
  parseGenerativeContent, 
  getComponent, 
  type GenerativeUIContent,
  type UIComponentSpec 
} from './registry';
import { AlertCard } from './components/alert-card';

interface UIRendererProps {
  content: string;
  onAction?: (action: string) => void;
}

// Render a single UI component
function UIComponentRenderer({ 
  spec, 
  onAction 
}: { 
  spec: UIComponentSpec; 
  onAction?: (action: string) => void;
}) {
  const Component = getComponent(spec.component);
  
  if (!Component) {
    return (
      <AlertCard
        type="warning"
        title="Unknown Component"
        message={`The component "${spec.component}" is not available.`}
      />
    );
  }
  
  // Inject onAction handler for interactive components
  const props = {
    ...spec.props,
    ...(onAction && { onAction }),
  };
  
  return (
    <div className="my-4">
      <Component {...props} />
    </div>
  );
}

// Render markdown content
function MarkdownRenderer({ content }: { content: string }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          const language = match ? match[1] : '';
          
          if (!inline && language) {
            return (
              <SyntaxHighlighter
                style={isDark ? vscDarkPlus : vs}
                language={language}
                PreTag="div"
                customStyle={{
                  margin: '1rem 0',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                }}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            );
          }
          
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        // Style other markdown elements
        p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
        h1: ({ children }) => <h1 className="text-2xl font-bold mb-4">{children}</h1>,
        h2: ({ children }) => <h2 className="text-xl font-bold mb-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-lg font-bold mb-2">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-primary/30 pl-4 italic my-4">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a 
            href={href} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-4">
            <table className="min-w-full border-collapse border border-border">
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border bg-muted px-4 py-2 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-border px-4 py-2">{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function UIRenderer({ content, onAction }: UIRendererProps) {
  // Parse content to extract UI components
  const parsedContent = useMemo(() => {
    return parseGenerativeContent(content);
  }, [content]);
  
  // If no UI components found, render as plain markdown
  if (parsedContent.length === 1 && parsedContent[0].type === 'text') {
    return <MarkdownRenderer content={content} />;
  }
  
  // Render mixed content
  return (
    <div className="space-y-4">
      {parsedContent.map((item, index) => {
        if (item.type === 'text' && item.content) {
          return <MarkdownRenderer key={index} content={item.content} />;
        }
        
        if (item.type === 'ui' && item.ui) {
          return (
            <UIComponentRenderer 
              key={index} 
              spec={item.ui} 
              onAction={onAction}
            />
          );
        }
        
        return null;
      })}
    </div>
  );
}

// Export for direct use
export { parseGenerativeContent } from './registry';
export type { GenerativeUIContent, UIComponentSpec } from './registry';

