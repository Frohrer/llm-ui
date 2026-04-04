import { Link, useLocation } from "wouter";
import { useUser } from "@/hooks/use-user";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "./theme-toggle";
import { MessageCircle, Plus, BarChart3, Wrench, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useRef, useState } from "react";
import { ConversationList } from "./conversation-list";
import { Conversation } from "@/lib/llm/types";
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
  const [hideNsfw, setHideNsfw] = useState(() => {
    const stored = localStorage.getItem("nsfw-visibility");
    return stored !== "show";
  });

  // Close sidebar on navigation change (not on mount)
  const prevLocationRef = useRef(location);
  useEffect(() => {
    if (prevLocationRef.current !== location && isMobile && onClose) {
      onClose();
    }
    prevLocationRef.current = location;
  }, [location, isMobile, onClose]);

  const isActive = (path: string) => {
    return location === path;
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 md:px-4 py-4 md:py-5 flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <MessageCircle className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="text-lg md:text-xl font-semibold truncate">
              AI Chat
            </h1>
          </div>
        </div>
      </div>
      <Separator />

      <div className="py-3 px-3 md:px-4 flex">
        <Button
          className="w-full gap-2 text-sm h-10"
          size="sm"
          onClick={() => onSelectConversation(undefined)}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="mt-2 space-y-6">
          <div className="space-y-1">
            <div className="px-2">
              <Link href="/">
                <a
                  className={`flex items-center py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    isActive("/")
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 active:bg-accent/70 hover:text-foreground"
                  }`}
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Conversations
                </a>
              </Link>
              {user?.is_admin && (
              <Link href="/stats">
                <a
                  className={`mt-0.5 flex items-center py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    isActive("/stats")
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 active:bg-accent/70 hover:text-foreground"
                  }`}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Admin & Stats
                </a>
              </Link>
              )}
              <Link href="/custom-tools">
                <a
                  className={`mt-0.5 flex items-center py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    isActive("/custom-tools")
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 active:bg-accent/70 hover:text-foreground"
                  }`}
                >
                  <Wrench className="mr-2 h-4 w-4" />
                  Custom Tools
                </a>
              </Link>
              <Link href="/voice-chat">
                <a
                  className={`mt-0.5 flex items-center py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    isActive("/voice-chat")
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 active:bg-accent/70 hover:text-foreground"
                  }`}
                >
                  <Mic className="mr-2 h-4 w-4" />
                  Voice Chat
                  <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
                    Beta
                  </Badge>
                </a>
              </Link>
            </div>
          </div>

          {/* Chat history is in its own sheet, not here */}
        </div>
      </ScrollArea>

      <div className="p-3 sm:p-4 mt-auto border-t border-border">
        <UserProfileSheet
          trigger={
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 active:bg-accent/70 transition-colors cursor-pointer">
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-medium shrink-0">
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
