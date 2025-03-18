import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useKnowledge } from "@/hooks/use-knowledge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Upload, Globe, FileText } from "lucide-react";

interface KnowledgeSourceUploadProps {
  onSuccess?: () => void;
}

// Schema for file upload form
const fileFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  useRag: z.boolean().default(true),
  file: z.any().refine((file) => file instanceof File, "File is required"),
});

// Schema for text input form
const textFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  useRag: z.boolean().default(true),
  text: z.string().min(1, "Text content is required"),
});

// Schema for URL input form
const urlFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  useRag: z.boolean().default(true),
  url: z.string().url("Please enter a valid URL"),
});

export function KnowledgeSourceUpload({ onSuccess }: KnowledgeSourceUploadProps) {
  const [activeTab, setActiveTab] = useState<'file' | 'text' | 'url'>('file');
  const { uploadKnowledgeFile, addKnowledgeText, addKnowledgeUrl, isUploading, isAddingText, isAddingUrl } = useKnowledge();
  
  // File upload form
  const fileForm = useForm<z.infer<typeof fileFormSchema>>({
    resolver: zodResolver(fileFormSchema),
    defaultValues: {
      name: "",
      description: "",
      useRag: true,
    },
  });

  // Text input form
  const textForm = useForm<z.infer<typeof textFormSchema>>({
    resolver: zodResolver(textFormSchema),
    defaultValues: {
      name: "",
      description: "",
      useRag: true,
      text: "",
    },
  });

  // URL input form
  const urlForm = useForm<z.infer<typeof urlFormSchema>>({
    resolver: zodResolver(urlFormSchema),
    defaultValues: {
      name: "",
      description: "",
      useRag: true,
      url: "",
    },
  });

  // File upload handler
  const onFileSubmit = fileForm.handleSubmit((data) => {
    uploadKnowledgeFile({
      file: data.file,
      name: data.name,
      description: data.description,
      useRag: data.useRag,
    });
    
    fileForm.reset();
    onSuccess?.();
  });

  // Text input handler
  const onTextSubmit = textForm.handleSubmit((data) => {
    addKnowledgeText({
      text: data.text,
      name: data.name,
      description: data.description,
      useRag: data.useRag,
    });
    
    textForm.reset();
    onSuccess?.();
  });

  // URL input handler
  const onUrlSubmit = urlForm.handleSubmit((data) => {
    addKnowledgeUrl({
      url: data.url,
      name: data.name,
      description: data.description,
      useRag: data.useRag,
    });
    
    urlForm.reset();
    onSuccess?.();
  });

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'file' | 'text' | 'url')}>
      <TabsList className="grid grid-cols-3">
        <TabsTrigger value="file" className="flex items-center">
          <Upload className="mr-2 h-4 w-4" />
          File
        </TabsTrigger>
        <TabsTrigger value="text" className="flex items-center">
          <FileText className="mr-2 h-4 w-4" />
          Text
        </TabsTrigger>
        <TabsTrigger value="url" className="flex items-center">
          <Globe className="mr-2 h-4 w-4" />
          URL
        </TabsTrigger>
      </TabsList>

      {/* File Upload Tab */}
      <TabsContent value="file">
        <Form {...fileForm}>
          <form onSubmit={onFileSubmit} className="space-y-4">
            <FormField
              control={fileForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Knowledge source name" {...field} />
                  </FormControl>
                  <FormDescription>A name to identify this knowledge source</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={fileForm.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Brief description of this knowledge source" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={fileForm.control}
              name="file"
              render={({ field: { value, onChange, ...fieldProps } }) => (
                <FormItem>
                  <FormLabel>File</FormLabel>
                  <FormControl>
                    <Input
                      type="file"
                      accept=".pdf,.txt,.docx,.csv,.xlsx,.pptx,.md"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          onChange(file);
                        }
                      }}
                      {...fieldProps}
                    />
                  </FormControl>
                  <FormDescription>
                    Upload PDF, TXT, DOCX, CSV, XLSX, PPTX, or MD files
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={fileForm.control}
              name="useRag"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Use RAG</FormLabel>
                    <FormDescription>
                      Enable Retrieval-Augmented Generation for large documents
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <Button type="submit" disabled={isUploading} className="w-full">
              {isUploading ? "Uploading..." : "Upload File"}
            </Button>
          </form>
        </Form>
      </TabsContent>

      {/* Text Input Tab */}
      <TabsContent value="text">
        <Form {...textForm}>
          <form onSubmit={onTextSubmit} className="space-y-4">
            <FormField
              control={textForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Knowledge source name" {...field} />
                  </FormControl>
                  <FormDescription>A name to identify this knowledge source</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={textForm.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Brief description of this knowledge source" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={textForm.control}
              name="text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Text Content</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Paste your text content here"
                      className="min-h-[200px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={textForm.control}
              name="useRag"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Use RAG</FormLabel>
                    <FormDescription>
                      Enable Retrieval-Augmented Generation for large text
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <Button type="submit" disabled={isAddingText} className="w-full">
              {isAddingText ? "Adding..." : "Add Text"}
            </Button>
          </form>
        </Form>
      </TabsContent>

      {/* URL Input Tab */}
      <TabsContent value="url">
        <Form {...urlForm}>
          <form onSubmit={onUrlSubmit} className="space-y-4">
            <FormField
              control={urlForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Knowledge source name" {...field} />
                  </FormControl>
                  <FormDescription>A name to identify this knowledge source</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={urlForm.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Brief description of this knowledge source" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={urlForm.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com/document" {...field} />
                  </FormControl>
                  <FormDescription>
                    Enter a URL to a webpage or document
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={urlForm.control}
              name="useRag"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Use RAG</FormLabel>
                    <FormDescription>
                      Enable Retrieval-Augmented Generation for web content
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <Button type="submit" disabled={isAddingUrl} className="w-full">
              {isAddingUrl ? "Adding..." : "Add URL"}
            </Button>
          </form>
        </Form>
      </TabsContent>
    </Tabs>
  );
}