import { Link, useLocation } from "wouter";
import { useUser } from "@/hooks/use-user";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "./theme-toggle";
import { MessageCircle, BookOpen, Plus, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { ConversationList } from "./conversation-list";
import { Conversation } from "@/lib/llm/types";
import { KnowledgeSheet } from "@/components/knowledge";

interface MainSidebarProps {
  activeConversation?: Conversation;
  onSelectConversation: (conversation: Conversation | undefined) => void;
  onNewConversation: () => void;
  isMobile?: boolean;
  onClose?: () => void;
}

export function MainSidebar({
  activeConversation,
  onSelectConversation,
  isMobile = false,
  onClose,
}: MainSidebarProps) {
  const { user } = useUser();
  const [location, setLocation] = useLocation();

  // Close sidebar on navigation if mobile
  useEffect(() => {
    if (isMobile && onClose) {
      onClose();
    }
  }, [location, isMobile, onClose]);

  const isActive = (path: string) => {
    return location === path;
  };

  return (
    <div className="flex flex-col h-full bg-background border-r">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center">
          <h1 className="text-xl font-bold">
            AI Chat{process.env.NEXT_PUBLIC_CUSTOMER_NAME ? ` - ${process.env.NEXT_PUBLIC_CUSTOMER_NAME}` : ''}
          </h1>
        </div>
      </div>
      <Separator />

      <div className="py-2 px-4 flex">
        <Button
          className="w-full gap-2 text-xs md:text-sm z-10"
          variant="outline"
          size="sm"
          onClick={() => onSelectConversation(undefined)}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="mt-2 space-y-6">
          <div className="space-y-2">
            <div className="px-2">
              <Link href="/">
                <a
                  className={`flex items-center py-2 px-3 rounded-md text-sm font-medium ${
                    isActive("/") ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Conversations
                </a>
              </Link>
              <Link href="/stats">
                <a
                  className={`mt-1 flex items-center py-2 px-3 rounded-md text-sm font-medium ${
                    isActive("/stats") ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Statistics
                </a>
              </Link>
              <KnowledgeSheet 
                trigger={
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start flex items-center py-2 px-3 rounded-md text-sm font-medium hover:bg-accent/50"
                  >
                    <BookOpen className="mr-2 h-4 w-4" />
                    Knowledge
                  </Button>
                } 
              />
            </div>
          </div>

          {location === "/" && (
            <>
              <Separator />
              <div className="px-0">
                <h3 className="text-md font-medium mb-2 px-2 pl-5">
                  Chat History
                </h3>
                <ConversationList
                  activeConversation={activeConversation}
                  onSelectConversation={onSelectConversation}
                />
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 mt-auto border-t">
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary mr-2">
            {user?.email?.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium truncate max-w-[230px]">
              {user?.email}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
