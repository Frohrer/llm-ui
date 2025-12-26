import { Card, CardContent } from "@/components/ui/card";
import { Quote } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuoteCardProps {
  quote: string;
  author?: string;
  source?: string;
  variant?: 'default' | 'elegant' | 'minimal';
}

export function QuoteCard({
  quote,
  author,
  source,
  variant = 'default'
}: QuoteCardProps) {
  if (variant === 'minimal') {
    return (
      <blockquote className="border-l-4 border-primary pl-4 py-2 italic text-muted-foreground">
        <p className="text-lg">{quote}</p>
        {(author || source) && (
          <footer className="mt-2 text-sm not-italic">
            {author && <span className="font-medium text-foreground">{author}</span>}
            {author && source && <span className="mx-1">—</span>}
            {source && <cite className="text-muted-foreground">{source}</cite>}
          </footer>
        )}
      </blockquote>
    );
  }
  
  if (variant === 'elegant') {
    return (
      <Card className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30 border-violet-200 dark:border-violet-800">
        <CardContent className="pt-6">
          <div className="relative">
            <Quote className="absolute -top-2 -left-2 h-8 w-8 text-violet-300 dark:text-violet-700 rotate-180" />
            <blockquote className="pl-8 pr-4">
              <p className="text-lg italic text-foreground leading-relaxed">
                {quote}
              </p>
            </blockquote>
            <Quote className="absolute -bottom-2 -right-2 h-8 w-8 text-violet-300 dark:text-violet-700" />
          </div>
          {(author || source) && (
            <footer className="mt-4 pl-8 text-sm">
              {author && <span className="font-semibold text-violet-700 dark:text-violet-300">{author}</span>}
              {author && source && <span className="text-muted-foreground mx-2">·</span>}
              {source && <cite className="text-muted-foreground not-italic">{source}</cite>}
            </footer>
          )}
        </CardContent>
      </Card>
    );
  }
  
  // Default variant
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex gap-4">
          <Quote className="h-8 w-8 text-primary/30 flex-shrink-0 mt-1" />
          <div>
            <blockquote>
              <p className="text-lg leading-relaxed">{quote}</p>
            </blockquote>
            {(author || source) && (
              <footer className="mt-3 text-sm text-muted-foreground">
                {author && <span className="font-medium text-foreground">{author}</span>}
                {author && source && <span className="mx-1">—</span>}
                {source && <cite>{source}</cite>}
              </footer>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

