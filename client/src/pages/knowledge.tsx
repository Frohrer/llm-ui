import { useState } from "react";
import { useLocation } from "wouter";
import { KnowledgeSourceList } from "@/components/knowledge/knowledge-source-list";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlusCircle, ArrowLeft } from "lucide-react";
import { KnowledgeSourceUpload } from "@/components/knowledge/knowledge-source-upload";

export default function KnowledgePage() {
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [, setLocation] = useLocation();

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-3xl">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Knowledge Sources</h1>
        </div>
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <Button onClick={() => setIsUploadDialogOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Source
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

      <KnowledgeSourceList
        mode="all"
        gridLayout={false}
        showAddButton={false}
      />
    </div>
  );
}
