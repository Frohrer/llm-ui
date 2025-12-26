import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimelineItem {
  title: string;
  description?: string;
  date?: string;
  status?: 'completed' | 'current' | 'upcoming' | 'error';
  badge?: string;
}

interface TimelineCardProps {
  title?: string;
  description?: string;
  items: TimelineItem[];
  orientation?: 'vertical' | 'horizontal';
}

const statusConfig = {
  completed: {
    icon: CheckCircle2,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500',
    lineColor: 'bg-emerald-500',
  },
  current: {
    icon: Clock,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500',
    lineColor: 'bg-blue-200 dark:bg-blue-800',
  },
  upcoming: {
    icon: Circle,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    lineColor: 'bg-muted',
  },
  error: {
    icon: AlertCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500',
    lineColor: 'bg-red-200 dark:bg-red-800',
  },
};

export function TimelineCard({
  title,
  description,
  items,
  orientation = 'vertical'
}: TimelineCardProps) {
  if (orientation === 'horizontal') {
    return (
      <Card>
        {(title || description) && (
          <CardHeader className="pb-2">
            {title && <CardTitle className="text-lg">{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
        )}
        <CardContent className={title ? '' : 'pt-6'}>
          <div className="flex items-start overflow-x-auto pb-4">
            {items.map((item, index) => {
              const status = item.status || 'upcoming';
              const config = statusConfig[status];
              const Icon = config.icon;
              const isLast = index === items.length - 1;
              
              return (
                <div key={index} className="flex flex-col items-center min-w-[120px] flex-shrink-0">
                  <div className="flex items-center w-full">
                    <div className={cn("flex-1 h-0.5", index === 0 ? 'bg-transparent' : config.lineColor)} />
                    <div className={cn("flex items-center justify-center w-8 h-8 rounded-full", config.bgColor)}>
                      <Icon className={cn("h-4 w-4", status === 'upcoming' ? 'text-muted-foreground' : 'text-white')} />
                    </div>
                    <div className={cn("flex-1 h-0.5", isLast ? 'bg-transparent' : statusConfig[items[index + 1]?.status || 'upcoming'].lineColor)} />
                  </div>
                  <div className="mt-2 text-center px-2">
                    <div className="font-medium text-sm">{item.title}</div>
                    {item.date && <div className="text-xs text-muted-foreground">{item.date}</div>}
                    {item.badge && (
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {item.badge}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }
  
  // Vertical orientation
  return (
    <Card>
      {(title || description) && (
        <CardHeader className="pb-2">
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={title ? '' : 'pt-6'}>
        <div className="space-y-0">
          {items.map((item, index) => {
            const status = item.status || 'upcoming';
            const config = statusConfig[status];
            const Icon = config.icon;
            const isLast = index === items.length - 1;
            
            return (
              <div key={index} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0",
                    config.bgColor
                  )}>
                    <Icon className={cn("h-4 w-4", status === 'upcoming' ? 'text-muted-foreground' : 'text-white')} />
                  </div>
                  {!isLast && (
                    <div className={cn("w-0.5 flex-1 min-h-[40px]", statusConfig[items[index + 1]?.status || 'upcoming'].lineColor)} />
                  )}
                </div>
                <div className={cn("pb-6", isLast && 'pb-0')}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.title}</span>
                    {item.badge && (
                      <Badge variant="secondary" className="text-xs">
                        {item.badge}
                      </Badge>
                    )}
                  </div>
                  {item.date && (
                    <div className="text-xs text-muted-foreground mt-0.5">{item.date}</div>
                  )}
                  {item.description && (
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

