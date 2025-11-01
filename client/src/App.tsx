import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { useUser } from "@/hooks/use-user";
import { Loader2 } from "lucide-react";
import Home from "@/pages/home";
import StatsPage from "@/pages/stats";
import CustomToolsPage from "@/pages/custom-tools";
import VoiceChat from "@/pages/voice-chat";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth";

function Router() {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/stats" component={StatsPage} />
      <Route path="/custom-tools" component={CustomToolsPage} />
      <Route path="/voice-chat" component={VoiceChat} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="chat-ui-theme">
      <QueryClientProvider client={queryClient}>
        <Router />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;