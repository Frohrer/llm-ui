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
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { KnowledgeSourceUpload } from "@/components/knowledge/knowledge-source-upload";
import { KnowledgeSourceEdit } from "@/components/knowledge/knowledge-source-edit";
import { Skeleton } from "@/components/ui/skeleton";
import { KnowledgeSheet } from "./knowledge-sheet";

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
  const [editingSource, setEditingSource] = useState<KnowledgeSource | null>(null);
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
            <KnowledgeSheet />
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
                </div>

                <CardDescription className="mt-2">
                  {source.description ||
                    (mode === "all"
                      ? `Added ${formatDistanceToNow(new Date(source.created_at), { addSuffix: true })}`
                      : `${source.source_type || "file"} knowledge source`)}
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex justify-between flex-wrap gap-2">
                <div className="flex gap-2">
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
                </div>

                {/* Universal Attach/Detach button for all modes */}
                {showAttachButton && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode === "conversation" && conversationId) {
                        // Detach in conversation mode
                        removeKnowledgeFromConversation({
                          conversationId,
                          knowledgeSourceId: source.id,
                        });
                      } else if (conversationId) {
                        // Attach in all mode with existing conversation
                        addKnowledgeToConversation({
                          conversationId,
                          knowledgeSourceId: source.id,
                        });
                      } else if (onSelectKnowledgeSource) {
                        // Select for new conversation
                        onSelectKnowledgeSource(source);
                      }
                    }}
                    disabled={
                      mode === "conversation" ? isDetaching : isAttaching
                    }
                  >
                    {mode === "conversation" ? (
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
