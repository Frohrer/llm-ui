import { useState } from "react";
import { useKnowledge, type KnowledgeSource } from "@/hooks/use-knowledge";
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Unlink, FileText, Globe, PlusCircle } from "lucide-react";
import { KnowledgeSourceList } from "./knowledge-source-list";
import { Skeleton } from "@/components/ui/skeleton";

interface ConversationKnowledgeProps {
  conversationId: number;
}

export function ConversationKnowledge({ conversationId }: ConversationKnowledgeProps) {
  const { 
    getConversationKnowledgeSources, 
    removeKnowledgeFromConversation, 
    isDetaching 
  } = useKnowledge();
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  
  const knowledgeSources = getConversationKnowledgeSources(conversationId);

  if (knowledgeSources.isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold">Knowledge Sources</h2>
        </div>
        {Array.from({ length: 2 }).map((_, index) => (
          <Card key={index} className="w-full">
            <CardHeader>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (knowledgeSources.isError) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>Failed to load knowledge sources</CardDescription>
        </CardHeader>
        <CardContent>
          <p>{knowledgeSources.error.message}</p>
          <Button 
            variant="outline" 
            onClick={() => knowledgeSources.refetch()}
            className="mt-2"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const sources = knowledgeSources.data || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Conversation Knowledge</h2>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Knowledge
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Knowledge Source</DialogTitle>
              <DialogDescription>
                Select a knowledge source to add to this conversation.
              </DialogDescription>
            </DialogHeader>
            <KnowledgeSourceList 
              conversationId={conversationId}
              showAttachButton={true}
              onSelectKnowledgeSource={(source) => {
                setIsAddDialogOpen(false);
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {sources.length === 0 ? (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>No Knowledge Sources</CardTitle>
            <CardDescription>
              This conversation doesn't have any knowledge sources attached.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Knowledge sources provide context to the AI, allowing it to reference specific information
              in its responses.
            </p>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Knowledge Source
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sources.map((source: KnowledgeSource) => (
            <Card key={source.id} className="w-full">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center">
                      {source.type === 'file' && <FileText className="mr-2 h-4 w-4" />}
                      {source.type === 'url' && <Globe className="mr-2 h-4 w-4" />}
                      {source.type === 'text' && <FileText className="mr-2 h-4 w-4" />}
                      {source.name}
                    </CardTitle>
                    <CardDescription>
                      {source.description || `${source.type} knowledge source`}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={source.use_rag ? "default" : "outline"}>
                      {source.use_rag ? "RAG" : "Full Text"}
                    </Badge>
                    <Badge variant="outline">{source.type}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex justify-end">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    removeKnowledgeFromConversation({ 
                      conversationId, 
                      knowledgeSourceId: source.id 
                    });
                  }}
                  disabled={isDetaching}
                >
                  <Unlink className="mr-2 h-4 w-4" />
                  Detach
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}