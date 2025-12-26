import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Info, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  title: string;
  message: string;
  type?: 'info' | 'warning' | 'danger' | 'question';
  confirmLabel?: string;
  cancelLabel?: string;
  confirmAction?: string;
  cancelAction?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const typeConfig = {
  info: {
    icon: Info,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    buttonVariant: 'default' as const,
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    buttonVariant: 'default' as const,
  },
  danger: {
    icon: AlertTriangle,
    color: 'text-red-500',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    buttonVariant: 'destructive' as const,
  },
  question: {
    icon: HelpCircle,
    color: 'text-violet-500',
    bgColor: 'bg-violet-50 dark:bg-violet-950/30',
    buttonVariant: 'default' as const,
  },
};

export function ConfirmDialog({
  title,
  message,
  type = 'question',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmAction = 'confirm',
  cancelAction = 'cancel',
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const [responded, setResponded] = useState(false);
  const [response, setResponse] = useState<'confirm' | 'cancel' | null>(null);
  
  const config = typeConfig[type];
  const Icon = config.icon;
  
  const handleConfirm = () => {
    setResponded(true);
    setResponse('confirm');
    onConfirm?.();
    window.dispatchEvent(new CustomEvent('generative-ui-action', { 
      detail: { action: confirmAction } 
    }));
  };
  
  const handleCancel = () => {
    setResponded(true);
    setResponse('cancel');
    onCancel?.();
    window.dispatchEvent(new CustomEvent('generative-ui-action', { 
      detail: { action: cancelAction } 
    }));
  };
  
  if (responded) {
    return (
      <Card className="border-muted">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <span>
              {response === 'confirm' ? `You selected: ${confirmLabel}` : `You selected: ${cancelLabel}`}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className={cn("border-2", config.bgColor)}>
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className={cn("p-2 rounded-full", config.bgColor)}>
            <Icon className={cn("h-6 w-6", config.color)} />
          </div>
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription className="mt-1.5 text-foreground/80">
              {message}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardFooter className="flex gap-2 justify-end">
        <Button variant="outline" onClick={handleCancel}>
          {cancelLabel}
        </Button>
        <Button variant={config.buttonVariant} onClick={handleConfirm}>
          {confirmLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}

