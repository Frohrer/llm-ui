import { Link, useLocation } from "wouter";
import { useUser } from "@/hooks/use-user";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "./theme-toggle";
import { MessageCircle, BookOpen, Plus, BarChart3, Wrench, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect } from "react";
import { ConversationList } from "./conversation-list";
import { Conversation } from "@/lib/llm/types";
import { KnowledgeSheet } from "@/components/knowledge";
import { UserProfileSheet } from "@/components/user-profile-sheet";

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
    <div className="flex flex-col h-full bg-background/95 backdrop-blur-xl border-r border-border/50 shadow-lg">
      <div className="px-3 md:px-4 py-4 md:py-5 flex items-center justify-between bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="flex items-center min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/20">
              <MessageCircle className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="text-lg md:text-xl font-bold truncate bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              AI Chat{process.env.NEXT_PUBLIC_CUSTOMER_NAME ? ` - ${process.env.NEXT_PUBLIC_CUSTOMER_NAME}` : ''}
            </h1>
          </div>
        </div>
      </div>
      <Separator className="bg-border/50" />

      <div className="py-3 px-3 md:px-4 flex">
        <Button
          className="w-full gap-2 text-sm h-11 z-10 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-md hover:shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all duration-200"
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
                  className={`flex items-center py-2.5 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive("/")
                      ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary border border-primary/20 shadow-sm"
                      : "hover:bg-accent/50 hover:translate-x-0.5"
                  }`}
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Conversations
                </a>
              </Link>
              <Link href="/stats">
                <a
                  className={`mt-1.5 flex items-center py-2.5 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive("/stats")
                      ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary border border-primary/20 shadow-sm"
                      : "hover:bg-accent/50 hover:translate-x-0.5"
                  }`}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Statistics
                </a>
              </Link>
              <Link href="/custom-tools">
                <a
                  className={`mt-1.5 flex items-center py-2.5 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive("/custom-tools")
                      ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary border border-primary/20 shadow-sm"
                      : "hover:bg-accent/50 hover:translate-x-0.5"
                  }`}
                >
                  <Wrench className="mr-2 h-4 w-4" />
                  Custom Tools
                </a>
              </Link>
              <Link href="/voice-chat">
                <a
                  className={`mt-1.5 flex items-center py-2.5 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive("/voice-chat")
                      ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary border border-primary/20 shadow-sm"
                      : "hover:bg-accent/50 hover:translate-x-0.5"
                  }`}
                >
                  <Mic className="mr-2 h-4 w-4" />
                  Voice Chat
                  <Badge variant="secondary" className="ml-2 text-xs bg-primary/10 text-primary border-primary/20">
                    Beta
                  </Badge>
                </a>
              </Link>
              <KnowledgeSheet
                trigger={
                  <Button
                    variant="ghost"
                    className="mt-1.5 w-full justify-start flex items-center py-2.5 px-3 rounded-lg text-sm font-medium hover:bg-accent/50 hover:translate-x-0.5 transition-all duration-200"
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

      <div className="p-4 mt-auto border-t border-border/50 bg-gradient-to-br from-background/80 to-background backdrop-blur-sm">
        <UserProfileSheet
          trigger={
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition-all duration-200 cursor-pointer">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-primary-foreground shadow-md shadow-primary/20 font-semibold">
                {user?.email?.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium truncate">
                  {user?.email}
                </span>
                <span className="text-xs text-muted-foreground">View profile</span>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
