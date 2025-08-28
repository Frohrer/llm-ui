import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Settings, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface McpStats {
  totalMcpTools: number;
  toolsByServer: Record<string, number>;
  connectedServers: number;
  lastUpdate: string;
}

interface McpStatusBadgeProps {
  showDetails?: boolean;
  className?: string;
}

export function McpStatusBadge({ showDetails = false, className }: McpStatusBadgeProps) {
  const [stats, setStats] = useState<McpStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/mcp/statistics');
      if (response.ok) {
        const data = await response.json();
        setStats(data.data.mcp);
      } else {
        throw new Error('Failed to load MCP statistics');
      }
    } catch (err) {
      console.error('Error loading MCP stats:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    
    // Refresh stats every 30 seconds
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Badge variant="secondary" className={className}>
        <Settings className="h-3 w-3 mr-1 animate-spin" />
        MCP Loading...
      </Badge>
    );
  }

  if (error || !stats) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className={className}>
              <XCircle className="h-3 w-3 mr-1" />
              MCP Error
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Error loading MCP statistics: {error}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const getBadgeVariant = () => {
    if (stats.connectedServers === 0) return 'secondary';
    if (stats.totalMcpTools === 0) return 'outline';
    return 'default';
  };

  const getIcon = () => {
    if (stats.connectedServers === 0) return <AlertTriangle className="h-3 w-3 mr-1" />;
    if (stats.totalMcpTools === 0) return <Settings className="h-3 w-3 mr-1" />;
    return <CheckCircle className="h-3 w-3 mr-1" />;
  };

  const getStatusText = () => {
    if (showDetails) {
      return `MCP: ${stats.connectedServers}/${Object.keys(stats.toolsByServer).length} servers, ${stats.totalMcpTools} tools`;
    }
    return `MCP (${stats.totalMcpTools})`;
  };

  const getTooltipContent = () => {
    if (stats.connectedServers === 0) {
      return 'No MCP servers connected';
    }
    
    const serverList = Object.entries(stats.toolsByServer)
      .map(([server, count]) => `${server}: ${count} tools`)
      .join('\n');
    
    return `Connected servers: ${stats.connectedServers}\nTotal tools: ${stats.totalMcpTools}\n\n${serverList}`;
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={getBadgeVariant()} className={className}>
            {getIcon()}
            {getStatusText()}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <pre className="text-xs whitespace-pre-wrap">{getTooltipContent()}</pre>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
