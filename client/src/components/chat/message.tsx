import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import type { Message as MessageType } from "@/lib/llm/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check, Volume2, VolumeX, FileText, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSpeech } from "@/hooks/use-speech";
import { Badge } from "@/components/ui/badge";

interface MessageProps {
  message: MessageType;
}

export function Message({ message }: MessageProps) {
  const { toast } = useToast();
  const { speak, isSpeaking } = useSpeech();
  const [localIsSpeaking, setLocalIsSpeaking] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

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
      console.error("Error with speech:", error);
      toast({
        variant: "destructive",
        description: "Failed to speak message",
        duration: 2000,
      });
      setLocalIsSpeaking(false);
    }
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setIsCopied(true);
      toast({
        description: "Message copied to clipboard",
        duration: 2000,
      });
      
      // Reset copied state after 2 seconds
      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    } catch (error) {
      toast({
        variant: "destructive",
        description: "Failed to copy message",
        duration: 2000,
      });
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

  const messageContent =
    message.role === "assistant" ? (
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
            const match = /language-(\w+)/.exec(className || "");
            const code = String(children).replace(/\n$/, "");

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
          ul: ({ children }) => (
            <ul className="list-disc pl-6 mb-4">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 mb-4">{children}</ol>
          ),
          li: ({ children }) => <li className="mb-2">{children}</li>,
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mb-4">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold mb-3">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-bold mb-2">{children}</h3>
          ),
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
          td: ({ children }) => <td className="p-2">{children}</td>,
        }}
      >
        {message.content}
      </ReactMarkdown>
    ) : (
      <div className="text-base whitespace-pre-wrap">{message.content}</div>
    );

  // Render attachments if present
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  const handleImageRetry = () => {
    if (retryCount < maxRetries) {
      setImageLoading(true);
      setImageError(false);
      setRetryCount((prev) => prev + 1);
    }
  };

  // Determine which attachments to display
  const getAttachmentsToDisplay = () => {
    // If we have an attachments array, use that
    if (message.attachments && message.attachments.length > 0) {
      return message.attachments;
    }
    // Otherwise fall back to the single attachment if it exists
    else if (message.attachment) {
      return [message.attachment];
    }
    // If no attachments, return empty array
    return [];
  };

  const renderSingleAttachment = (
    attachment: MessageType["attachment"],
    index: number,
  ) => {
    if (!attachment) return null;

    if (attachment.type === "image") {
      // Ensure the URL has a timestamp to bypass browser cache if retrying
      const imageUrl = `${attachment.url}${retryCount > 0 ? `?retry=${retryCount}` : ""}`;

      return (
        <div key={`img-${attachment.url}-${index}`} className="mt-3 mb-2">
          <div className="rounded-md overflow-hidden border border-border max-w-md relative">
            {imageLoading && (
              <div className="w-full h-32 flex items-center justify-center bg-muted/20">
                <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
              </div>
            )}
            {imageError && (
              <div className="w-full h-32 flex flex-col items-center justify-center gap-2 bg-muted/20 p-4">
                <span className="text-destructive text-center">
                  Failed to load image
                </span>
                {retryCount < maxRetries && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleImageRetry}
                  >
                    Retry
                  </Button>
                )}
              </div>
            )}
            <img
              src={imageUrl}
              alt={attachment.name}
              className={`w-full h-auto object-contain max-h-96 ${imageLoading ? "hidden" : ""}`}
              onLoad={() => setImageLoading(false)}
              onError={() => {
                console.error(`Failed to load image: ${imageUrl}`);
                setImageLoading(false);
                setImageError(true);
              }}
            />
          </div>
          <div className="mt-1 text-sm text-muted-foreground flex items-center">
            <span className="truncate">{attachment.name}</span>
            {!imageLoading && !imageError && (
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 hover:text-primary inline-flex items-center"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      );
    } else {
      return (
        <div key={`doc-${attachment.url}-${index}`} className="mt-3 mb-2">
          <Badge
            variant="outline"
            className="flex items-center gap-2 py-1.5 px-3"
          >
            <FileText className="h-4 w-4" />
            <span className="truncate max-w-[200px]">{attachment.name}</span>
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 hover:text-primary"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </Badge>
          {attachment.text && (
            <div className="mt-2 text-sm text-muted-foreground max-h-32 overflow-y-auto border border-border rounded p-2 bg-muted/10">
              <div className="font-medium mb-1">Document content:</div>
              <div className="whitespace-pre-wrap line-clamp-4">
                {attachment.text.length > 300
                  ? attachment.text.substring(0, 300) + "..."
                  : attachment.text}
              </div>
            </div>
          )}
        </div>
      );
    }
  };

  const renderAttachments = () => {
    const attachmentsToDisplay = getAttachmentsToDisplay();

    if (attachmentsToDisplay.length === 0) return null;

    return (
      <div className="mt-3 mb-2 space-y-3">
        {attachmentsToDisplay.map((attachment, index) =>
          renderSingleAttachment(attachment, index),
        )}
      </div>
    );
  };

  // Format timestamp
  const formatTimestamp = () => {
    if (!message.timestamp) return '';
    const date = new Date(message.timestamp);
    return new Intl.DateTimeFormat('default', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  };

  return (
    <div className="mb-6">
      <Card
        className={cn(
          "p-4 relative",
          message.role === "assistant"
            ? "bg-secondary"
            : "bg-primary/10 dark:bg-primary/20",
        )}
      >
        <div className="group">
          {messageContent}
          {renderAttachments()}
        </div>
      </Card>
      
      {message.role === 'assistant' && (
        <div className="flex items-center mt-1 text-xs text-muted-foreground">
          <span>{formatTimestamp()}</span>
          <div className="flex-1"></div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 flex items-center gap-1"
            onClick={handleCopyMessage}
          >
            {isCopied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
