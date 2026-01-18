import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

interface UserPreferences {
  primaryColor: string;
  customPrompt: string;
}

export function useUserPreferences() {
  const { data: preferences, isLoading } = useQuery<UserPreferences>({
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

  // Apply primary color when preferences load
  useEffect(() => {
    if (preferences?.primaryColor) {
      applyPrimaryColor(preferences.primaryColor);
    }
  }, [preferences?.primaryColor]);

  return {
    preferences,
    isLoading,
  };
}

function applyPrimaryColor(color: string) {
  // Extract HSL values from the color string
  const hslMatch = color.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
  if (hslMatch) {
    const [, h, s, l] = hslMatch;
    document.documentElement.style.setProperty("--primary", `${h} ${s}% ${l}%`);
  }
}
