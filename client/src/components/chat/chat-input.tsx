import { useState, useRef, useCallback, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Image, SendHorizonal, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { estimateTokenCount } from '@/lib/llm/token-counter';
import type { Message as MessageType } from '@/lib/llm/types';

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
  /** Entire conversation messages to include in token counting */
  contextMessages?: MessageType[];
}

export function ChatInput({ onSendMessage, isLoading, modelContextLength = 128000, contextMessages = [] }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  // Store an array of attachments - all are always sent with the message
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tokenCount, setTokenCount] = useState(0);
  const [isOverLimit, setIsOverLimit] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingMessageRef = useRef<string>('');
  const pendingAttachmentRef = useRef<Attachment | undefined>(undefined);
  const { toast } = useToast();
  
  // Log the model context length for debugging
  console.log('Model context length:', modelContextLength);
  
  // We're now displaying the full context length in the UI instead of the 1/4 reserved for user messages
  // This gives users a better understanding of the model's total capacity
  const userTokenLimit = modelContextLength || 20000;
  
  // Calculate token count based on entire conversation, current message, and all document attachments
  const calculateTokenCount = useCallback(() => {
    let totalTokens = 0;

    // Include all previous conversation messages
    if (Array.isArray(contextMessages) && contextMessages.length > 0) {
      for (const m of contextMessages) {
        if (typeof m.content === 'string') {
          totalTokens += estimateTokenCount(m.content);
        }
      }
    }

    // Include current message being typed
    totalTokens += estimateTokenCount(message);
    
    // Add token count for all document attachments
    for (const attachment of attachments) {
      if (attachment.type === 'document' && attachment.text) {
        totalTokens += estimateTokenCount(attachment.text);
      }
    }
    
    return totalTokens;
  }, [message, attachments, contextMessages]);
  
  // Recalculate token limits when relevant values change
  useEffect(() => {
    const totalTokens = calculateTokenCount();
    setTokenCount(totalTokens);
    setIsOverLimit(totalTokens > userTokenLimit);
  }, [modelContextLength, message, attachments, calculateTokenCount, userTokenLimit, contextMessages]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      // Store the current message in memory before clearing the input
      pendingMessageRef.current = message;
      
      // Use the first attachment as primary for display purposes
      const primaryAttachment = attachments.length > 0 ? attachments[0] : undefined;
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
        } else {
          // Clear attachments after successful message submission
          // This ensures they're only used once and not included in future messages
          setAttachments([]);
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
    const totalTokens = calculateTokenCount();
    
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
  }, [calculateTokenCount, userTokenLimit, toast]);

  const renderUploadButton = useCallback(() => (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      onClick={() => fileInputRef.current?.click()}
      disabled={uploadingFile}
      title="Upload multiple files"
    >
      <FileText className="h-4 w-4" />
    </Button>
  ), [uploadingFile]);

  const renderSendButton = useCallback(() => (
    <Button type="submit" size="icon" disabled={isLoading || !message.trim()}>
      <SendHorizonal className="h-4 w-4" />
    </Button>
  ), [isLoading, message]);

  // Shared file upload processing logic
  const processFile = async (file: File) => {
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
      
      // If it's a document, update the token count 
      if (!isImage && attachmentData.text) {
        // Calculate tokens for all documents, including the new one
        let documentTokens = 0;
        for (const att of [...attachments, attachmentData]) {
          if (att.type === 'document' && att.text) {
            documentTokens += estimateTokenCount(att.text);
          }
        }
        
        if (documentTokens + estimateTokenCount(message) > userTokenLimit) {
          toast({
            title: "Document size warning",
            description: `The uploaded documents contain approximately ${documentTokens.toLocaleString()} tokens, which may exceed the model's context length of ${userTokenLimit.toLocaleString()} tokens.`,
            variant: "destructive"
          });
        }
      }
      
      return { success: true, fileName: file.name };
    } catch (error) {
      console.error('Error uploading file:', error);
      return { success: false, error, fileName: file.name };
    }
  };

  // Process multiple files
  const processFiles = async (files: FileList | File[]) => {
    if (files.length === 0) return;
    
    setUploadingFile(true);
    
    try {
      // Convert FileList to array
      const fileArray = Array.from(files);
      
      if (fileArray.length > 5) {
        toast({
          title: "Too many files",
          description: "You can upload a maximum of 5 files at once.",
          variant: "destructive"
        });
        // Process only the first 5 files
        fileArray.length = 5;
      }
      
      // Process each file
      const results = await Promise.all(fileArray.map(processFile));
      
      // Count successes and failures
      const successes = results.filter(r => r.success).length;
      const failures = results.filter(r => !r.success).length;
      
      // Notify user of results
      if (successes > 0 && failures === 0) {
        toast({
          title: 'Files uploaded',
          description: `${successes} ${successes === 1 ? 'file' : 'files'} uploaded successfully`,
        });
      } else if (successes > 0 && failures > 0) {
        toast({
          title: 'Some files uploaded',
          description: `${successes} of ${successes + failures} files uploaded successfully.`,
          variant: 'destructive'
        });
      } else {
        toast({
          title: 'Upload failed',
          description: 'All file uploads failed. Supported formats include documents (.pdf, .doc, .docx, .odt, .rtf, .txt), spreadsheets (.xlsx, .xls, .ods, .csv), presentations (.pptx, .ppt, .odp), and images (.jpg, .png, .gif, .svg).',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Error processing files:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload files. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setUploadingFile(false);
      // Reset the input value so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle file input change (from button click)
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    processFiles(e.target.files);
  };
  
  const removeAttachment = (index: number) => {
    // Create new attachment array without the removed item
    const newAttachments = attachments.filter((_, i) => i !== index);
    
    // Update attachments array
    setAttachments(newAttachments);
    
    toast({
      title: "Attachment removed",
      description: "The attachment has been removed.",
    });
  };

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, [setIsDragging]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, [setIsDragging]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    
    processFiles(e.dataTransfer.files);
  }, [processFiles, setIsDragging]);

  return (
    <div className="w-full h-full flex flex-col">
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2 mb-2 bg-muted rounded">
          {attachments.map((attachment, index) => (
            <Badge 
              key={`${attachment.url}-${index}`}
              variant="outline" 
              className="flex items-center gap-1 py-1.5"
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
          multiple
          accept="image/*,.pdf,.doc,.docx,.odt,.rtf,.txt,.xlsx,.xls,.ods,.csv,.pptx,.ppt,.odp"
        />
        
        <div className="relative flex-1 mb-2">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextChange}
            placeholder="Type your message..."
            className={`min-h-[60px] h-full resize-none ${isDragging ? 'border-primary border-2' : ''}`}
            onKeyDown={handleKeyDown}
            style={{ height: '100%' }}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
          
          {/* Drop zone indicator overlay */}
          {isDragging && (
            <div 
              className="absolute inset-0 bg-primary/10 flex items-center justify-center pointer-events-none border-2 border-primary rounded-md"
            >
              <div className="flex flex-col items-center gap-2 text-center">
                <FileText className="h-8 w-8 text-primary" />
                <p className="font-medium text-sm">Drop files here to upload (up to 5)</p>
              </div>
            </div>
          )}
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