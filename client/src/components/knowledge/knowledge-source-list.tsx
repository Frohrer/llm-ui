import { useState } from "react";
import { useKnowledge, type KnowledgeSource } from "@/hooks/use-knowledge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Trash, FileText, Globe, PlusCircle, Unlink, Link, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { KnowledgeSourceUpload } from "@/components/knowledge/knowledge-source-upload";
import { Skeleton } from "@/components/ui/skeleton";

export type KnowledgeSourceListMode = "all" | "conversation";

interface KnowledgeSourceListProps {
  /** Optional callback when a knowledge source is selected */
  onSelectKnowledgeSource?: (source: KnowledgeSource) => void;
  /** The current conversation ID, if viewing in conversation context */
  conversationId?: number;
  /** Show attach button, only used in mode="all" */
  showAttachButton?: boolean;
  /** IDs of sources that are currently selected */
  selectedSourceIds?: number[];
  /** The operating mode of the list */
  mode?: KnowledgeSourceListMode;
  /** Whether to show the add knowledge button */
  showAddButton?: boolean;
  /** Grid layout for the cards */
  gridLayout?: boolean;
}

export function KnowledgeSourceList({
  onSelectKnowledgeSource,
  conversationId,
  showAttachButton = false,
  selectedSourceIds = [],
  mode = "all",
  showAddButton = true,
  gridLayout = false,
}: KnowledgeSourceListProps) {
  const {
    knowledgeSources,
    getConversationKnowledgeSources,
    deleteKnowledgeSource,
    isDeleting,
    addKnowledgeToConversation,
    isAttaching,
    removeKnowledgeFromConversation,
    isDetaching,
  } = useKnowledge();

  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  // Always call both hooks to maintain consistency
  const allKnowledgeSources = knowledgeSources;
  const conversationKnowledgeSources = conversationId 
    ? getConversationKnowledgeSources(conversationId) 
    : { isLoading: false, isError: false, data: [], error: null, refetch: () => {} };
  
  // Then determine which data to use based on mode
  const dataQuery = mode === "conversation" && conversationId
    ? conversationKnowledgeSources
    : allKnowledgeSources;

  if (dataQuery.isLoading) {
    return (
      <div className={gridLayout ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-4"}>
        {Array.from({ length: gridLayout ? 4 : 3 }).map((_, index) => (
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

  if (dataQuery.isError) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>Failed to load knowledge sources</CardDescription>
        </CardHeader>
        <CardContent>
          <p>{dataQuery.error?.message || 'Unknown error occurred'}</p>
        </CardContent>
        <CardFooter>
          <Button onClick={() => dataQuery.refetch()} variant="outline">Retry</Button>
        </CardFooter>
      </Card>
    );
  }

  const sources = dataQuery.data || [];

  return (
    <div className="space-y-4">
      {showAddButton && (
        <div className="flex justify-between items-center">
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
                  {mode === "conversation" 
                    ? "Select a knowledge source to add to this conversation." 
                    : "Upload a file, add text, or link a URL as a knowledge source."}
                </SheetDescription>
              </SheetHeader>
              <div className="py-6">
                {mode === "conversation" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Select a knowledge source to add to this conversation:
                    </p>
                    <div className={gridLayout ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-4"}>
                      {allKnowledgeSources.data && allKnowledgeSources.data.map((source) => (
                        <Card
                          key={source.id}
                          className="w-full hover:bg-accent/10 transition-colors cursor-pointer"
                          onClick={() => {
                            if (conversationId) {
                              addKnowledgeToConversation({
                                conversationId,
                                knowledgeSourceId: source.id,
                              });
                              setIsUploadDialogOpen(false);
                            }
                          }}
                        >
                          <CardHeader>
                            <div className="flex justify-between items-start">
                              <CardTitle className="flex items-center">
                                {(source.source_type === "file" || !source.source_type) && <FileText className="mr-2 h-4 w-4" />}
                                {source.source_type === "url" && <Globe className="mr-2 h-4 w-4" />}
                                {source.source_type === "text" && <FileText className="mr-2 h-4 w-4" />}
                                {source.name}
                              </CardTitle>
                              <div className="flex gap-2">
                                <Badge variant={source.use_rag ? "default" : "outline"}>
                                  {source.use_rag ? "RAG" : "Full Text"}
                                </Badge>
                                <Badge variant="outline">{source.source_type || 'file'}</Badge>
                              </div>
                            </div>
                          </CardHeader>
                          <CardFooter>
                            <Button 
                              variant="outline" 
                              size="sm"
                              disabled={isAttaching}
                            >
                              <Link className="mr-2 h-4 w-4" />
                              Add to conversation
                            </Button>
                          </CardFooter>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : (
                  <KnowledgeSourceUpload
                    onSuccess={() => setIsUploadDialogOpen(false)}
                  />
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      )}

      {sources.length === 0 ? (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>No Knowledge Sources</CardTitle>
            <CardDescription>
              {mode === "conversation"
                ? "This conversation doesn't have any knowledge sources attached."
                : "You haven't added any knowledge sources yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {mode === "conversation"
                ? "Knowledge sources provide context to the AI, allowing it to reference specific information in its responses."
                : "Knowledge sources allow you to reference external information in your AI conversations. You can upload files (PDF, TXT, etc.), paste text, or add a URL."}
            </p>
            {showAddButton && (
              <Button
                variant="outline"
                onClick={() => setIsUploadDialogOpen(true)}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Knowledge Source
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className={gridLayout ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-4"}>
          {sources.map((source) => (
            <Card
              key={source.id}
              className={`w-full hover:bg-accent/10 transition-colors ${onSelectKnowledgeSource ? "cursor-pointer" : ""} ${
                selectedSourceIds.includes(source.id) ? "border-primary border-2" : ""
              }`}
              onClick={() => onSelectKnowledgeSource?.(source)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center">
                      {(source.source_type === "file" || !source.source_type) && (
                        <FileText className="mr-2 h-4 w-4" />
                      )}
                      {source.source_type === "url" && (
                        <Globe className="mr-2 h-4 w-4" />
                      )}
                      {source.source_type === "text" && (
                        <FileText className="mr-2 h-4 w-4" />
                      )}
                      {source.name}
                    </CardTitle>
                    <CardDescription>
                      {source.description || (
                        mode === "all" 
                          ? `Added ${formatDistanceToNow(new Date(source.created_at), { addSuffix: true })}`
                          : `${source.source_type || 'file'} knowledge source`
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <Badge variant={source.use_rag ? "default" : "outline"}>
                      {source.use_rag ? "RAG" : "Full Text"}
                    </Badge>
                    <Badge variant="outline">{source.source_type || 'file'}</Badge>
                    <Badge 
                      variant={selectedSourceIds.includes(source.id) ? "default" : "outline"}
                      className={selectedSourceIds.includes(source.id) ? "bg-green-500" : "text-gray-400"}
                    >
                      {selectedSourceIds.includes(source.id) ? (
                        <Check className="h-3.5 w-3.5 mr-1" />
                      ) : (
                        <Check className="h-3.5 w-3.5 mr-1" />
                      )}
                      {selectedSourceIds.includes(source.id) ? "Selected" : "Select"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              {source.description && mode === "all" && (
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {source.description}
                  </p>
                </CardContent>
              )}
              <CardFooter className="flex justify-between flex-wrap gap-2">
                {mode === "all" && (
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
                )}

                {/* Attach button in "all" mode */}
                {mode === "all" && showAttachButton && conversationId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      addKnowledgeToConversation({
                        conversationId,
                        knowledgeSourceId: source.id,
                      });
                    }}
                    disabled={isAttaching}
                  >
                    <Link className="mr-2 h-4 w-4" />
                    Attach
                  </Button>
                )}

                {/* Detach button in "conversation" mode */}
                {mode === "conversation" && conversationId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeKnowledgeFromConversation({
                        conversationId,
                        knowledgeSourceId: source.id,
                      });
                    }}
                    disabled={isDetaching}
                  >
                    <Unlink className="mr-2 h-4 w-4" />
                    Detach
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
