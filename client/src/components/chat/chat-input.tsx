import { useState, useRef, useCallback, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Image, SendHorizonal, X, Plus, Mic, Loader2, Check as CheckIcon, BookOpen } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { estimateTokenCount } from '@/lib/llm/token-counter';
import type { Message as MessageType } from '@/lib/llm/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSpeechToText } from '@/hooks/use-speech-to-text';

type Attachment = {
  type: 'document' | 'image';
  url: string;
  text?: string;
  name: string;
};

interface ChatInputProps {
  onSendMessage: (message: string, attachment?: Attachment, allAttachments?: Attachment[]) => Promise<boolean | void>;
  isLoading: boolean;
  modelContextLength?: number;
  contextMessages?: MessageType[];
  isNsfw?: boolean;
  onToggleNsfw?: () => void;
  queueSize?: number;
  onClearQueue?: () => void;
  onAddKnowledge?: () => void;
}

export function ChatInput({ onSendMessage, isLoading, modelContextLength = 128000, contextMessages = [], isNsfw, onToggleNsfw, queueSize = 0, onClearQueue, onAddKnowledge }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tokenCount, setTokenCount] = useState(0);
  const [isOverLimit, setIsOverLimit] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingMessageRef = useRef<string>('');
  const pendingAttachmentRef = useRef<Attachment | undefined>(undefined);
  const { toast } = useToast();
  const { state: speechState, audioLevels, startRecording, stopRecording, cancelRecording } = useSpeechToText();

  const userTokenLimit = modelContextLength || 20000;

  const calculateTokenCount = useCallback(() => {
    let totalTokens = 0;
    if (Array.isArray(contextMessages) && contextMessages.length > 0) {
      for (const m of contextMessages) {
        if (typeof m.content === 'string') {
          totalTokens += estimateTokenCount(m.content);
        }
      }
    }
    totalTokens += estimateTokenCount(message);
    for (const attachment of attachments) {
      if (attachment.type === 'document' && attachment.text) {
        totalTokens += estimateTokenCount(attachment.text);
      }
    }
    return totalTokens;
  }, [message, attachments, contextMessages]);

  useEffect(() => {
    const totalTokens = calculateTokenCount();
    setTokenCount(totalTokens);
    setIsOverLimit(totalTokens > userTokenLimit);
  }, [modelContextLength, message, attachments, calculateTokenCount, userTokenLimit, contextMessages]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }
  }, [message]);

  // Keep the textarea focused after a response finishes streaming,
  // so the user can immediately type the next prompt.
  const wasLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && speechState === 'idle') {
      textareaRef.current?.focus();
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, speechState]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      pendingMessageRef.current = message;
      const primaryAttachment = attachments.length > 0 ? attachments[0] : undefined;
      pendingAttachmentRef.current = primaryAttachment;
      setMessage('');
      textareaRef.current?.focus();

      try {
        const success = await onSendMessage(pendingMessageRef.current, primaryAttachment, attachments);
        if (!success) {
          setMessage(pendingMessageRef.current);
        } else {
          setAttachments([]);
        }
        pendingMessageRef.current = '';
        pendingAttachmentRef.current = undefined;
      } catch (error) {
        setMessage(pendingMessageRef.current);
        pendingMessageRef.current = '';
        pendingAttachmentRef.current = undefined;
      }
    }
  }, [message, onSendMessage, attachments]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }, [handleSubmit]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  }, []);

  // Shared file upload processing
  const processFile = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!response.ok) throw new Error('File upload failed');
      const data = await response.json();
      const isImage = file.type.startsWith('image/');
      const attachmentData: Attachment = {
        type: isImage ? 'image' : 'document',
        url: data.file.url,
        text: isImage ? undefined : data.file.text,
        name: file.name
      };
      setAttachments(prev => [...prev, attachmentData]);
      return { success: true, fileName: file.name };
    } catch (error) {
      console.error('Error uploading file:', error);
      return { success: false, error, fileName: file.name };
    }
  };

  const processFiles = async (files: FileList | File[]) => {
    if (files.length === 0) return;
    setUploadingFile(true);
    try {
      const fileArray = Array.from(files);
      if (fileArray.length > 5) {
        toast({ title: "Too many files", description: "Maximum 5 files at once.", variant: "destructive" });
        fileArray.length = 5;
      }
      const results = await Promise.all(fileArray.map(processFile));
      const successes = results.filter(r => r.success).length;
      const failures = results.filter(r => !r.success).length;
      if (successes > 0 && failures === 0) {
        toast({ title: 'Files uploaded', description: `${successes} file${successes > 1 ? 's' : ''} uploaded` });
      } else if (failures > 0) {
        toast({ title: 'Upload issue', description: `${successes} of ${successes + failures} uploaded`, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Upload failed', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    processFiles(e.target.files);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Drag and drop
  const handleDragEnter = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files);
  }, []);

  // Speech-to-text handlers
  const handleMicClick = async () => {
    try {
      await startRecording();
    } catch {
      toast({ title: 'Microphone error', description: 'Could not access microphone.', variant: 'destructive' });
    }
  };

  const handleConfirmRecording = async () => {
    try {
      const text = await stopRecording();
      if (text) {
        setMessage(prev => prev ? prev + ' ' + text : text);
        // Focus textarea after transcription
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
    } catch {
      toast({ title: 'Transcription failed', description: 'Could not transcribe audio.', variant: 'destructive' });
    }
  };

  return (
    <div className="w-full">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        className="hidden"
        multiple
        accept="image/*,.pdf,.doc,.docx,.odt,.rtf,.txt,.xlsx,.xls,.ods,.csv,.pptx,.ppt,.odp"
      />

      {/* Pill container */}
      <div
        className={`rounded-2xl border bg-background shadow-sm transition-colors ${
          isDragging ? 'border-primary ring-2 ring-primary/30' : 'border-border focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30'
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Attachment badges inside pill */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
            {attachments.map((attachment, index) => (
              <Badge
                key={`${attachment.url}-${index}`}
                variant="secondary"
                className="flex items-center gap-1 py-1 text-xs"
              >
                {attachment.type === 'image' ? <Image className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
                <span className="truncate max-w-[100px] sm:max-w-[160px]">{attachment.name}</span>
                <button
                  onClick={() => removeAttachment(index)}
                  className="ml-0.5 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {uploadingFile && (
              <Badge variant="outline" className="flex items-center gap-1 py-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading...
              </Badge>
            )}
          </div>
        )}

        {/* Input row */}
        <form onSubmit={handleSubmit} className="flex items-center gap-1 p-2">
          {/* [+] Attach button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="shrink-0 h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                disabled={speechState === 'recording' || uploadingFile}
              >
                <Plus className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="min-w-[180px]">
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileText className="h-4 w-4 mr-2" />
                Upload file
              </DropdownMenuItem>
              {onAddKnowledge && (
                <DropdownMenuItem onClick={onAddKnowledge}>
                  <BookOpen className="h-4 w-4 mr-2" />
                  Add Knowledge
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Recording / transcribing / textarea */}
          {speechState === 'recording' ? (
            <div className="flex-1 flex items-center gap-1 h-10 px-2">
              {/* Waveform */}
              <div className="flex items-center gap-[2px] flex-1 h-8 overflow-hidden">
                {audioLevels.map((level, i) => (
                  <div
                    key={i}
                    className="w-[3px] bg-primary rounded-full transition-all duration-75"
                    style={{ height: `${Math.max(3, level * 28)}px` }}
                  />
                ))}
              </div>
            </div>
          ) : speechState === 'transcribing' ? (
            <div className="flex-1 flex items-center justify-center h-10 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Transcribing...
            </div>
          ) : (
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything"
              className="flex-1 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none min-h-[40px] max-h-[200px] py-2 px-1 text-sm"
              style={{ outline: 'none' }}
              rows={1}
            />
          )}

          {/* Right button: context-dependent */}
          {speechState === 'recording' ? (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={cancelRecording}
                className="h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Cancel recording"
              >
                <X className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={handleConfirmRecording}
                className="h-9 w-9 flex items-center justify-center rounded-xl text-primary hover:bg-primary/10 transition-colors"
                title="Stop and transcribe"
              >
                <CheckIcon className="h-5 w-5" />
              </button>
            </div>
          ) : speechState === 'transcribing' ? null : message.trim() ? (
            <button
              type="submit"
              disabled={isLoading}
              onMouseDown={(e) => e.preventDefault()}
              className="shrink-0 h-9 w-9 flex items-center justify-center rounded-xl bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
            >
              <SendHorizonal className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleMicClick}
              className="shrink-0 h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Voice input"
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
        </form>
      </div>

      {/* Info row below pill */}
      <div className="flex items-center gap-2 mt-1.5 px-2 text-xs text-muted-foreground">
        {onToggleNsfw && (
          <button
            type="button"
            onClick={onToggleNsfw}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
              isNsfw ? "text-destructive font-medium" : "hover:text-foreground"
            }`}
          >
            {isNsfw ? "Hidden" : "Hide"}
          </button>
        )}
        {queueSize > 0 && (
          <button
            type="button"
            onClick={onClearQueue}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
          >
            {queueSize} queued <X className="h-3 w-3" />
          </button>
        )}
        <div className="ml-auto">
          <span className={isOverLimit ? "text-destructive font-medium" : ""}>
            {tokenCount.toLocaleString()}
          </span>
          {' / '}
          <span className="hidden sm:inline">{userTokenLimit.toLocaleString()} tokens</span>
          <span className="sm:hidden">{(userTokenLimit / 1000).toFixed(0)}k</span>
        </div>
      </div>
    </div>
  );
}
