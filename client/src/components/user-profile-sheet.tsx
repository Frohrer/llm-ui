import { useState, useEffect } from "react";
import { useUser } from "@/hooks/use-user";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Save, Palette } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface UserProfileSheetProps {
  trigger: React.ReactNode;
}

interface UserPreferences {
  primaryColor: string;
  customPrompt: string;
}

const PRESET_COLORS = [
  // Row 1 - Blues & Purples
  { name: "Purple", value: "hsl(250 100% 60%)" },
  { name: "Indigo", value: "hsl(239 84% 67%)" },
  { name: "Blue", value: "hsl(217 91% 60%)" },
  { name: "Sky", value: "hsl(199 89% 48%)" },
  // Row 2 - Cyans & Greens
  { name: "Cyan", value: "hsl(189 94% 43%)" },
  { name: "Teal", value: "hsl(168 76% 42%)" },
  { name: "Green", value: "hsl(142 71% 45%)" },
  { name: "Emerald", value: "hsl(160 84% 39%)" },
  // Row 3 - Yellows & Oranges
  { name: "Lime", value: "hsl(84 81% 44%)" },
  { name: "Yellow", value: "hsl(48 96% 53%)" },
  { name: "Amber", value: "hsl(38 92% 50%)" },
  { name: "Orange", value: "hsl(25 95% 53%)" },
  // Row 4 - Reds & Pinks
  { name: "Red", value: "hsl(0 84% 60%)" },
  { name: "Rose", value: "hsl(350 89% 60%)" },
  { name: "Pink", value: "hsl(330 81% 60%)" },
  { name: "Fuchsia", value: "hsl(292 84% 61%)" },
];

export function UserProfileSheet({ trigger }: UserProfileSheetProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState("hsl(250 100% 60%)");
  const [customPrompt, setCustomPrompt] = useState("");

  // Fetch user preferences
  const { data: preferences } = useQuery<UserPreferences>({
    queryKey: ["/api/user/preferences"],
    queryFn: async () => {
      const response = await fetch("/api/user/preferences", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch preferences");
      }
      return response.json();
    },
  });

  // Load preferences into state when fetched
  useEffect(() => {
    if (preferences) {
      setSelectedColor(preferences.primaryColor || "hsl(250 100% 60%)");
      setCustomPrompt(preferences.customPrompt || "");
    }
  }, [preferences]);

  // Save preferences mutation
  const savePreferences = useMutation({
    mutationFn: async (data: UserPreferences) => {
      const response = await fetch("/api/user/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error("Failed to save preferences");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/preferences"] });
      toast({
        title: "Settings saved",
        description: "Your preferences have been updated successfully.",
      });

      // Apply color immediately
      applyPrimaryColor(selectedColor);

      setOpen(false);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save preferences. Please try again.",
      });
    },
  });

  const applyPrimaryColor = (color: string) => {
    // Extract HSL values from the color string
    const hslMatch = color.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
    if (hslMatch) {
      const [, h, s, l] = hslMatch;
      document.documentElement.style.setProperty("--primary", `${h} ${s}% ${l}%`);
    }
  };

  const handleSave = () => {
    savePreferences.mutate({
      primaryColor: selectedColor,
      customPrompt: customPrompt,
    });
  };

  const handleColorSelect = (color: string) => {
    setSelectedColor(color);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Profile Settings</SheetTitle>
          <SheetDescription>
            Customize your experience with theme colors and personal information
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* User Info */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Account</Label>
            <div className="p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-primary-foreground shadow-md shadow-primary/20 font-semibold text-lg">
                  {user?.email?.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{user?.email}</span>
                  <span className="text-xs text-muted-foreground">Signed in</span>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Color Selection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              <Label className="text-sm font-medium">Primary Color</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose a color theme for your interface
            </p>
            <div className="grid grid-cols-4 gap-3">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => handleColorSelect(color.value)}
                  className={`relative aspect-square rounded-lg transition-all duration-200 hover:scale-105 ${
                    selectedColor === color.value
                      ? "ring-2 ring-offset-2 ring-primary shadow-lg"
                      : "hover:shadow-md"
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                >
                  {selectedColor === color.value && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-black"></div>
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Prompt */}
          <div className="space-y-3">
            <Label htmlFor="custom-prompt" className="text-sm font-medium">
              Custom System Prompt
            </Label>
            <p className="text-xs text-muted-foreground">
              Add personal information or preferences that will be included in every conversation
            </p>
            <Textarea
              id="custom-prompt"
              placeholder="Example: I prefer concise answers. I'm a software developer working with React and TypeScript..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="min-h-[120px] resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {customPrompt.length} characters
            </p>
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t">
            <Button
              onClick={handleSave}
              disabled={savePreferences.isPending}
              className="w-full gap-2"
            >
              <Save className="h-4 w-4" />
              {savePreferences.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
