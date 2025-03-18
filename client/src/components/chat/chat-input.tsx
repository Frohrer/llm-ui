import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SendHorizonal, FileText, Image, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { estimateTokenCount, exceedsTokenLimit } from '@/lib/llm/token-counter';

// Type for a single attachment
type Attachment = {
  type: 'document' | 'image';
  url: string;
  text?: string;
  name: string;
};

interface ChatInputProps {
  onSendMessage: (message: string, attachment?: Attachment, allAttachments?: Attachment[]) => Promise<boolean | void>;
  isLoading: boolean;
  /** The context length of the current model in tokens (default: 128000) */
  modelContextLength?: number;
}

export function ChatInput({ onSendMessage, isLoading, modelContextLength = 128000 }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  // Changed to store an array of attachments
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Active attachment is the one that will be sent with the message
  const [activeAttachment, setActiveAttachment] = useState<number | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [isOverLimit, setIsOverLimit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingMessageRef = useRef<string>('');
  const pendingAttachmentRef = useRef<Attachment | undefined>(undefined);
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
    
    // If we have an active document attachment, add its tokens too
    const attachment = activeAttachment !== null ? attachments[activeAttachment] : null;
    if (attachment?.type === 'document' && attachment.text) {
      totalTokens += estimateTokenCount(attachment.text);
    }
    
    setTokenCount(totalTokens);
    setIsOverLimit(totalTokens > userTokenLimit);
  }, [modelContextLength, message, attachments, activeAttachment]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      // Store the current message in memory before clearing the input
      pendingMessageRef.current = message;
      
      // Get the active attachment if one is selected, otherwise use undefined
      const primaryAttachment = activeAttachment !== null ? attachments[activeAttachment] : undefined;
      pendingAttachmentRef.current = primaryAttachment;
      
      // Clear the input immediately for better UX
      setMessage('');
      
      // Send the message
      try {
        // Send the message with all attachments
        const success = await onSendMessage(
          pendingMessageRef.current, 
          primaryAttachment, 
          attachments  // Pass all attachments as an additional parameter
        );
        
        if (!success) {
          // If sending failed for some reason, restore the message
          setMessage(pendingMessageRef.current);
        }
        
        // Clear the pending refs if successful or if we've already restored the content
        pendingMessageRef.current = '';
        pendingAttachmentRef.current = undefined;
      } catch (error) {
        // If an error occurs, restore the message
        setMessage(pendingMessageRef.current);
        pendingMessageRef.current = '';
        pendingAttachmentRef.current = undefined;
      }
    }
  }, [message, isLoading, onSendMessage, attachments]);

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
    
    // Count tokens for all document attachments, not just the active one
    let totalTokens = estimatedTokens;
    
    // Add token count for all document attachments
    for (const attachment of attachments) {
      if (attachment.type === 'document' && attachment.text) {
        totalTokens += estimateTokenCount(attachment.text);
      }
    }
    
    setTokenCount(totalTokens);
    setIsOverLimit(totalTokens > userTokenLimit);
    
    if (totalTokens > userTokenLimit) {
      toast({
        title: "Token limit exceeded",
        description: `Your message exceeds the model's context length of ${userTokenLimit.toLocaleString()} tokens. The AI might truncate very long inputs.`,
        variant: "destructive",
        duration: 3000,
      });
    }
  }, [attachments, activeAttachment, userTokenLimit, toast]);

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
      const attachmentData: Attachment = {
        type: isImage ? 'image' : 'document',
        url: data.file.url,
        text: isImage ? undefined : data.file.text,
        name: file.name
      };
      
      // Add the new attachment to the attachments array
      setAttachments(prev => [...prev, attachmentData]);
      
      // Set the newly added attachment as the active one
      setActiveAttachment(prevAttachments => 
        prevAttachments === null ? 0 : prevAttachments
      );
      
      // If it's a document, update the token count to include ALL document texts
      if (!isImage && attachmentData.text) {
        // Calculate tokens for the message
        const messageTokens = estimateTokenCount(message);
        
        // Calculate tokens for all documents, including the new one
        let documentTokens = 0;
        for (const att of [...attachments, attachmentData]) {
          if (att.type === 'document' && att.text) {
            documentTokens += estimateTokenCount(att.text);
          }
        }
        
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
  
  const handleAttachmentClick = (index: number) => {
    // Toggle active attachment
    setActiveAttachment(prev => prev === index ? null : index);
    
    // Update token count for all documents
    const messageTokens = estimateTokenCount(message);
    let totalTokens = messageTokens;
    
    // Add token count for all document attachments
    for (const attachment of attachments) {
      if (attachment.type === 'document' && attachment.text) {
        totalTokens += estimateTokenCount(attachment.text);
      }
    }
    
    setTokenCount(totalTokens);
    setIsOverLimit(totalTokens > userTokenLimit);
  };
  
  const removeAttachment = (index: number) => {
    // Check if we're removing the active attachment
    const isRemovingActive = activeAttachment === index;
    
    // Create new attachment array without the removed item
    const newAttachments = attachments.filter((_, i) => i !== index);
    
    // Update attachments array
    setAttachments(newAttachments);
    
    // Update active attachment index
    if (isRemovingActive) {
      setActiveAttachment(null);
    } else if (activeAttachment !== null && index < activeAttachment) {
      // If we removed an attachment before the active one, adjust the active index
      setActiveAttachment(activeAttachment - 1);
    }
    
    // Recalculate token count with all remaining documents
    const messageTokens = estimateTokenCount(message);
    let totalTokens = messageTokens;
    
    // Add token count for all remaining document attachments
    for (const attachment of newAttachments) {
      if (attachment.type === 'document' && attachment.text) {
        totalTokens += estimateTokenCount(attachment.text);
      }
    }
    
    setTokenCount(totalTokens);
    setIsOverLimit(totalTokens > userTokenLimit);
    
    toast({
      title: "Attachment removed",
      description: "The attachment has been removed.",
    });
  };

  return (
    <div className="w-full h-full flex flex-col">
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2 mb-2 bg-muted rounded">
          {attachments.map((attachment, index) => (
            <Badge 
              key={`${attachment.url}-${index}`}
              variant={activeAttachment === index ? "default" : "outline"} 
              className={`flex items-center gap-1 py-1.5 cursor-pointer ${activeAttachment === index ? 'bg-primary text-primary-foreground' : ''}`}
              onClick={() => handleAttachmentClick(index)}
            >
              {attachment.type === 'image' ? (
                <Image className="h-4 w-4" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              <span className="truncate max-w-[200px]">{attachment.name}</span>
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-5 w-5 rounded-full ml-1" 
                onClick={(e) => {
                  e.stopPropagation();
                  removeAttachment(index);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
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