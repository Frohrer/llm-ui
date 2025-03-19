import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Database } from 'lucide-react';

interface KnowledgeNotificationProps {
  conversationId?: number;
}

// A component to handle tracking knowledge usage in conversations and displaying notifications
export function KnowledgeNotification({ conversationId }: KnowledgeNotificationProps) {
  const { toast } = useToast();
  // Use local storage to persist notifications across page refreshes
  const [notifiedConversations, setNotifiedConversations] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('notifiedKnowledgeConversations');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  
  // Function to mark a conversation as having shown the knowledge notification
  const markConversationNotified = (convId: number) => {
    setNotifiedConversations(prev => {
      // Only add if not already in the array
      if (!prev.includes(convId)) {
        const updated = [...prev, convId];
        // Save to local storage
        try {
          localStorage.setItem('notifiedKnowledgeConversations', JSON.stringify(updated));
        } catch (e) {
          console.error('Failed to save notification state to localStorage:', e);
        }
        return updated;
      }
      return prev;
    });
  };

  // Listen for knowledge usage events from message streaming
  useEffect(() => {
    if (!conversationId) return;

    // Create a function to handle knowledge injection events
    const handleKnowledgeInjection = (event: CustomEvent) => {
      const { conversationId: eventConvId, knowledgeUsed } = event.detail || {};
      
      // Only show notification if knowledge was used and we haven't shown it for this conversation yet
      if (
        eventConvId && 
        knowledgeUsed && 
        eventConvId === conversationId && 
        !notifiedConversations.includes(eventConvId)
      ) {
        // Show toast notification
        toast({
          title: "Knowledge Source Used",
          description: "Your attached knowledge sources have been referenced to answer your question."
        });
        
        // Mark this conversation as having shown the notification
        markConversationNotified(eventConvId);
      }
    };

    // Add event listener for knowledge injection events
    window.addEventListener('knowledge-injection', handleKnowledgeInjection as EventListener);
    
    // Clean up
    return () => {
      window.removeEventListener('knowledge-injection', handleKnowledgeInjection as EventListener);
    };
  }, [conversationId, notifiedConversations, toast]);

  // This is a "headless" component - it doesn't render anything, just provides the notification behavior
  return null;
}