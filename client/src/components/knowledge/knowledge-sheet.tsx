import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { BookOpen, PlusCircle } from "lucide-react";
import { KnowledgeSourceList } from "./knowledge-source-list";
import { KnowledgeSourceUpload } from "./knowledge-source-upload";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface KnowledgeSheetProps {
  trigger?: React.ReactNode;
}

export function KnowledgeSheet({ trigger }: KnowledgeSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const defaultTrigger = (
    <Button variant="ghost" className="flex items-center py-2 px-3 rounded-md text-sm font-medium w-full justify-start hover:bg-accent/50">
      <BookOpen className="mr-2 h-4 w-4" />
      Add Knowledge Source
    </Button>
  );

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        {trigger || defaultTrigger}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-4xl xl:max-w-5xl overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="text-2xl">Knowledge Sources</SheetTitle>
        </SheetHeader>
        
        <div className="mb-6 flex justify-end">
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
      </SheetContent>
    </Sheet>
  );
}