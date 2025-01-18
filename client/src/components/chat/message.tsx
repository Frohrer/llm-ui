import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import type { Message as MessageType } from '@/lib/llm/types';
import { Card } from '@/components/ui/card';

interface MessageProps {
  message: MessageType;
}

export function Message({ message }: MessageProps) {
  return (
    <Card className={cn(
      "mb-4 p-4",
      message.role === 'assistant' ? "bg-secondary" : "bg-primary text-primary-foreground"
    )}>
      <ReactMarkdown
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <SyntaxHighlighter
                {...props}
                style={vscDarkPlus}
                language={match[1]}
                PreTag="div"
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code {...props} className={className}>
                {children}
              </code>
            );
          }
        }}
      >
        {message.content}
      </ReactMarkdown>
    </Card>
  );
}
