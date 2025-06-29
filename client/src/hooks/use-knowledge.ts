import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "./use-toast";

// Type definitions
export interface KnowledgeSource {
  id: number;
  name: string;
  description?: string;
  source_type: 'file' | 'text' | 'url';
  type?: 'file' | 'text' | 'url'; // Keep for backward compatibility
  url?: string;
  content_text?: string;
  content_length: number;
  use_rag: boolean;
  is_shared: boolean;
  created_at: string;
  user_id: number;
}

// API functions
export async function fetchKnowledgeSources(): Promise<KnowledgeSource[]> {
  const response = await fetch('/api/knowledge');
  if (!response.ok) {
    throw new Error(`Failed to fetch knowledge sources: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchKnowledgeSource(id: number): Promise<KnowledgeSource> {
  const response = await fetch(`/api/knowledge/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch knowledge source: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteKnowledgeSource(id: number): Promise<{ success: boolean }> {
  const response = await fetch(`/api/knowledge/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete knowledge source: ${response.statusText}`);
  }
  return response.json();
}

export async function addKnowledgeToConversation(
  conversationId: number, 
  knowledgeSourceId: number
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/knowledge/conversation/${conversationId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ knowledgeSourceId }),
  });
  if (!response.ok) {
    throw new Error(`Failed to add knowledge to conversation: ${response.statusText}`);
  }
  return response.json();
}

export async function removeKnowledgeFromConversation(
  conversationId: number, 
  knowledgeSourceId: number
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/knowledge/conversation/${conversationId}/${knowledgeSourceId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to remove knowledge from conversation: ${response.statusText}`);
  }
  return response.json();
}

export async function getConversationKnowledge(
  conversationId: number
): Promise<KnowledgeSource[]> {
  const response = await fetch(`/api/knowledge/conversation/${conversationId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch conversation knowledge: ${response.statusText}`);
  }
  return response.json();
}

// Upload a file as a knowledge source
export async function uploadKnowledgeFile(
  file: File,
  name: string,
  description?: string,
  useRag?: boolean,
  isShared?: boolean
): Promise<KnowledgeSource> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  
  if (description) {
    formData.append('description', description);
  }
  
  if (useRag !== undefined) {
    formData.append('useRag', useRag.toString());
  }

  if (isShared !== undefined) {
    formData.append('isShared', isShared.toString());
  }

  const response = await fetch('/api/knowledge/file', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload knowledge file: ${response.statusText}`);
  }

  return response.json();
}

// Add text as a knowledge source
export async function addKnowledgeText(
  text: string,
  name: string,
  description?: string,
  useRag?: boolean,
  isShared?: boolean
): Promise<KnowledgeSource> {
  const response = await fetch('/api/knowledge/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      name,
      description,
      useRag,
      isShared,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to add knowledge text: ${response.statusText}`);
  }

  return response.json();
}

// Add URL as a knowledge source
export async function addKnowledgeUrl(
  url: string,
  name: string,
  description?: string,
  useRag?: boolean,
  isShared?: boolean
): Promise<KnowledgeSource> {
  const response = await fetch('/api/knowledge/url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      name,
      description,
      useRag,
      isShared,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to add knowledge URL: ${response.statusText}`);
  }

  return response.json();
}

// Update text knowledge source
export async function updateKnowledgeText(
  id: number,
  data: {
    name?: string;
    description?: string;
    text?: string;
    useRag?: boolean;
  }
): Promise<KnowledgeSource> {
  const response = await fetch(`/api/knowledge/text/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to update knowledge text: ${response.statusText}`);
  }

  return response.json();
}

// Toggle sharing status of a knowledge source
export async function toggleKnowledgeSourceSharing(id: number): Promise<KnowledgeSource> {
  const response = await fetch(`/api/knowledge/${id}/share`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to toggle knowledge source sharing: ${response.statusText}`);
  }

  return response.json();
}

// Custom hook to manage knowledge sources
export function useKnowledge() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get all knowledge sources
  const knowledgeSources = useQuery({
    queryKey: ['/api/knowledge'],
    queryFn: fetchKnowledgeSources,
  });

  // Get conversation knowledge sources
  // Always enable the query, but only fetch when the ID is positive
  const getConversationKnowledgeSources = (conversationId: number) => 
    useQuery({
      queryKey: ['/api/knowledge/conversation', conversationId],
      queryFn: () => {
        // Only perform the API call for valid IDs (positive numbers)
        if (conversationId > 0) {
          return getConversationKnowledge(conversationId);
        }
        // Return empty array for invalid/dummy IDs
        return Promise.resolve([]);
      },
      // Always enabled, we'll handle the conditional fetching inside
      enabled: true,
    });

  // Delete a knowledge source
  const deleteKnowledgeSourceMutation = useMutation({
    mutationFn: deleteKnowledgeSource,
    onSuccess: () => {
      toast({
        title: "Knowledge source deleted",
        description: "The knowledge source was successfully deleted.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete knowledge source",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Upload a file as a knowledge source
  const uploadKnowledgeFileMutation = useMutation({
    mutationFn: (params: { file: File; name: string; description?: string; useRag?: boolean; isShared?: boolean }) => 
      uploadKnowledgeFile(params.file, params.name, params.description, params.useRag, params.isShared),
    onSuccess: () => {
      toast({
        title: "Knowledge file uploaded",
        description: "Your file was successfully uploaded as a knowledge source.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to upload knowledge file",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add text as a knowledge source
  const addKnowledgeTextMutation = useMutation({
    mutationFn: (params: { text: string; name: string; description?: string; useRag?: boolean; isShared?: boolean }) => 
      addKnowledgeText(params.text, params.name, params.description, params.useRag, params.isShared),
    onSuccess: () => {
      toast({
        title: "Knowledge text added",
        description: "Your text was successfully added as a knowledge source.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add knowledge text",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add URL as a knowledge source
  const addKnowledgeUrlMutation = useMutation({
    mutationFn: (params: { url: string; name: string; description?: string; useRag?: boolean; isShared?: boolean }) => 
      addKnowledgeUrl(params.url, params.name, params.description, params.useRag, params.isShared),
    onSuccess: () => {
      toast({
        title: "Knowledge URL added",
        description: "Your URL was successfully added as a knowledge source.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add knowledge URL",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add knowledge to conversation
  const addKnowledgeToConversationMutation = useMutation({
    mutationFn: (params: { conversationId: number; knowledgeSourceId: number }) => 
      addKnowledgeToConversation(params.conversationId, params.knowledgeSourceId),
    onSuccess: (_, variables) => {
      toast({
        title: "Knowledge source attached",
        description: "The knowledge source was successfully attached to the conversation.",
      });
      queryClient.invalidateQueries({ 
        queryKey: ['/api/knowledge/conversation', variables.conversationId] 
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to attach knowledge source",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Remove knowledge from conversation
  const removeKnowledgeFromConversationMutation = useMutation({
    mutationFn: (params: { conversationId: number; knowledgeSourceId: number }) => 
      removeKnowledgeFromConversation(params.conversationId, params.knowledgeSourceId),
    onSuccess: (_, variables) => {
      toast({
        title: "Knowledge source detached",
        description: "The knowledge source was successfully detached from the conversation.",
      });
      queryClient.invalidateQueries({ 
        queryKey: ['/api/knowledge/conversation', variables.conversationId] 
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to detach knowledge source",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update text knowledge source
  const updateTextMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateKnowledgeText>[1] }) => 
      updateKnowledgeText(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources'] });
      toast({
        title: "Success",
        description: "Knowledge source updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Toggle knowledge source sharing
  const toggleSharingMutation = useMutation({
    mutationFn: (id: number) => toggleKnowledgeSourceSharing(id),
    onSuccess: (updatedSource) => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
      toast({
        title: updatedSource.is_shared ? "Knowledge source shared" : "Knowledge source unshared",
        description: updatedSource.is_shared 
          ? "This knowledge source is now shared with all users." 
          : "This knowledge source is now private to you.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to toggle sharing",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    knowledgeSources,
    getConversationKnowledgeSources,
    deleteKnowledgeSource: deleteKnowledgeSourceMutation.mutate,
    uploadKnowledgeFile: uploadKnowledgeFileMutation.mutate,
    addKnowledgeText: addKnowledgeTextMutation.mutate,
    addKnowledgeUrl: addKnowledgeUrlMutation.mutate,
    addKnowledgeToConversation: addKnowledgeToConversationMutation.mutate,
    removeKnowledgeFromConversation: removeKnowledgeFromConversationMutation.mutate,
    toggleKnowledgeSourceSharing: toggleSharingMutation.mutate,
    isDeleting: deleteKnowledgeSourceMutation.isPending,
    isUploading: uploadKnowledgeFileMutation.isPending,
    isAddingText: addKnowledgeTextMutation.isPending,
    isAddingUrl: addKnowledgeUrlMutation.isPending,
    isAttaching: addKnowledgeToConversationMutation.isPending,
    isDetaching: removeKnowledgeFromConversationMutation.isPending,
    isTogglingSharing: toggleSharingMutation.isPending,
    updateKnowledgeText: (id: number, data: Parameters<typeof updateKnowledgeText>[1]) => 
      updateTextMutation.mutate({ id, data }),
    isUpdatingText: updateTextMutation.isPending,
  };
}