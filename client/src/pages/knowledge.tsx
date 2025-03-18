import { useState } from "react";
import { useKnowledge, KnowledgeSource } from "@/hooks/use-knowledge";
import { KnowledgeSourceUpload } from "@/components/knowledge/knowledge-source-upload";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash, FileText, Globe, PlusCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function KnowledgePage() {
  const { knowledgeSources, deleteKnowledgeSource, isDeleting } =
    useKnowledge();

  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  if (knowledgeSources.isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="w-full">
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3 mt-2" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-9 w-20" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (knowledgeSources.isError) {
    return (
      <div className="container mx-auto py-6">
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
      </div>
    );
  }

  const sources = knowledgeSources.data || [];

  return (
    <div className="container mx-auto py-6 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Knowledge Sources</h1>
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Knowledge Source
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Add Knowledge Source</DialogTitle>
            </DialogHeader>
            <KnowledgeSourceUpload
              onSuccess={() => setIsUploadDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
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
            <p className="text-sm text-muted-foreground mb-4">
              Knowledge sources allow you to reference external information in
              your AI conversations. You can upload files (PDF, TXT, etc.),
              paste text, or add a URL.
            </p>
          </CardContent>
          <CardFooter>
            <Button onClick={() => setIsUploadDialogOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Knowledge Source
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sources.map((source) => (
            <Card key={source.id} className="w-full">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center">
                      {source.type === "file" && (
                        <FileText className="mr-2 h-4 w-4" />
                      )}
                      {source.type === "url" && (
                        <Globe className="mr-2 h-4 w-4" />
                      )}
                      {source.type === "text" && (
                        <FileText className="mr-2 h-4 w-4" />
                      )}
                      {source.name}
                    </CardTitle>
                    <CardDescription>
                      Added{" "}
                      {formatDistanceToNow(new Date(source.created_at), {
                        addSuffix: true,
                      })}
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
              <CardContent>
                {source.description && (
                  <p className="text-sm text-muted-foreground">
                    {source.description}
                  </p>
                )}
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteKnowledgeSource(source.id)}
                  disabled={isDeleting}
                >
                  <Trash className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
