import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SendHorizonal, FileText, Image, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { estimateTokenCount, exceedsTokenLimit } from '@/lib/llm/token-counter';

interface ChatInputProps {
  onSendMessage: (message: string, attachment?: {
    type: 'document' | 'image';
    url: string;
    text?: string;
    name: string;
  }) => Promise<boolean | void>;
  isLoading: boolean;
  /** The context length of the current model in tokens (default: 128000) */
  modelContextLength?: number;
}

export function ChatInput({ onSendMessage, isLoading, modelContextLength = 128000 }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachment, setAttachment] = useState<{
    type: 'document' | 'image';
    url: string;
    text?: string;
    name: string;
  } | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [isOverLimit, setIsOverLimit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingMessageRef = useRef<string>('');
  const pendingAttachmentRef = useRef<typeof attachment>(null);
  const { toast } = useToast();
  
  // Log the model context length for debugging
  console.log('Model context length:', modelContextLength);
  
  // We're now displaying the full context length in the UI instead of the 1/4 reserved for user messages
  // This gives users a better understanding of the model's total capacity
  const userTokenLimit = modelContextLength || 20000;
  
  // Recalculate token limits when model context length changes
  useEffect(() => {
    // Update the token count when the model context length changes
    const messageTokens = estimateTokenCount(message);
    let totalTokens = messageTokens;
    
    // If we have a document attachment, add its tokens too
    if (attachment?.type === 'document' && attachment.text) {
      totalTokens += estimateTokenCount(attachment.text);
    }
    
    setTokenCount(totalTokens);
    setIsOverLimit(totalTokens > userTokenLimit);
  }, [modelContextLength, message, attachment]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      // Store the current message and attachment in memory before clearing the input
      pendingMessageRef.current = message;
      pendingAttachmentRef.current = attachment;
      
      // Clear the input immediately for better UX
      setMessage('');
      setAttachment(null);
      
      // Send the message
      try {
        const success = await onSendMessage(pendingMessageRef.current, pendingAttachmentRef.current || undefined);
        
        if (!success) {
          // If sending failed for some reason, restore the message and attachment
          setMessage(pendingMessageRef.current);
          setAttachment(pendingAttachmentRef.current);
        }
        
        // Clear the pending refs if successful or if we've already restored the content
        pendingMessageRef.current = '';
        pendingAttachmentRef.current = null;
      } catch (error) {
        // If an error occurs, restore the message and attachment
        setMessage(pendingMessageRef.current);
        setAttachment(pendingAttachmentRef.current);
        pendingMessageRef.current = '';
        pendingAttachmentRef.current = null;
      }
    }
  }, [message, isLoading, onSendMessage, attachment]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }, [handleSubmit]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newMessage = e.target.value;
    setMessage(newMessage);
    
    // Calculate token count and check if it exceeds the limit
    const estimatedTokens = estimateTokenCount(newMessage);
    setTokenCount(estimatedTokens);
    
    // If we have a document attachment, we need to estimate its tokens too
    let totalTokens = estimatedTokens;
    if (attachment?.type === 'document' && attachment.text) {
      // For documents, we'll add an approximate token count (this is a rough estimate)
      totalTokens += estimateTokenCount(attachment.text);
    }
    
    setIsOverLimit(totalTokens > userTokenLimit);
    
    if (totalTokens > userTokenLimit) {
      toast({
        title: "Token limit exceeded",
        description: `Your message exceeds the model's context length of ${userTokenLimit.toLocaleString()} tokens. The AI might truncate very long inputs.`,
        variant: "destructive",
        duration: 3000,
      });
    }
  }, [attachment, userTokenLimit, toast]);

  const renderUploadButton = useCallback(() => (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      onClick={() => fileInputRef.current?.click()}
      disabled={uploadingFile}
    >
      <FileText className="h-4 w-4" />
    </Button>
  ), [uploadingFile]);

  const renderSendButton = useCallback(() => (
    <Button type="submit" size="icon" disabled={isLoading || !message.trim()}>
      <SendHorizonal className="h-4 w-4" />
    </Button>
  ), [isLoading, message]);

  // File upload handlers
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    setUploadingFile(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('File upload failed');
      }
      
      const data = await response.json();
      
      // Set the attachment data based on the file type
      const isImage = file.type.startsWith('image/');
      const attachmentData = {
        type: isImage ? 'image' as const : 'document' as const,
        url: data.file.url,
        text: isImage ? undefined : data.file.text,
        name: file.name
      };
      
      setAttachment(attachmentData);
      
      // If it's a document, update the token count to include the document text
      if (!isImage && attachmentData.text) {
        const documentTokens = estimateTokenCount(attachmentData.text);
        const messageTokens = estimateTokenCount(message);
        const totalTokens = messageTokens + documentTokens;
        
        setTokenCount(totalTokens);
        setIsOverLimit(totalTokens > userTokenLimit);
        
        if (totalTokens > userTokenLimit) {
          toast({
            title: "Document size warning",
            description: `The uploaded document contains approximately ${documentTokens.toLocaleString()} tokens, which exceeds the model's context length of ${userTokenLimit.toLocaleString()} tokens.`,
            variant: "destructive"
          });
        }
      }
      
      // We don't add document text to the user input message anymore
      // It will be included in the attachment and passed to the AI model
      // but kept hidden from the user input
      toast({
        title: 'File uploaded',
        description: `${file.name} has been uploaded successfully`,
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload file. Supported formats include documents (.pdf, .doc, .docx, .odt, .rtf, .txt), spreadsheets (.xlsx, .xls, .ods, .csv), presentations (.pptx, .ppt, .odp), and images (.jpg, .png, .gif, .svg).',
        variant: 'destructive'
      });
    } finally {
      setUploadingFile(false);
      // Reset the input value so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  
  const handleAttachmentClick = () => {
    fileInputRef.current?.click();
  };
  
  const removeAttachment = () => {
    // If we had a document attachment, recalculate token count without it
    if (attachment?.type === 'document' && attachment.text) {
      const messageTokens = estimateTokenCount(message);
      setTokenCount(messageTokens);
      setIsOverLimit(messageTokens > userTokenLimit);
    }
    
    setAttachment(null);
    
    // If removing attachment resolved a token limit issue, show a success message
    if (isOverLimit) {
      toast({
        title: "Token limit reduced",
        description: "Removing the attachment has reduced the token count.",
      });
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      {attachment && (
        <div className="flex items-center gap-2 p-2 mb-2 bg-muted rounded">
          <Badge variant="outline" className="flex items-center gap-1 py-1.5">
            {attachment.type === 'image' ? (
              <Image className="h-4 w-4" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            <span className="truncate max-w-[200px]">{attachment.name}</span>
          </Badge>
          <Button 
            size="icon" 
            variant="ghost" 
            className="h-6 w-6 rounded-full" 
            onClick={removeAttachment}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="flex flex-col flex-1">
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileInputChange} 
          className="hidden" 
          accept="image/*,.pdf,.doc,.docx,.odt,.rtf,.txt,.xlsx,.xls,.ods,.csv,.pptx,.ppt,.odp"
        />
        
        <div className="relative flex-1 mb-2">
          <Textarea
            value={message}
            onChange={handleTextChange}
            placeholder="Type your message..."
            className="min-h-[60px] h-full resize-none"
            onKeyDown={handleKeyDown}
            style={{ height: '100%' }}
          />
        </div>
        
        <div className="flex flex-row gap-2 items-center justify-end">
          <div className="text-xs text-muted-foreground mr-2">
            <span className={isOverLimit ? "text-destructive font-medium" : ""}>
              {tokenCount.toLocaleString()}
            </span>
            <span> / </span>
            <span>{userTokenLimit.toLocaleString()}</span>
            <span> tokens</span>
          </div>
          {renderUploadButton()}
          {renderSendButton()}
        </div>
      </form>
    </div>
  );
}