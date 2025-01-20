import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import type { Message as MessageType } from '@/lib/llm/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CodeProps } from 'react-markdown/lib/ast-to-react';

interface MessageProps {
  message: MessageType;
}

export function Message({ message }: MessageProps) {
  const { toast } = useToast();

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast({
        description: "Code copied to clipboard",
        duration: 2000,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        description: "Failed to copy code",
        duration: 2000,
      });
    }
  };

  return (
    <Card className={cn(
      "mb-4 p-4",
      message.role === 'assistant' ? "bg-secondary" : "bg-primary text-primary-foreground"
    )}>
      <ReactMarkdown
        className="prose dark:prose-invert prose-sm max-w-none"
        components={{
          code({ node, inline, className, children, ...props }: CodeProps) {
            const match = /language-(\w+)/.exec(className || '');
            const code = String(children).replace(/\n$/, '');

            return !inline && match ? (
              <div className="relative group">
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleCopyCode(code)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <SyntaxHighlighter
                  {...props}
                  style={vscDarkPlus}
                  language={match[1]}
                  PreTag="div"
                  className="!mt-0"
                >
                  {code}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code {...props} className={className}>
                {children}
              </code>
            );
          },
          // Add custom styling for other markdown elements
          p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-6 mb-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-6 mb-4">{children}</ol>,
          li: ({ children }) => <li className="mb-2">{children}</li>,
          h1: ({ children }) => <h1 className="text-2xl font-bold mb-4">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-bold mb-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-bold mb-2">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/20 pl-4 italic my-4">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a href={href} className="text-primary underline hover:no-underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {message.content}
      </ReactMarkdown>
    </Card>
  );
}