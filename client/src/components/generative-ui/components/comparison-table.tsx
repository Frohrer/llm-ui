import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComparisonItem {
  name: string;
  values: (boolean | string | number | null)[];
  highlight?: boolean;
}

interface ComparisonTableProps {
  title?: string;
  description?: string;
  columns: string[];
  items: ComparisonItem[];
  highlightColumn?: number;
}

function renderValue(value: boolean | string | number | null) {
  if (value === true) {
    return <Check className="h-5 w-5 text-emerald-500 mx-auto" />;
  }
  if (value === false) {
    return <X className="h-5 w-5 text-red-400 mx-auto" />;
  }
  if (value === null || value === undefined) {
    return <Minus className="h-4 w-4 text-muted-foreground mx-auto" />;
  }
  return <span>{value}</span>;
}

export function ComparisonTable({
  title,
  description,
  columns,
  items,
  highlightColumn
}: ComparisonTableProps) {
  return (
    <Card>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={title ? '' : 'pt-6'}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                  Feature
                </th>
                {columns.map((col, index) => (
                  <th 
                    key={index}
                    className={cn(
                      "text-center py-3 px-4 font-semibold",
                      highlightColumn === index && "bg-primary/5 rounded-t-lg"
                    )}
                  >
                    {col}
                    {highlightColumn === index && (
                      <Badge className="ml-2 text-xs" variant="secondary">
                        Best
                      </Badge>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, rowIndex) => (
                <tr 
                  key={rowIndex}
                  className={cn(
                    "border-b last:border-b-0",
                    item.highlight && "bg-muted/30"
                  )}
                >
                  <td className={cn(
                    "py-3 px-4 font-medium",
                    item.highlight && "text-primary"
                  )}>
                    {item.name}
                  </td>
                  {item.values.map((value, colIndex) => (
                    <td 
                      key={colIndex}
                      className={cn(
                        "text-center py-3 px-4",
                        highlightColumn === colIndex && "bg-primary/5"
                      )}
                    >
                      {renderValue(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

