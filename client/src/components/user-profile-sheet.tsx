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
import { Save, Palette, Download } from "lucide-react";
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
  const [isExporting, setIsExporting] = useState(false);

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

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/conversations/export", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Export failed");

      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: "Export complete",
        description: `Exported ${data.length} conversation${data.length === 1 ? "" : "s"}.`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: "Failed to export chat history. Please try again.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full sm:max-w-sm overflow-y-auto px-4 sm:px-5">
        <SheetHeader className="pb-1">
          <SheetTitle className="text-base">Settings</SheetTitle>
          <SheetDescription className="text-xs">
            {user?.email}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-4">
          {/* Primary Color Selection */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-sm font-medium">Theme Color</Label>
            </div>
            <div className="grid grid-cols-8 gap-1.5">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => handleColorSelect(color.value)}
                  className={`aspect-square rounded-md transition-all duration-150 ${
                    selectedColor === color.value
                      ? "ring-2 ring-offset-1 ring-offset-background ring-foreground scale-110"
                      : "hover:scale-110 opacity-70 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          {/* Custom Prompt */}
          <div className="space-y-2">
            <Label htmlFor="custom-prompt" className="text-sm font-medium">
              System Prompt
            </Label>
            <Textarea
              id="custom-prompt"
              placeholder="Personal preferences included in every conversation..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="min-h-[100px] resize-none text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              {customPrompt.length} chars
            </p>
          </div>

          {/* Actions */}
          <div className="pt-3 border-t flex items-center gap-2">
            <Button
              onClick={handleSave}
              disabled={savePreferences.isPending}
              size="sm"
              className="gap-1.5 flex-1"
            >
              <Save className="h-3.5 w-3.5" />
              {savePreferences.isPending ? "Saving..." : "Save"}
            </Button>
            <Button
              onClick={handleExport}
              disabled={isExporting}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              {isExporting ? "..." : "Export"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
