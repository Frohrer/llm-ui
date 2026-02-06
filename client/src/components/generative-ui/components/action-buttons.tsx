import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionButton {
  label: string;
  action: string;
  icon?: string;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  disabled?: boolean;
}

interface ActionButtonsProps {
  title?: string;
  description?: string;
  buttons: ActionButton[];
  layout?: 'horizontal' | 'vertical' | 'grid';
  onAction?: (action: string) => void;
}

export function ActionButtons({
  title,
  description,
  buttons,
  layout = 'horizontal',
  onAction
}: ActionButtonsProps) {
  const handleClick = (action: string) => {
    onAction?.(action);
    // Dispatch custom event for parent components to handle
    window.dispatchEvent(new CustomEvent('generative-ui-action', { 
      detail: { action } 
    }));
  };
  
  const layoutClasses = {
    horizontal: 'flex flex-wrap gap-2',
    vertical: 'flex flex-col gap-2',
    grid: 'grid grid-cols-2 gap-2',
  };
  
  const content = (
    <div className={layoutClasses[layout]}>
      {buttons.map((button, index) => {
        const IconComponent = button.icon ? (Icons as any)[button.icon] : null;
        
        return (
          <Button
            key={index}
            variant={button.variant || 'default'}
            disabled={button.disabled}
            onClick={() => handleClick(button.action)}
            className={cn(layout === 'vertical' && 'justify-start')}
          >
            {IconComponent && <IconComponent className="h-4 w-4 mr-2" />}
            {button.label}
          </Button>
        );
      })}
    </div>
  );
  
  if (!title && !description) {
    return content;
  }
  
  return (
    <Card>
      <CardHeader className="pb-3">
        {title && <CardTitle className="text-lg">{title}</CardTitle>}
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  );
}

