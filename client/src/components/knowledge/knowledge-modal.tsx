import { useState } from "react";
import { useLocation } from "wouter";
import { useKnowledge, type KnowledgeSource } from "@/hooks/use-knowledge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Globe, Pencil, Link, Unlink, PlusCircle, Loader2 } from "lucide-react";
import { KnowledgeSourceUpload } from "./knowledge-source-upload";
import { Skeleton } from "@/components/ui/skeleton";

interface KnowledgeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: number;
  pendingKnowledgeSources?: number[];
  onTogglePendingSource?: (sourceId: number) => void;
  attachedSourceIds?: number[];
}

export function KnowledgeModal({
  open,
  onOpenChange,
  conversationId,
  pendingKnowledgeSources = [],
  onTogglePendingSource,
  attachedSourceIds = [],
}: KnowledgeModalProps) {
  const [, setLocation] = useLocation();
  const [showUpload, setShowUpload] = useState(false);
  const {
    knowledgeSources,
    addKnowledgeToConversation,
    isAttaching,
    removeKnowledgeFromConversation,
    isDetaching,
  } = useKnowledge();

  const sources = knowledgeSources.data || [];

  const getIcon = (sourceType: string | null) => {
    if (sourceType === "url") return <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />;
    return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />;
  };

  const isAttached = (id: number) => attachedSourceIds.includes(id);
  const isPending = (id: number) => pendingKnowledgeSources.includes(id);

  const handleToggle = (source: KnowledgeSource) => {
    if (isAttached(source.id) && conversationId) {
      removeKnowledgeFromConversation({ conversationId, knowledgeSourceId: source.id });
    } else if (conversationId) {
      addKnowledgeToConversation({ conversationId, knowledgeSourceId: source.id });
    } else if (onTogglePendingSource) {
      onTogglePendingSource(source.id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-lg">Knowledge Sources</DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => {
                onOpenChange(false);
                setLocation("/knowledge");
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Knowledge
            </Button>
          </div>
        </DialogHeader>

        {showUpload ? (
          <div className="px-5 pb-5">
            <KnowledgeSourceUpload
              onSuccess={() => setShowUpload(false)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => setShowUpload(false)}
            >
              Back to list
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-5 pb-3">
                {knowledgeSources.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 py-3">
                        <Skeleton className="h-4 w-4 shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : sources.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No knowledge sources yet.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {sources.map((source) => {
                      const attached = isAttached(source.id);
                      const pending = isPending(source.id);
                      const active = attached || pending;

                      return (
                        <button
                          key={source.id}
                          className={`w-full flex items-center gap-3 py-3 px-1 text-left rounded-md transition-colors hover:bg-accent/50 ${
                            active ? "bg-accent/30" : ""
                          }`}
                          onClick={() => handleToggle(source)}
                          disabled={attached ? isDetaching : isAttaching}
                        >
                          {getIcon(source.source_type)}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{source.name}</p>
                            {source.description && (
                              <p className="text-xs text-muted-foreground truncate">{source.description}</p>
                            )}
                          </div>
                          <div className="shrink-0">
                            {active ? (
                              <Link className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <Unlink className="h-3.5 w-3.5 text-muted-foreground/40" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="px-5 py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={() => setShowUpload(true)}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Add New Source
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
