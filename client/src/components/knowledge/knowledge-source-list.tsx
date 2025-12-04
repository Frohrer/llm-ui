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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Trash,
  FileText,
  Globe,
  PlusCircle,
  Unlink,
  Link,
  Check,
  Edit,
  Share2,
  Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { KnowledgeSourceEdit } from "@/components/knowledge/knowledge-source-edit";
import { Skeleton } from "@/components/ui/skeleton";
import { KnowledgeSheet } from "./knowledge-sheet";
import { KnowledgeSourceUpload } from "./knowledge-source-upload";
import { useUser } from "@/hooks/use-user";

export type KnowledgeSourceListMode = "all" | "conversation";

interface KnowledgeSourceListProps {
  /** Optional callback when a knowledge source is selected */
  onSelectKnowledgeSource?: (source: KnowledgeSource) => void;
  /** The current conversation ID, if viewing in conversation context */
  conversationId?: number;
  /** Show attach button, only used in mode="all" */
  showAttachButton?: boolean;
  /** IDs of sources that are currently selected (pending to be attached) */
  selectedSourceIds?: number[];
  /** IDs of sources already attached to the conversation */
  attachedSourceIds?: number[];
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
  attachedSourceIds = [],
  mode = "all",
  showAddButton = true,
  gridLayout = false,
}: KnowledgeSourceListProps) {
  const [editingSource, setEditingSource] = useState<KnowledgeSource | null>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const { user } = useUser();
  const {
    knowledgeSources,
    getConversationKnowledgeSources,
    deleteKnowledgeSource,
    isDeleting,
    addKnowledgeToConversation,
    isAttaching,
    removeKnowledgeFromConversation,
    isDetaching,
    toggleKnowledgeSourceSharing,
    isTogglingSharing,
  } = useKnowledge();

  const [searchQuery, setSearchQuery] = useState("");

  // Always call the hook with a clean dummy ID if not provided
  // This ensures the hook is always called, maintaining React's rules of hooks
  const dummyId = -1;
  const allKnowledgeSources = knowledgeSources;
  const conversationKnowledgeSources = getConversationKnowledgeSources(
    conversationId || dummyId,
  );

  // Then determine which data to use based on mode
  const dataQuery =
    mode === "conversation" && conversationId
      ? conversationKnowledgeSources
      : allKnowledgeSources;

  if (dataQuery.isLoading) {
    return (
      <div
        className={
          gridLayout ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-4"
        }
      >
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
          <p>{dataQuery.error?.message || "Unknown error occurred"}</p>
        </CardContent>
        <CardFooter>
          <Button onClick={() => dataQuery.refetch()} variant="outline">
            Retry
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const sources = dataQuery.data || [];
  const filteredSources = sources.filter(source => 
    source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    source.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {showAddButton && (
        <div className="flex justify-between items-center">
          <KnowledgeSheet />
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
            {mode === "conversation" ? (
              <KnowledgeSheet />
            ) : (
              <>
                <Button onClick={() => setIsUploadDialogOpen(true)}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Add Knowledge Source
                </Button>
                <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
                  <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                      <DialogTitle>Add Knowledge Source</DialogTitle>
                    </DialogHeader>
                    <KnowledgeSourceUpload
                      onSuccess={() => setIsUploadDialogOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div
          className={
            gridLayout ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-4"
          }
        >
          {sources.map((source) => (
            <Card
              key={source.id}
              className={`w-full hover:bg-accent/10 transition-colors ${onSelectKnowledgeSource ? "cursor-pointer" : ""} ${
                selectedSourceIds.includes(source.id)
                  ? "border-primary border-2"
                  : ""
              }`}
              onClick={() => onSelectKnowledgeSource?.(source)}
            >
              <CardHeader>
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

                <div className="flex gap-2 flex-wrap mt-2">
                  <Badge variant={source.use_rag ? "default" : "outline"}>
                    {source.use_rag ? "RAG" : "Full Text"}
                  </Badge>
                  <Badge variant="outline">
                    {source.source_type || "file"}
                  </Badge>
                  {source.is_shared && (
                    <Badge variant="secondary">
                      <Users className="h-3.5 w-3.5 mr-1" />
                      Shared
                    </Badge>
                  )}
                  {/* Show attached status for sources already in the conversation */}
                  {attachedSourceIds.includes(source.id) && (
                    <Badge variant="default" className="bg-blue-500">
                      <Link className="h-3.5 w-3.5 mr-1" />
                      Attached
                    </Badge>
                  )}
                  {/* Show selected status for sources pending to be added */}
                  {!attachedSourceIds.includes(source.id) && (
                    <Badge
                      variant={
                        selectedSourceIds.includes(source.id)
                          ? "default"
                          : "outline"
                      }
                      className={
                        selectedSourceIds.includes(source.id)
                          ? "bg-green-500"
                          : "text-gray-400"
                      }
                    >
                      {selectedSourceIds.includes(source.id) ? (
                        <Check className="h-3.5 w-3.5 mr-1" />
                      ) : (
                        <Check className="h-3.5 w-3.5 mr-1" />
                      )}
                      {selectedSourceIds.includes(source.id)
                        ? "Selected"
                        : "Select"}
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent>
                {source.description && (
                  <p className="text-sm text-muted-foreground mb-2">
                    {source.description}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Created {formatDistanceToNow(new Date(source.created_at))} ago
                </p>
              </CardContent>

              <CardFooter className="flex justify-between flex-wrap gap-2">
                <div className="flex gap-2 flex-wrap">
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

                  {mode === "all" && source.source_type === "text" && (
                    <Dialog open={editingSource?.id === source.id} onOpenChange={(open) => !open && setEditingSource(null)}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSource(source);
                          }}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[600px]">
                        <DialogHeader>
                          <DialogTitle>Edit Knowledge Source</DialogTitle>
                        </DialogHeader>
                        <KnowledgeSourceEdit
                          source={source}
                          onSuccess={() => setEditingSource(null)}
                        />
                      </DialogContent>
                    </Dialog>
                  )}

                  {/* Only show share button for sources owned by current user */}
                  {mode === "all" && user && source.user_id === user.id && (
                    <Button
                      variant={source.is_shared ? "default" : "outline"}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleKnowledgeSourceSharing(source.id);
                      }}
                      disabled={isTogglingSharing}
                    >
                      <Share2 className="mr-2 h-4 w-4" />
                      {source.is_shared ? "Unshare" : "Share"}
                    </Button>
                  )}
                </div>

                {/* Universal Attach/Detach button for all modes */}
                {showAttachButton && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      const isAttached = attachedSourceIds.includes(source.id);
                      
                      if (isAttached && conversationId) {
                        // Detach if already attached
                        removeKnowledgeFromConversation({
                          conversationId,
                          knowledgeSourceId: source.id,
                        });
                      } else if (conversationId) {
                        // Attach to existing conversation
                        addKnowledgeToConversation({
                          conversationId,
                          knowledgeSourceId: source.id,
                        });
                      } else if (onSelectKnowledgeSource) {
                        // Select for new conversation (toggle pending)
                        onSelectKnowledgeSource(source);
                      }
                    }}
                    disabled={
                      attachedSourceIds.includes(source.id) ? isDetaching : isAttaching
                    }
                  >
                    {attachedSourceIds.includes(source.id) ? (
                      <>
                        <Unlink className="mr-2 h-4 w-4" />
                        Detach
                      </>
                    ) : (
                      <>
                        <Link className="mr-2 h-4 w-4" />
                        {conversationId ? "Attach" : "Select"}
                      </>
                    )}
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
