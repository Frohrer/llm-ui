import { useState } from "react";
import { useKnowledge, type KnowledgeSource } from "@/hooks/use-knowledge";
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent, 
  CardFooter 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Trash, FileText, Globe, PlusCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { KnowledgeSourceUpload } from "@/components/knowledge/knowledge-source-upload";
import { Skeleton } from "@/components/ui/skeleton";

interface KnowledgeSourceListProps {
  onSelectKnowledgeSource?: (source: KnowledgeSource) => void;
  conversationId?: number;
  showAttachButton?: boolean;
  selectedSourceIds?: number[];
}

export function KnowledgeSourceList({ 
  onSelectKnowledgeSource, 
  conversationId,
  showAttachButton = false,
  selectedSourceIds = []
}: KnowledgeSourceListProps) {
  const { 
    knowledgeSources, 
    deleteKnowledgeSource, 
    isDeleting,
    addKnowledgeToConversation,
    isAttaching
  } = useKnowledge();
  
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  if (knowledgeSources.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="w-full">
            <CardHeader>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full" />
            </CardContent>
            <CardFooter>
              <Skeleton className="h-8 w-20" />
            </CardFooter>
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
        </CardContent>
        <CardFooter>
          <Button onClick={() => knowledgeSources.refetch()}>Retry</Button>
        </CardFooter>
      </Card>
    );
  }

  const sources = knowledgeSources.data || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Knowledge Sources</h2>
        <Sheet open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Knowledge
            </Button>
          </SheetTrigger>
          <SheetContent className="w-[90%] sm:w-[540px] md:w-[720px] lg:w-[920px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Add Knowledge Source</SheetTitle>
              <SheetDescription>
                Upload a file, add text, or link a URL as a knowledge source.
              </SheetDescription>
            </SheetHeader>
            <div className="py-6">
              <KnowledgeSourceUpload onSuccess={() => setIsUploadDialogOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {sources.length === 0 ? (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>No Knowledge Sources</CardTitle>
            <CardDescription>
              You haven't added any knowledge sources yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Knowledge sources allow you to reference external information in your AI conversations.
              You can upload files (PDF, TXT, etc.), paste text, or add a URL.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => setIsUploadDialogOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Knowledge Source
            </Button>
          </CardFooter>
        </Card>
      ) : (
        sources.map((source) => (
          <Card 
            key={source.id} 
            className={`w-full hover:bg-accent/10 cursor-pointer transition-colors ${selectedSourceIds.includes(source.id) ? "border-primary border-2" : ""}`}
            onClick={() => onSelectKnowledgeSource?.(source)}
          >
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
                    Added {formatDistanceToNow(new Date(source.created_at), { addSuffix: true })}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Badge variant={source.use_rag ? "default" : "outline"}>
                    {source.use_rag ? "RAG" : "Full Text"}
                  </Badge>
                  <Badge variant="outline">{source.type}</Badge>
                  {selectedSourceIds.includes(source.id) && (
                    <Badge variant="default" className="bg-primary">Selected</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {source.description && (
                <p className="text-sm text-muted-foreground">{source.description}</p>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={(e) => {
                  e.stopPropagation();
                  deleteKnowledgeSource(source.id);
                }}
                disabled={isDeleting}
              >
                <Trash className="mr-2 h-4 w-4" />
                Delete
              </Button>
              
              {showAttachButton && (
                <>
                  {conversationId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        addKnowledgeToConversation({ 
                          conversationId, 
                          knowledgeSourceId: source.id 
                        });
                      }}
                      disabled={isAttaching}
                    >
                      Attach to Conversation
                    </Button>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Start a conversation to attach this knowledge source
                    </div>
                  )}
                </>
              )}
            </CardFooter>
          </Card>
        ))
      )}
    </div>
  );
}