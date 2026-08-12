import { useState } from "react";
import { useLocation } from "wouter";
import { useKnowledge, type KnowledgeSource } from "@/hooks/use-knowledge";
import { useUser } from "@/hooks/use-user";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusCircle,
  ArrowLeft,
  FileText,
  Globe,
  Trash2,
  Edit,
  Share2,
  Search,
  X,
  Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { KnowledgeSourceUpload } from "@/components/knowledge/knowledge-source-upload";
import { KnowledgeSourceEdit } from "@/components/knowledge/knowledge-source-edit";

export default function KnowledgePage() {
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<KnowledgeSource | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const {
    knowledgeSources,
    deleteKnowledgeSource,
    isDeleting,
    toggleKnowledgeSourceSharing,
    isTogglingSharing,
  } = useKnowledge();

  const sources = knowledgeSources.data || [];
  const filteredSources = sources.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const typeIcon = (type: string | undefined) => {
    if (type === "url") return <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  };

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold">Knowledge Sources</h1>
          <Badge variant="secondary" className="text-xs">
            {sources.length}
          </Badge>
        </div>
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <Button size="sm" onClick={() => setIsUploadDialogOpen(true)}>
            <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
            Add
          </Button>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Knowledge Source</DialogTitle>
            </DialogHeader>
            <KnowledgeSourceUpload
              onSuccess={() => setIsUploadDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {sources.length > 3 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter sources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
              onClick={() => setSearchQuery("")}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {knowledgeSources.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-md border">
              <Skeleton className="h-4 w-4 shrink-0" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : sources.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No knowledge sources yet</p>
          <p className="text-xs mt-1">Upload files, paste text, or add URLs to give your AI context.</p>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {filteredSources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-3 px-3 py-2 hover:bg-accent/30 transition-colors group"
            >
              {typeIcon(source.source_type)}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{source.name}</span>
                  <Badge variant={source.use_rag ? "default" : "outline"} className="text-[10px] px-1.5 py-0 shrink-0">
                    {source.use_rag ? "RAG" : "Full"}
                  </Badge>
                  {source.is_shared && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      <Users className="h-2.5 w-2.5 mr-0.5" />
                      Shared
                    </Badge>
                  )}
                </div>
                {source.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {source.description}
                  </p>
                )}
              </div>

              <span className="text-[11px] text-muted-foreground/70 whitespace-nowrap shrink-0 hidden sm:block">
                {formatDistanceToNow(new Date(source.created_at), { addSuffix: true })}
              </span>

              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {user && source.user_id === user.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toggleKnowledgeSourceSharing(source.id)}
                    disabled={isTogglingSharing}
                    title={source.is_shared ? "Unshare" : "Share"}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                {source.source_type === "text" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setEditingSource(source)}
                    title="Edit"
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteKnowledgeSource(source.id)}
                  disabled={isDeleting}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {filteredSources.length === 0 && searchQuery && (
            <div className="text-center text-muted-foreground text-sm py-6">
              No results for "{searchQuery}"
            </div>
          )}
        </div>
      )}

      <Dialog open={editingSource !== null} onOpenChange={(open) => !open && setEditingSource(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Knowledge Source</DialogTitle>
          </DialogHeader>
          {editingSource && (
            <KnowledgeSourceEdit
              source={editingSource}
              onSuccess={() => setEditingSource(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
