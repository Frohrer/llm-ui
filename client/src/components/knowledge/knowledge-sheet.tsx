import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { BookOpen, PlusCircle } from "lucide-react";
import { KnowledgeSourceList } from "./knowledge-source-list";
import { KnowledgeSourceUpload } from "./knowledge-source-upload";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";

interface KnowledgeSheetProps {
  trigger?: React.ReactNode;
}

export function KnowledgeSheet({ trigger }: KnowledgeSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const isMobile = useIsMobile();

  const defaultTrigger = (
    <Button variant="ghost" className="flex items-center py-2 px-3 rounded-md text-sm font-medium w-full justify-start hover:bg-accent/50">
      <BookOpen className="mr-2 h-4 w-4" />
      Add Knowledge Source
    </Button>
  );

  const uploadDialog = (
    <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
      <DialogTrigger asChild>
        <Button size={isMobile ? "sm" : "default"}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Knowledge Source
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Knowledge Source</DialogTitle>
        </DialogHeader>
        <KnowledgeSourceUpload
          onSuccess={() => setIsUploadDialogOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );

  const content = (
    <>
      <div className="p-4 md:p-6 border-b">
        {isMobile ? (
          <DrawerHeader className="p-0">
            <DrawerTitle className="text-xl">Knowledge Sources</DrawerTitle>
          </DrawerHeader>
        ) : (
          <SheetHeader>
            <SheetTitle className="text-2xl">Knowledge Sources</SheetTitle>
          </SheetHeader>
        )}

        <div className="mt-4 md:mt-6 flex justify-end">
          {uploadDialog}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <KnowledgeSourceList
          mode="all"
          gridLayout={!isMobile}
          showAddButton={false}
        />
      </div>
    </>
  );

  // Mobile: use Drawer (bottom sheet) for better UX
  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerTrigger asChild>
          {trigger || defaultTrigger}
        </DrawerTrigger>
        <DrawerContent className="max-h-[90vh] flex flex-col">
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: use Sheet (slide from right)
  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        {trigger || defaultTrigger}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-4xl xl:max-w-5xl p-0 flex flex-col">
        {content}
      </SheetContent>
    </Sheet>
  );
}