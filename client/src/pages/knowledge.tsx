import { useState } from "react";
import { KnowledgeSourceList } from "@/components/knowledge/knowledge-source-list";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { KnowledgeSourceUpload } from "@/components/knowledge/knowledge-source-upload";

export default function KnowledgePage() {
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

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

      <KnowledgeSourceList 
        mode="all" 
        gridLayout={true} 
        showAddButton={false} 
      />
    </div>
  );
}
