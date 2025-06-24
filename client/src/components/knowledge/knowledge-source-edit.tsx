import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useKnowledge, type KnowledgeSource } from "@/hooks/use-knowledge";
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

// Schema for text edit form
const textFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  useRag: z.boolean().default(true),
  text: z.string().min(1, "Text content is required"),
});

interface KnowledgeSourceEditProps {
  source: KnowledgeSource;
  onSuccess?: () => void;
}

export function KnowledgeSourceEdit({ source, onSuccess }: KnowledgeSourceEditProps) {
  const { updateKnowledgeText, isUpdatingText } = useKnowledge();
  
  // Text input form
  const form = useForm<z.infer<typeof textFormSchema>>({
    resolver: zodResolver(textFormSchema),
    defaultValues: {
      name: source.name,
      description: source.description || "",
      useRag: source.use_rag,
      text: source.content_text || "",
    },
  });

  // Text input handler
  const onSubmit = form.handleSubmit((data) => {
    updateKnowledgeText(source.id, {
      name: data.name,
      description: data.description,
      text: data.text,
      useRag: data.useRag,
    });
    
    onSuccess?.();
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          control={form.control}
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
          control={form.control}
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
          control={form.control}
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
          control={form.control}
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
        
        <Button type="submit" disabled={isUpdatingText} className="w-full">
          {isUpdatingText ? "Updating..." : "Update Text"}
        </Button>
      </form>
    </Form>
  );
} 