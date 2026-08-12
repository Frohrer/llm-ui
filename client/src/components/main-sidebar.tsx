import { Link, useLocation } from "wouter";
import { useUser } from "@/hooks/use-user";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Plus, BarChart3, Wrench, Mic, Settings, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useRef, useState } from "react";
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

  const navLinkClass = (path: string) =>
    `flex items-center gap-2 py-1.5 px-2.5 rounded-md text-sm transition-colors ${
      isActive(path)
        ? "bg-accent text-accent-foreground font-medium"
        : "text-muted-foreground hover:bg-accent/50 active:bg-accent/70 hover:text-foreground"
    }`;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 py-3 pr-12 flex items-center gap-2">
        <Button
          className="flex-1 gap-2 text-sm h-9 justify-start"
          size="sm"
          onClick={() => onSelectConversation(undefined)}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <nav className="px-2 space-y-0.5">
        <Link href="/">
          <a className={navLinkClass("/")}>
            <MessageCircle className="h-4 w-4 shrink-0" />
            Conversations
          </a>
        </Link>
        {user?.is_admin && (
          <Link href="/stats">
            <a className={navLinkClass("/stats")}>
              <BarChart3 className="h-4 w-4 shrink-0" />
              Admin & Stats
            </a>
          </Link>
        )}
        {user?.is_admin && (
          <Link href="/pii">
            <a className={navLinkClass("/pii")}>
              <ShieldCheck className="h-4 w-4 shrink-0" />
              PII Redaction
            </a>
          </Link>
        )}
        <Link href="/custom-tools">
          <a className={navLinkClass("/custom-tools")}>
            <Wrench className="h-4 w-4 shrink-0" />
            Custom Tools
          </a>
        </Link>
        <Link href="/voice-chat">
          <a className={navLinkClass("/voice-chat")}>
            <Mic className="h-4 w-4 shrink-0" />
            Voice Chat
            <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
              Beta
            </Badge>
          </a>
        </Link>
      </nav>

      <ScrollArea className="flex-1 mt-2" />

      <div className="px-2 py-2 mt-auto border-t border-border">
        <UserProfileSheet
          trigger={
            <button className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md hover:bg-accent/50 active:bg-accent/70 transition-colors text-left">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-medium shrink-0">
                {user?.email?.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm truncate flex-1 min-w-0">
                {user?.email}
              </span>
              <Settings className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          }
        />
      </div>
    </div>
  );
}
