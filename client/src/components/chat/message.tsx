import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import type { Message as MessageType } from '@/lib/llm/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Volume2, VolumeX } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSpeech } from '@/hooks/use-speech';

interface MessageProps {
  message: MessageType;
}

export function Message({ message }: MessageProps) {
  const { toast } = useToast();
  const { speak, isSpeaking } = useSpeech();
  const [localIsSpeaking, setLocalIsSpeaking] = useState(false);

  const handleSpeakMessage = async () => {
    try {
      if (localIsSpeaking) {
        // Stop speaking (this needs additional implementation to interrupt active speech)
        setLocalIsSpeaking(false);
        // Here we could add a method to interrupt speech, but we'll handle this differently for now
      } else {
        setLocalIsSpeaking(true);
        console.log("Starting text-to-speech...");
        await speak(message.content);
        setLocalIsSpeaking(false);
      }
    } catch (error) {
      console.error('Error with speech:', error);
      toast({
        variant: "destructive",
        description: "Failed to speak message",
        duration: 2000,
      });
      setLocalIsSpeaking(false);
    }
  };

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

  const messageContent = message.role === 'assistant' ? (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={cn(
        "prose max-w-none", 
        "prose-neutral dark:prose-invert",
        "prose-a:text-blue-600 dark:prose-a:text-blue-400",
        // Add table styles
        "prose-table:table-auto prose-table:w-full",
        "prose-thead:bg-muted prose-thead:dark:bg-muted/50",
        "prose-tr:border-b prose-tr:border-border",
        "prose-th:p-2 prose-th:text-left",
        "prose-td:p-2",
      )}
      components={{
        code({ node, inline, className, children, ...props }) {
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
          <a 
            href={href} 
            className="text-blue-600 dark:text-blue-400 underline hover:no-underline" 
            target="_blank" 
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-4">
            <table className="w-full border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-muted dark:bg-muted/50">{children}</thead>
        ),
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="border-b border-border">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="p-2 text-left font-semibold">{children}</th>
        ),
        td: ({ children }) => (
          <td className="p-2">{children}</td>
        ),
      }}
    >
      {message.content}
    </ReactMarkdown>
  ) : (
    <div className="text-base whitespace-pre-wrap">{message.content}</div>
  );

  return (
    <Card className={cn(
      "mb-4 p-4 relative",
      message.role === 'assistant' 
        ? "bg-secondary" 
        : "bg-primary/10 dark:bg-primary/20" 
    )}>
      {message.role === 'assistant' && (
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-4 top-4"
          onClick={handleSpeakMessage}
        >
          {localIsSpeaking || isSpeaking ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </Button>
      )}
      {messageContent}
    </Card>
  );
}