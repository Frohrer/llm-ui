import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  AlertCircle, 
  CheckCircle2, 
  Info, 
  AlertTriangle,
  XCircle,
  LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AlertCardProps {
  title?: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  dismissible?: boolean;
  onDismiss?: () => void;
}

const alertConfig: Record<string, { 
  icon: LucideIcon; 
  className: string;
}> = {
  info: {
    icon: Info,
    className: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-100 [&>svg]:text-blue-600',
  },
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100 [&>svg]:text-emerald-600',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 [&>svg]:text-amber-600',
  },
  error: {
    icon: AlertCircle,
    className: 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100 [&>svg]:text-red-600',
  },
};

export function AlertCard({
  title,
  message,
  type = 'info',
  dismissible = false,
  onDismiss
}: AlertCardProps) {
  const config = alertConfig[type];
  const Icon = config.icon;
  
  return (
    <Alert className={cn("relative", config.className)}>
      <Icon className="h-4 w-4" />
      {title && <AlertTitle className="font-semibold">{title}</AlertTitle>}
      <AlertDescription className={title ? '' : 'ml-7'}>
        {message}
      </AlertDescription>
      {dismissible && onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        >
          <XCircle className="h-4 w-4" />
        </button>
      )}
    </Alert>
  );
}

