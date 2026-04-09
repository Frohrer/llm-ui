import { useState, useCallback, useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import type { Message as MessageType } from "@/lib/llm/types";
import { Button } from "@/components/ui/button";
import { Copy, Check, FileText, ExternalLink, Wrench, Play, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useCodeExecution } from "@/hooks/use-code-execution";
import { TerminalOutput } from "@/components/ui/terminal-output";
import { UIRenderer } from "@/components/generative-ui";

interface MessageProps {
  message: MessageType;
}

const MessageComponent = ({ message }: MessageProps) => {
  const { toast } = useToast();
  const [isCopied, setIsCopied] = useState(false);
  const { executeCode, isExecuting, result, error, clearResults } = useCodeExecution();
  const [executingCode, setExecutingCode] = useState<string | null>(null);

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

  const handleRunCode = async (code: string, language: string) => {
    if (language !== 'python') {
      toast({
        variant: "destructive",
        description: "Code execution is only supported for Python",
        duration: 2000,
      });
      return;
    }

    setExecutingCode(code);
    clearResults();
    
    try {
      await executeCode(code);
    } catch (error) {
      // Error handling is done in the hook
    }
  };

  // Helper function to format tool calls in code blocks
  const formatToolCalls = (content: string) => {
    // Check if the content includes tool call markers
    if (
      content.includes("Calling tool:") ||
      content.includes("Tool Call:") ||
      content.includes("Tool:") && content.includes("Result:")
    ) {
      // Split the content by newlines to process sections
      const lines = content.split("\n");
      const formattedLines = [];
      let inToolCall = false;
      let toolCallBuffer = [];
      
      for (const line of lines) {
        if (
          line.includes("Calling tool:") || 
          line.includes("Tool Call:") || 
          line.includes("Executing tools...") ||
          (line.includes("Tool:") && !line.includes("Tool Execution Error"))
        ) {
          // Start collecting tool call content
          if (toolCallBuffer.length > 0) {
            // Format the previous tool call if there was one
            formattedLines.push(
              <div key={`tool-${formattedLines.length}`} className="my-2 p-2 bg-primary/5 border border-primary/20 rounded-md">
                <div className="flex items-center gap-2 mb-1 text-primary font-medium">
                  <Wrench className="h-4 w-4" />
                  <span>Tool Interaction</span>
                </div>
                <div className="ml-2 pl-2 border-l-2 border-primary/30 text-sm break-words">
                  {toolCallBuffer.map((l, i) => (
                    <div key={i} className="break-words">{l}</div>
                  ))}
                </div>
              </div>
            );
            toolCallBuffer = [];
          }
          
          inToolCall = true;
          toolCallBuffer.push(line);
        } 
        else if (inToolCall) {
          // Add to the current tool call
          toolCallBuffer.push(line);
        } 
        else {
          // Regular content
          formattedLines.push(line);
        }
      }
      
      // Add any remaining tool call content
      if (inToolCall && toolCallBuffer.length > 0) {
        formattedLines.push(
          <div key={`tool-${formattedLines.length}`} className="my-2 p-2 bg-primary/5 border border-primary/20 rounded-md">
            <div className="flex items-center gap-2 mb-1 text-primary font-medium">
              <Wrench className="h-4 w-4" />
              <span>Tool Interaction</span>
            </div>
            <div className="ml-2 pl-2 border-l-2 border-primary/30 text-sm break-words">
              {toolCallBuffer.map((l, i) => (
                <div key={i} className="break-words">{l}</div>
              ))}
            </div>
          </div>
        );
      }
      
      return (
        <div>
          {formattedLines.map((item, index) => {
            if (typeof item === "string") {
              return <div key={index}>{item}</div>;
            }
            return item;
          })}
        </div>
      );
    }
    
    // No tool calls, return content as is
    return content;
  };

  // Check if content contains generative UI markers
  const hasGenerativeUI = typeof message.content === "string" && message.content.includes("<!--UI:");
  
  // Handle UI action events from generative components
  const handleUIAction = useCallback((action: string) => {
    console.log("[Generative UI] Action triggered:", action);
    // You can dispatch custom events or handle actions here
  }, []);

  const messageContent = useMemo(() =>
    message.role === "assistant" ? (
      // Check for Generative UI components first
      hasGenerativeUI ? (
        <div className="prose dark:prose-invert max-w-none break-words [&_*]:break-words chat-message-content">
          <UIRenderer content={message.content} onAction={handleUIAction} />
        </div>
      ) :
      // Check if the message contains tool call markers
      typeof message.content === "string" &&
      (message.content.includes("Calling tool:") ||
       message.content.includes("Tool Call:") ||
       message.content.includes("Tool:") && message.content.includes("Result:")) ? (
        <div className="prose dark:prose-invert max-w-none break-words [&_*]:break-words chat-message-content">
          {formatToolCalls(message.content)}
        </div>
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          className={cn(
            "prose max-w-none break-words chat-message-content",
            "prose-neutral dark:prose-invert",
            "prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:break-all",
            "prose-table:table-auto prose-table:w-full",
            "prose-thead:bg-muted prose-thead:dark:bg-muted/50",
            "prose-tr:border-b prose-tr:border-border",
            "prose-th:p-2 prose-th:text-left",
            "prose-td:p-2",
            "prose-img:max-w-full prose-img:h-auto prose-img:mx-auto prose-img:!my-0",
            "prose-pre:max-w-full prose-pre:overflow-x-auto",
            "prose-code:max-w-full prose-code:break-all",
            "prose-p:break-words",
            "[&_*]:max-w-full [&_*]:break-words",
          )}
          components={{
            code({ node, inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || "");
              // Preserve original code with proper line breaks for copying
              const originalCode = String(children);
              // Remove only the trailing newline for display (if it exists)
              const displayCode = originalCode.replace(/\n$/, "");
              const language = match ? match[1] : '';

              return !inline && match ? (
                <div className="relative group w-full max-w-full overflow-hidden">
                  <div className="absolute right-2 top-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10 flex gap-1">
                    {language === 'python' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 bg-background/80 backdrop-blur-sm sm:bg-transparent"
                        onClick={() => handleRunCode(originalCode, language)}
                        disabled={isExecuting}
                        title="Run Python code"
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 bg-background/80 backdrop-blur-sm sm:bg-transparent"
                      onClick={() => handleCopyCode(originalCode)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="w-full max-w-full overflow-x-auto">
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      className="!mt-0 !w-full !max-w-full"
                      wrapLines={true}
                      wrapLongLines={true}
                    >
                      {displayCode}
                    </SyntaxHighlighter>
                  </div>
                  {executingCode === originalCode && (
                    <TerminalOutput
                      output={result?.output}
                      error={error || undefined}
                      isExecuting={isExecuting}
                    />
                  )}
                </div>
              ) : (
                <code {...props} className={cn(className, "break-all max-w-full inline align-baseline")}>
                  {children}
                </code>
              );
            },
            img: ({ src, alt }: { src?: string; alt?: string }) => {
              // Handle both base64 and regular URL images
              console.log("Image source received:", src);
              
              // If src is empty or undefined, try to extract from markdown content
              if (!src && message.content) {
                const match = message.content.match(/!\[.*?\]\((.*?)\)/);
                if (match && match[1]) {
                  src = match[1];
                }
              }

              if (!src) {
                console.error("No image source found");
                return null;
              }

              return (
                <span className="block !my-0 !p-0 flex justify-center">
                  <a href={src} target="_blank" rel="noopener noreferrer" className="block">
                    <img
                      src={src}
                      alt={alt || "Generated image"}
                      className="max-w-full h-auto rounded-lg cursor-zoom-in hover:opacity-95 transition-opacity !my-0 !mt-0 !mb-0"
                      style={{ 
                        maxHeight: "80vh",
                        imageRendering: "auto",
                        WebkitImageSmoothing: "high",
                      }}
                      onError={(e) => {
                        console.error("Image failed to load:", src);
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </a>
                </span>
              );
            },
            p: ({ children }) => {
                          // If the paragraph only contains an image, strip the paragraph margins
                          const childArray = Array.isArray(children) ? children : [children];
                          const hasOnlyImage = childArray.length === 1 &&
                            typeof childArray[0] === 'object' && childArray[0]?.type === 'span';
                          return <p className={hasOnlyImage ? "!my-0 !p-0 leading-none" : "mb-4 last:mb-0"}>{children}</p>;
                        },
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
              <div className="overflow-x-auto my-4 max-w-full">
                <table className="w-full border-collapse min-w-0">{children}</table>
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
      )
    ) : (
                  <div className="text-base whitespace-pre-wrap break-words chat-message-content">{message.content}</div>
    ), [message.content, message.role, hasGenerativeUI, handleUIAction, executingCode, isExecuting, result, error]);

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
              className={`w-full h-auto object-contain max-h-96 ${imageLoading || imageError ? "hidden" : ""}`}
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
            className="flex items-center gap-2 py-1.5 px-3 max-w-full"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate max-w-[120px] sm:max-w-[200px]">{attachment.name}</span>
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto hover:text-primary shrink-0"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </Badge>
          {attachment.text && (
            <div className="mt-2 text-sm text-muted-foreground max-h-32 overflow-y-auto border border-border rounded p-2 bg-muted/10">
              <div className="font-medium mb-1">Document content:</div>
              <div className="whitespace-pre-wrap line-clamp-4 break-words">
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

  const isQueued = typeof message.id === "string" && message.id.startsWith("queued-");

  // Format timestamp with relative day labels
  const formatTimestamp = () => {
    if (!message.timestamp) return '';
    const date = new Date(message.timestamp);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const time = date.toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' });

    if (msgDay.getTime() === today.getTime()) return `Today, ${time}`;
    if (msgDay.getTime() === yesterday.getTime()) return `Yesterday, ${time}`;
    return `${date.toLocaleDateString('default', { month: 'short', day: 'numeric' })}, ${time}`;
  };

  if (message.role === "user") {
    return (
      <div className="mb-3 sm:mb-4 md:mb-6 flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%] md:max-w-[70%] min-w-0 w-fit">
          <div className="bg-muted rounded-3xl rounded-br-lg px-3 sm:px-4 py-2.5 sm:py-3">
            <div className="text-sm md:text-base whitespace-pre-wrap break-words">
              {messageContent}
            </div>
            {renderAttachments()}
          </div>
          <div className="text-xs text-muted-foreground text-right mt-1 px-1 flex items-center justify-end gap-1">
            {isQueued && (
              <span className="inline-flex items-center gap-0.5 text-muted-foreground/70">
                <Clock className="h-3 w-3" />
                <span>Queued</span>
              </span>
            )}
            {!isQueued && formatTimestamp()}
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="mb-3 sm:mb-4 md:mb-6 flex justify-start">
      <div className="max-w-full min-w-0 w-full">
        <div className="text-sm md:text-base overflow-hidden break-words">
          {messageContent}
        </div>
        {renderAttachments()}
        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
          <button
            onClick={handleCopyMessage}
            className="hover:text-foreground transition-colors p-0.5 rounded"
            title="Copy message"
          >
            {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <span>{formatTimestamp()}</span>
        </div>
      </div>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export const Message = memo(MessageComponent, (prevProps, nextProps) => {
  // Only re-render if the content or id has changed
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content
  );
});
