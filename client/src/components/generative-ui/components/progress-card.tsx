import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface ProgressItem {
  label: string;
  value: number;
  max?: number;
  color?: 'default' | 'success' | 'warning' | 'error';
}

interface ProgressCardProps {
  title?: string;
  description?: string;
  items: ProgressItem[];
  showPercentage?: boolean;
  showValue?: boolean;
  layout?: 'vertical' | 'horizontal';
}

const colorClasses = {
  default: '',
  success: '[&>div]:bg-emerald-500',
  warning: '[&>div]:bg-amber-500',
  error: '[&>div]:bg-red-500',
};

export function ProgressCard({
  title,
  description,
  items,
  showPercentage = true,
  showValue = false,
  layout = 'vertical'
}: ProgressCardProps) {
  return (
    <Card>
      {(title || description) && (
        <CardHeader className="pb-2">
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={layout === 'horizontal' ? 'grid grid-cols-2 gap-4' : 'space-y-4'}>
        {items.map((item, index) => {
          const max = item.max || 100;
          const percentage = Math.min((item.value / max) * 100, 100);
          
          return (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{item.label}</span>
                <span className="text-muted-foreground">
                  {showValue && `${item.value}/${max}`}
                  {showValue && showPercentage && ' · '}
                  {showPercentage && `${Math.round(percentage)}%`}
                </span>
              </div>
              <Progress 
                value={percentage} 
                className={cn("h-2", item.color && colorClasses[item.color])}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

