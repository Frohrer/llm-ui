import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Column {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'badge' | 'currency';
  align?: 'left' | 'center' | 'right';
}

interface DataTableProps {
  title?: string;
  description?: string;
  columns: Column[];
  data: Record<string, any>[];
  striped?: boolean;
  compact?: boolean;
}

const badgeVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  'active': 'default',
  'pending': 'secondary',
  'inactive': 'outline',
  'error': 'destructive',
  'success': 'default',
  'warning': 'secondary',
};

function formatCellValue(value: any, type?: string): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  
  switch (type) {
    case 'currency':
      return typeof value === 'number' 
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
        : value;
    case 'number':
      return typeof value === 'number'
        ? new Intl.NumberFormat('en-US').format(value)
        : value;
    case 'badge':
      const variant = badgeVariants[String(value).toLowerCase()] || 'secondary';
      return <Badge variant={variant}>{String(value)}</Badge>;
    default:
      return String(value);
  }
}

export function DataTable({
  title,
  description,
  columns,
  data,
  striped = true,
  compact = false
}: DataTableProps) {
  return (
    <Card>
      {(title || description) && (
        <CardHeader className={compact ? 'pb-2' : ''}>
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={compact ? 'pt-0' : ''}>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {columns.map((column) => (
                  <TableHead 
                    key={column.key}
                    className={`font-semibold ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, rowIndex) => (
                <TableRow 
                  key={rowIndex}
                  className={striped && rowIndex % 2 === 1 ? 'bg-muted/30' : ''}
                >
                  {columns.map((column) => (
                    <TableCell 
                      key={column.key}
                      className={`${compact ? 'py-2' : ''} ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                    >
                      {formatCellValue(row[column.key], column.type)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                    No data available
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

