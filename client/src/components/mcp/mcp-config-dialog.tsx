import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Plus, Settings, Trash2, RotateCcw, Download, Upload, Edit, Save, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  autoApprove?: string[];
  transport?: 'stdio' | 'sse' | 'streamableHttp';
  workingDir?: string;
  timeout?: number;
  retryAttempts?: number;
  description?: string;
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
  globalSettings: {
    timeout?: number;
    retryAttempts?: number;
    autoApproveAll?: boolean;
    enableLogging?: boolean;
  };
}

interface McpServerStatus {
  name: string;
  connected: boolean;
  lastConnected?: string;
  lastError?: string;
  tools: Array<{ name: string; description?: string; serverName: string }>;
  resources: Array<{ uri: string; name?: string; serverName: string }>;
  prompts: Array<{ name: string; description?: string; serverName: string }>;
  serverInfo?: { name: string; version: string };
}

interface McpConfigDialogProps {
  trigger: React.ReactNode;
}

export function McpConfigDialog({ trigger }: McpConfigDialogProps) {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [serverStatuses, setServerStatuses] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showAddServer, setShowAddServer] = useState(false);
  const [jsonConfig, setJsonConfig] = useState('');
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [oauthTokens, setOauthTokens] = useState<Array<{service_name: string; expires_at: string | null; scope: string | null; created_at: string; updated_at: string}>>([]);
  const { toast } = useToast();

  // New server form state
  const [newServer, setNewServer] = useState({
    name: '',
    command: '',
    args: '',
    url: '',
    transport: 'stdio' as 'stdio' | 'sse' | 'streamableHttp',
    description: '',
    env: '',
    autoApprove: '',
    requiresOAuth: false,
    oauthService: '',
  });

  // Load server statuses only
  const loadServerStatuses = async () => {
    try {
      const statusRes = await fetch('/api/mcp/servers/status');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setServerStatuses(statusData.data);
      }
    } catch (error) {
      console.error('Error loading MCP server statuses:', error);
    }
  };

  // Load OAuth tokens
  const loadOauthTokens = async () => {
    try {
      const response = await fetch('/api/oauth/tokens');
      if (response.ok) {
        const data = await response.json();
        setOauthTokens(data.tokens);
      }
    } catch (error) {
      console.error('Error loading OAuth tokens:', error);
    }
  };

  // Load MCP config and statuses
  const loadData = async () => {
    setLoading(true);
    try {
      const [configRes, statusRes] = await Promise.all([
        fetch('/api/mcp/config'),
        fetch('/api/mcp/servers/status'),
        loadOauthTokens(),
      ]);

      if (configRes.ok) {
        const configData = await configRes.json();
        setConfig(configData.data);
      }

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setServerStatuses(statusData.data);
      }
    } catch (error) {
      console.error('Error loading MCP data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load MCP configuration',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    if (config) {
      setJsonConfig(JSON.stringify(config, null, 2));
    }
  }, [config]);

  const saveConfig = async (newConfig: McpConfig) => {
    try {
      const response = await fetch('/api/mcp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });

      if (response.ok) {
        // Update local state immediately
        setConfig(newConfig);
        // Update JSON editor content
        setJsonConfig(JSON.stringify(newConfig, null, 2));
        // Reload server statuses only (don't reload config)
        await loadServerStatuses();
        toast({
          title: 'Success',
          description: 'MCP configuration saved successfully',
        });
      } else {
        throw new Error('Failed to save configuration');
      }
    } catch (error) {
      console.error('Error saving MCP config:', error);
      toast({
        title: 'Error',
        description: 'Failed to save MCP configuration',
        variant: 'destructive',
      });
    }
  };

  const toggleServer = async (serverName: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/mcp/servers/${serverName}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });

      if (response.ok) {
        await loadServerStatuses();
        toast({
          title: 'Success',
          description: `Server ${serverName} ${enabled ? 'enabled' : 'disabled'} successfully`,
        });
      } else {
        throw new Error('Failed to toggle server');
      }
    } catch (error) {
      console.error('Error toggling server:', error);
      toast({
        title: 'Error',
        description: 'Failed to toggle server',
        variant: 'destructive',
      });
    }
  };

  const refreshMcp = async () => {
    try {
      const response = await fetch('/api/mcp/refresh', {
        method: 'POST',
      });

      if (response.ok) {
        await loadServerStatuses();
        toast({
          title: 'Success',
          description: 'MCP system refreshed successfully',
        });
      } else {
        throw new Error('Failed to refresh MCP system');
      }
    } catch (error) {
      console.error('Error refreshing MCP:', error);
      toast({
        title: 'Error',
        description: 'Failed to refresh MCP system',
        variant: 'destructive',
      });
    }
  };

  const exportConfig = async () => {
    try {
      const response = await fetch('/api/mcp/config/export');
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mcp-config.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        toast({
          title: 'Success',
          description: 'MCP configuration exported successfully',
        });
      }
    } catch (error) {
      console.error('Error exporting config:', error);
      toast({
        title: 'Error',
        description: 'Failed to export configuration',
        variant: 'destructive',
      });
    }
  };

  const getServerStatus = (serverName: string) => {
    return serverStatuses.find(s => s.name === serverName);
  };

  const addNewServer = async () => {
    if (!newServer.name.trim()) {
      toast({
        title: 'Error',
        description: 'Server name is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Check if OAuth is required and if we have a token
      if (newServer.requiresOAuth && newServer.oauthService) {
        const hasToken = hasOAuthToken(newServer.oauthService);
        if (!hasToken) {
          // Show OAuth requirement dialog and initiate OAuth flow
          const confirmed = window.confirm(
            `This server requires OAuth authentication with ${newServer.oauthService}. Would you like to connect now?`
          );
          
          if (confirmed) {
            try {
              // Get the OAuth URL first
              const response = await fetch(`/api/oauth/authorize/${newServer.oauthService}`);
              if (response.ok) {
                const data = await response.json();
                
                // Try popup first
                const popup = window.open(
                  data.authUrl,
                  'oauth',
                  'width=600,height=700,scrollbars=yes,resizable=yes'
                );

                // Check if popup was blocked (Firefox detection)
                let popupBlocked = false;
                try {
                  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
                    popupBlocked = true;
                  } else {
                    popup.focus();
                  }
                } catch (e) {
                  popupBlocked = true;
                }

                if (popupBlocked) {
                  // Popup was blocked, offer new tab with better messaging
                  const useNewTab = window.confirm(
                    `Your browser blocked the OAuth popup. This is common in Firefox and other secure browsers.

Would you like to open OAuth authentication in a new tab instead? After completing authentication there, come back and try adding the ${newServer.oauthService} server again.`
                  );
                  
                  if (useNewTab) {
                    window.open(data.authUrl, '_blank');
                    toast({
                      title: 'OAuth Opened in New Tab',
                      description: `Complete authentication with ${newServer.oauthService} in the new tab, then return here and try adding the server again.`,
                      duration: 10000,
                    });
                  }
                  return;
                }

                toast({
                  title: 'OAuth Required',
                  description: `Please complete authentication with ${newServer.oauthService} in the popup window.`,
                });

                // Set up message listener for this specific flow
                const messageHandler = (event: MessageEvent) => {
                  if (event.data.type === 'oauth_success' && event.data.service === newServer.oauthService) {
                    window.removeEventListener('message', messageHandler);
                    clearInterval(checkClosed);
                    loadOauthTokens(); // Reload tokens
                    toast({
                      title: 'OAuth Success',
                      description: `Successfully authenticated with ${newServer.oauthService}! You can now add the server.`,
                    });
                  }
                };

                window.addEventListener('message', messageHandler);

                // Check if popup was closed manually
                const checkClosed = setInterval(() => {
                  if (popup?.closed) {
                    clearInterval(checkClosed);
                    window.removeEventListener('message', messageHandler);
                    toast({
                      title: 'Authentication Required',
                      description: `Please complete OAuth authentication with ${newServer.oauthService} before adding this server.`,
                    });
                  }
                }, 1000);

                return;
              }
            } catch (error) {
              console.error('Error initiating OAuth:', error);
              toast({
                title: 'Error',
                description: `Failed to initiate OAuth with ${newServer.oauthService}`,
                variant: 'destructive',
              });
              return;
            }
          } else {
            toast({
              title: 'Authentication Required',
              description: `OAuth authentication with ${newServer.oauthService} is required to add this server.`,
              variant: 'destructive',
            });
            return;
          }
        }
      }

      let serverConfig: McpServerConfig;

      if (newServer.url.trim()) {
        // URL-based server (SSE or streamableHttp)
        const isSSE = newServer.url.includes('/sse') || newServer.transport === 'sse';
        serverConfig = {
          command: newServer.url.trim(),
          args: [newServer.url.trim()],
          transport: isSSE ? 'sse' : 'streamableHttp',
          description: newServer.description || `Remote MCP server at ${newServer.url}`,
          requiresOAuth: newServer.requiresOAuth,
          oauthService: newServer.oauthService || undefined,
        };
      } else {
        // Command-based server
        if (!newServer.command.trim()) {
          toast({
            title: 'Error',
            description: 'Command or URL is required',
            variant: 'destructive',
          });
          return;
        }

        serverConfig = {
          command: newServer.command.trim(),
          args: newServer.args.trim() ? newServer.args.split(' ').filter(Boolean) : [],
          transport: newServer.transport,
          description: newServer.description || `MCP server: ${newServer.command}`,
          requiresOAuth: newServer.requiresOAuth,
          oauthService: newServer.oauthService || undefined,
        };
      }

      // Add environment variables
      if (newServer.env.trim()) {
        try {
          const envVars = newServer.env.trim().split('\n').reduce((acc, line) => {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
              acc[key.trim()] = valueParts.join('=').trim();
            }
            return acc;
          }, {} as Record<string, string>);
          if (Object.keys(envVars).length > 0) {
            serverConfig.env = envVars;
          }
        } catch (error) {
          toast({
            title: 'Warning',
            description: 'Invalid environment variables format, skipping',
          });
        }
      }

      // Add auto-approve tools
      if (newServer.autoApprove.trim()) {
        serverConfig.autoApprove = newServer.autoApprove.split(',').map(s => s.trim()).filter(Boolean);
      }

      const response = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newServer.name.trim(), config: serverConfig }),
      });

      if (response.ok) {
        await loadData(); // Need full reload because we added a new server
        setShowAddServer(false);
        setNewServer({
          name: '',
          command: '',
          args: '',
          url: '',
          transport: 'stdio',
          description: '',
          env: '',
          autoApprove: '',
          requiresOAuth: false,
          oauthService: '',
        });
        toast({
          title: 'Success',
          description: `MCP server '${newServer.name}' added successfully`,
        });
      } else {
        throw new Error('Failed to add server');
      }
    } catch (error) {
      console.error('Error adding server:', error);
      toast({
        title: 'Error',
        description: 'Failed to add MCP server',
        variant: 'destructive',
      });
    }
  };

  const deleteServer = async (serverName: string) => {
    try {
      const response = await fetch(`/api/mcp/servers/${serverName}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await loadData(); // Need full reload because we removed a server
        toast({
          title: 'Success',
          description: `MCP server '${serverName}' removed successfully`,
        });
      } else {
        throw new Error('Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting server:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete MCP server',
        variant: 'destructive',
      });
    }
  };

  const saveJsonConfig = async () => {
    try {
      const parsedConfig = JSON.parse(jsonConfig);
      // Use the saveConfig function which handles all the state updates
      await saveConfig(parsedConfig);
    } catch (error) {
      console.error('Error saving JSON config:', error);
      if (error instanceof SyntaxError) {
        toast({
          title: 'Error',
          description: 'Invalid JSON format - please check your syntax',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Error',
          description: 'Failed to save configuration',
          variant: 'destructive',
        });
      }
    }
  };

  // OAuth Functions
  const initiateOAuth = async (service: string) => {
    try {
      const response = await fetch(`/api/oauth/authorize/${service}`);
      if (response.ok) {
        const data = await response.json();
        
        // For Firefox, prefer new tab approach due to strict popup blocking
        if (isFirefox()) {
          const confirmed = window.confirm(
            `Firefox detected - opening OAuth in a new tab for better compatibility.

Complete the authentication in the new tab, then return here. The connection will be detected automatically.`
          );
          
          if (confirmed) {
            window.open(data.authUrl, '_blank');
            toast({
              title: 'OAuth Opened in New Tab',
              description: `Complete authentication with ${service} in the new tab. Return here when done - the connection will be detected automatically.`,
              duration: 10000,
            });
            
            // Set up polling for Firefox new tab flow
            const pollForToken = setInterval(async () => {
              await loadOauthTokens();
              if (hasOAuthToken(service)) {
                clearInterval(pollForToken);
                loadServerStatuses(); // Reload server statuses
                toast({
                  title: 'OAuth Connected!',
                  description: `Successfully authenticated with ${service}. You can now add MCP servers that require ${service}.`,
                });
              }
            }, 2000);
            
            // Stop polling after 5 minutes
            setTimeout(() => {
              clearInterval(pollForToken);
            }, 300000);
          }
          return;
        }
        
        // Try to open OAuth popup for non-Firefox browsers
        const popup = window.open(
          data.authUrl,
          'oauth',
          'width=600,height=700,scrollbars=yes,resizable=yes'
        );

        // Check if popup was blocked (Firefox is stricter about this)
        let popupBlocked = false;
        try {
          if (!popup || popup.closed || typeof popup.closed === 'undefined') {
            popupBlocked = true;
          } else {
            // Additional check for Firefox - try to access popup properties
            popup.focus();
          }
        } catch (e) {
          popupBlocked = true;
        }

        if (popupBlocked) {
          // For Firefox and other strict browsers, go directly to new tab
          const userConfirmed = window.confirm(
            `OAuth popup was blocked by your browser. Would you like to open the authentication page in a new tab?

After completing authentication, come back to this page and the connection will be updated automatically.`
          );
          
          if (userConfirmed) {
            window.open(data.authUrl, '_blank');
            toast({
              title: 'Authentication Opened',
              description: `Complete OAuth authentication for ${service} in the new tab. The connection status will update automatically when you return.`,
              duration: 8000,
            });
            
            // Set up a polling mechanism to check for token updates
            const pollForToken = setInterval(async () => {
              await loadOauthTokens();
              if (hasOAuthToken(service)) {
                clearInterval(pollForToken);
                toast({
                  title: 'OAuth Connected!',
                  description: `Successfully authenticated with ${service}. You can now add MCP servers that require ${service}.`,
                });
              }
            }, 2000); // Check every 2 seconds
            
            // Stop polling after 5 minutes
            setTimeout(() => {
              clearInterval(pollForToken);
            }, 300000);
          }
          return;
        }

        toast({
          title: 'OAuth Flow Started',
          description: `Please complete the authentication in the popup window for ${service}.`,
        });

        // Listen for OAuth completion
        const messageHandler = (event: MessageEvent) => {
          if (event.data.type === 'oauth_success' && event.data.service === service) {
            window.removeEventListener('message', messageHandler);
            clearInterval(checkClosed);
            loadOauthTokens(); // Reload tokens
            loadServerStatuses(); // Reload server statuses to show updated OAuth connection status
            toast({
              title: 'Success',
              description: `Successfully connected to ${service}! You can now use MCP servers that require ${service} authentication.`,
            });
          }
        };

        window.addEventListener('message', messageHandler);

        // Check if popup was closed manually
        const checkClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', messageHandler);
            toast({
              title: 'OAuth Cancelled',
              description: `Authentication window was closed. Please try again if you want to connect to ${service}.`,
              variant: 'destructive',
            });
          }
        }, 1000);

        // Set a timeout for the OAuth process
        setTimeout(() => {
          if (!popup?.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', messageHandler);
            toast({
              title: 'OAuth Timeout',
              description: `Authentication is taking longer than expected. You can continue in the popup window or try again.`,
            });
          }
        }, 30000); // 30 second timeout

      } else {
        // Try to get more detailed error information
        const errorData = await response.json().catch(() => ({}));
        console.error('OAuth initiation failed:', errorData);
        
        if (errorData.details && errorData.required) {
          // Show setup instructions for missing OAuth configuration
          toast({
            title: 'OAuth Not configured',
            description: `${errorData.error}. ${errorData.details}`,
            variant: 'destructive',
            duration: 10000,
          });
          
          // Also log the setup instructions to console for developer
          console.log(`To enable ${service} OAuth:`, {
            setup: errorData.setup,
            required: errorData.required
          });
        } else {
          throw new Error(errorData.error || 'Failed to initiate OAuth');
        }
        return;
      }
    } catch (error) {
      console.error('Error initiating OAuth:', error);
      toast({
        title: 'OAuth Error',
        description: `Failed to connect to ${service}. Check console for details.`,
        variant: 'destructive',
      });
    }
  };

  const revokeOAuth = async (service: string) => {
    try {
      const response = await fetch(`/api/oauth/tokens/${service}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadOauthTokens(); // Reload tokens
        toast({
          title: 'Success',
          description: `Disconnected from ${service}`,
        });
      } else {
        throw new Error('Failed to revoke OAuth token');
      }
    } catch (error) {
      console.error('Error revoking OAuth:', error);
      toast({
        title: 'Error',
        description: `Failed to disconnect from ${service}`,
        variant: 'destructive',
      });
    }
  };

  const hasOAuthToken = (service: string) => {
    return oauthTokens.some(token => token.service_name === service);
  };

  // Browser detection for better OAuth experience
  const isFirefox = () => {
    return navigator.userAgent.toLowerCase().includes('firefox');
  };

  if (!config) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>MCP Configuration</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center h-32">
            {loading ? 'Loading...' : 'Failed to load configuration'}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              MCP Configuration
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="servers" className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-5 flex-shrink-0">
              <TabsTrigger value="servers">Servers</TabsTrigger>
              <TabsTrigger value="add-server">Add Server</TabsTrigger>
              <TabsTrigger value="tools">Tools</TabsTrigger>
              <TabsTrigger value="json-editor">JSON Editor</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="servers" className="flex-1 flex flex-col space-y-4 overflow-hidden">
              <div className="flex justify-between items-center flex-shrink-0">
                <h3 className="text-lg font-semibold">MCP Servers</h3>
                <div className="flex gap-2">
                  <Button onClick={refreshMcp} variant="outline" size="sm">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                  <Button onClick={exportConfig} variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                </div>
              </div>

              <ScrollArea className="flex-1 pr-4">
                <div className="space-y-4">
                {Object.entries(config.mcpServers).map(([serverName, serverConfig]) => {
                  const status = getServerStatus(serverName);
                  return (
                    <Card key={serverName}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base">{serverName}</CardTitle>
                            <Badge variant={status?.connected ? 'default' : 'secondary'}>
                              {status?.connected ? 'Connected' : 'Disconnected'}
                            </Badge>
                            {serverConfig.disabled && (
                              <Badge variant="outline">Disabled</Badge>
                            )}
                            {serverConfig.requiresOAuth && serverConfig.oauthService && (
                              <Badge variant={hasOAuthToken(serverConfig.oauthService) ? 'default' : 'destructive'}>
                                {hasOAuthToken(serverConfig.oauthService) ? 'OAuth Connected' : 'OAuth Required'}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {serverConfig.requiresOAuth && serverConfig.oauthService && !hasOAuthToken(serverConfig.oauthService) && (
                              <Button
                                onClick={() => initiateOAuth(serverConfig.oauthService!)}
                                variant="outline"
                                size="sm"
                                className="text-blue-600 hover:text-blue-700"
                              >
                                Connect OAuth
                              </Button>
                            )}
                            <Switch
                              checked={!serverConfig.disabled}
                              onCheckedChange={(enabled) => toggleServer(serverName, enabled)}
                            />
                            <Button
                              onClick={() => deleteServer(serverName)}
                              variant="outline"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {serverConfig.description && (
                          <CardDescription>{serverConfig.description}</CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <Label className="text-xs text-muted-foreground">Command</Label>
                            <p className="font-mono">{serverConfig.command}</p>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Transport</Label>
                            <p>{serverConfig.transport || 'stdio'}</p>
                          </div>
                          {status && (
                            <>
                              <div>
                                <Label className="text-xs text-muted-foreground">Tools</Label>
                                <p>{status.tools.length}</p>
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Resources</Label>
                                <p>{status.resources.length}</p>
                              </div>
                            </>
                          )}
                        </div>
                        {status?.lastError && (
                          <Alert className="mt-2">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>{status.lastError}</AlertDescription>
                          </Alert>
                        )}
                      </CardContent>
                    </Card>
                  );
                  })}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="add-server" className="flex-1 overflow-auto">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Add New MCP Server</h3>
                </div>
                    <Card>
              <CardHeader>
                <CardTitle>Server Configuration</CardTitle>
                <CardDescription>
                  Add a new MCP server by URL or command. URL-based servers are easier to set up.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="serverName">Server Name *</Label>
                    <Input
                      id="serverName"
                      placeholder="my-server"
                      value={newServer.name}
                      onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="transport">Transport</Label>
                    <Select
                      value={newServer.transport}
                      onValueChange={(value: 'stdio' | 'sse' | 'streamableHttp') =>
                        setNewServer({ ...newServer, transport: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stdio">STDIO</SelectItem>
                        <SelectItem value="sse">SSE</SelectItem>
                        <SelectItem value="streamableHttp">Streamable HTTP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serverUrl">Server URL (for remote servers)</Label>
                  <Input
                    id="serverUrl"
                    placeholder="https://example.com/mcp or https://api.example.com/sse"
                    value={newServer.url}
                    onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    For remote MCP servers. If provided, command and args will be ignored.
                  </p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="serverCommand">Command (for local servers)</Label>
                  <Input
                    id="serverCommand"
                    placeholder="npx"
                    value={newServer.command}
                    onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serverArgs">Arguments</Label>
                  <Input
                    id="serverArgs"
                    placeholder="-y @modelcontextprotocol/server-filesystem ./"
                    value={newServer.args}
                    onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serverDescription">Description</Label>
                  <Input
                    id="serverDescription"
                    placeholder="What this server does..."
                    value={newServer.description}
                    onChange={(e) => setNewServer({ ...newServer, description: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serverEnv">Environment Variables</Label>
                  <Textarea
                    id="serverEnv"
                    placeholder="API_KEY=your-key&#10;ANOTHER_VAR=value"
                    value={newServer.env}
                    onChange={(e) => setNewServer({ ...newServer, env: e.target.value })}
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    One per line in KEY=value format
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serverAutoApprove">Auto-approve Tools</Label>
                  <Input
                    id="serverAutoApprove"
                    placeholder="read_file, list_directory"
                    value={newServer.autoApprove}
                    onChange={(e) => setNewServer({ ...newServer, autoApprove: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated list of tool names to auto-approve
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => {
                      setNewServer({
                        name: '',
                        command: '',
                        args: '',
                        url: '',
                        transport: 'stdio',
                        description: '',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: false,
                        oauthService: '',
                      });
                    }}
                    variant="outline"
                  >
                    Clear
                  </Button>
                  <Button onClick={addNewServer} className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Server
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Popular MCP Servers</CardTitle>
                <CardDescription>Quick setup for popular remote MCP servers</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'github',
                        command: '',
                        args: '',
                        url: 'https://mcp.github.com/sse',
                        transport: 'sse',
                        description: 'GitHub integration (OAuth required)',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: true,
                        oauthService: 'github',
                      })
                    }
                  >
                    GitHub
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'notion',
                        command: '',
                        args: '',
                        url: 'https://mcp.notion.com/sse',
                        transport: 'sse',
                        description: 'Notion workspace integration (OAuth required)',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: true,
                        oauthService: 'notion',
                      })
                    }
                  >
                    Notion
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'linear',
                        command: '',
                        args: '',
                        url: 'https://mcp.linear.app/sse',
                        transport: 'sse',
                        description: 'Linear project management (OAuth required)',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: true,
                        oauthService: 'linear',
                      })
                    }
                  >
                    Linear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'sentry',
                        command: '',
                        args: '',
                        url: 'https://mcp.sentry.io/sse',
                        transport: 'sse',
                        description: 'Sentry error monitoring (OAuth required)',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: true,
                        oauthService: 'sentry',
                      })
                    }
                  >
                    Sentry
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'neon',
                        command: '',
                        args: '',
                        url: 'https://mcp.neon.tech/sse',
                        transport: 'sse',
                        description: 'Neon PostgreSQL (OAuth required)',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: true,
                        oauthService: 'neon',
                      })
                    }
                  >
                    Neon
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'intercom',
                        command: '',
                        args: '',
                        url: 'https://mcp.intercom.com/sse',
                        transport: 'sse',
                        description: 'Intercom customer support (OAuth required)',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: true,
                        oauthService: 'intercom',
                      })
                    }
                  >
                    Intercom
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'asana',
                        command: '',
                        args: '',
                        url: 'https://mcp.asana.com/sse',
                        transport: 'sse',
                        description: 'Asana project management (OAuth required)',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: true,
                        oauthService: 'asana',
                      })
                    }
                  >
                    Asana
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'webflow',
                        command: '',
                        args: '',
                        url: 'https://mcp.webflow.com/sse',
                        transport: 'sse',
                        description: 'Webflow website builder (OAuth required)',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: true,
                        oauthService: 'webflow',
                      })
                    }
                  >
                    Webflow
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'wix',
                        command: '',
                        args: '',
                        url: 'https://mcp.wix.com/sse',
                        transport: 'sse',
                        description: 'Wix website builder (OAuth required)',
                        env: '',
                        autoApprove: '',
                        requiresOAuth: true,
                        oauthService: 'wix',
                      })
                    }
                  >
                    Wix
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'fetch',
                        command: '',
                        args: '',
                        url: 'https://mcp-fetch.example.com',
                        transport: 'streamableHttp',
                        description: 'Web content fetching server',
                        env: '',
                        autoApprove: '',
                      })
                    }
                  >
                    Fetch
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'coingecko',
                        command: '',
                        args: '',
                        url: 'https://mcp.coingecko.com',
                        transport: 'streamableHttp',
                        description: 'Cryptocurrency data platform',
                        env: '',
                        autoApprove: '',
                      })
                    }
                  >
                    CoinGecko
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewServer({
                        name: 'brave_search',
                        command: 'npx',
                        args: '-y @modelcontextprotocol/server-brave-search',
                        url: '',
                        transport: 'stdio',
                        description: 'Brave search integration',
                        env: 'BRAVE_API_KEY=',
                        autoApprove: '',
                      })
                    }
                  >
                    Brave Search
                  </Button>
                  </div>
                </CardContent>
                    </Card>
              </div>
            </TabsContent>


            <TabsContent value="tools" className="flex-1 flex flex-col space-y-4 overflow-hidden">
              <h3 className="text-lg font-semibold flex-shrink-0">Available Tools & Resources</h3>
              <ScrollArea className="flex-1 pr-4">
                <div className="space-y-4">
                {serverStatuses.filter(s => s.connected).map((server) => (
                  <Card key={server.name}>
                    <CardHeader>
                      <CardTitle className="text-base">{server.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {server.tools.length > 0 && (
                        <div className="mb-4">
                          <Label className="text-sm font-medium">Tools ({server.tools.length})</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {server.tools.map((tool) => (
                              <Badge key={tool.name} variant="secondary" className="text-xs">
                                {tool.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {server.resources.length > 0 && (
                        <div className="mb-4">
                          <Label className="text-sm font-medium">Resources ({server.resources.length})</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {server.resources.map((resource, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {resource.name || resource.uri}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {server.prompts.length > 0 && (
                        <div>
                          <Label className="text-sm font-medium">Prompts ({server.prompts.length})</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {server.prompts.map((prompt) => (
                              <Badge key={prompt.name} variant="outline" className="text-xs">
                                {prompt.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="json-editor" className="flex-1 flex flex-col space-y-4 overflow-hidden">
              <div className="flex justify-between items-center flex-shrink-0">
                <h3 className="text-lg font-semibold">JSON Configuration Editor</h3>
                <div className="flex gap-2">
                  <Button onClick={saveJsonConfig} className="bg-green-600 hover:bg-green-700" size="sm">
                    <Save className="h-4 w-4 mr-2" />
                    Save JSON
                  </Button>
                </div>
              </div>

              <Alert className="flex-shrink-0">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Direct JSON editing allows advanced configuration but can break the system if invalid.
                  Make sure your JSON is properly formatted before saving.
                </AlertDescription>
              </Alert>

              <div className="flex-1 flex flex-col space-y-2 min-h-0" style={{ minHeight: 400 }}>
                <Label htmlFor="jsonEditor" className="flex-shrink-0">Configuration JSON</Label>
                <Textarea
                  id="jsonEditor"
                  value={jsonConfig || 'Loading configuration...'}
                  onChange={(e) => setJsonConfig(e.target.value)}
                  className="font-mono text-sm flex-1 resize-none overflow-auto"
                  style={{ minHeight: 300, height: 400 }}
                  placeholder="Loading configuration..."
                  disabled={!jsonConfig || loading}
                />
              </div>

              <div className="flex justify-end flex-shrink-0">
                <Button onClick={saveJsonConfig} className="bg-green-600 hover:bg-green-700">
                  <Save className="h-4 w-4 mr-2" />
                  Apply Configuration
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="settings" className="flex-1 flex flex-col space-y-4 overflow-hidden">
              <h3 className="text-lg font-semibold flex-shrink-0">Global Settings</h3>
              <ScrollArea className="flex-1 pr-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="timeout">Default Timeout (ms)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={config.globalSettings.timeout || 30000}
                  onChange={(e) => {
                    const newConfig = {
                      ...config,
                      globalSettings: {
                        ...config.globalSettings,
                        timeout: parseInt(e.target.value),
                      },
                    };
                    setConfig(newConfig);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="retryAttempts">Retry Attempts</Label>
                <Input
                  id="retryAttempts"
                  type="number"
                  value={config.globalSettings.retryAttempts || 3}
                  onChange={(e) => {
                    const newConfig = {
                      ...config,
                      globalSettings: {
                        ...config.globalSettings,
                        retryAttempts: parseInt(e.target.value),
                      },
                    };
                    setConfig(newConfig);
                  }}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="autoApproveAll"
                  checked={config.globalSettings.autoApproveAll || false}
                  onCheckedChange={(checked) => {
                    const newConfig = {
                      ...config,
                      globalSettings: {
                        ...config.globalSettings,
                        autoApproveAll: checked,
                      },
                    };
                    setConfig(newConfig);
                  }}
                />
                <Label htmlFor="autoApproveAll">Auto-approve all tools</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="enableLogging"
                  checked={config.globalSettings.enableLogging !== false}
                  onCheckedChange={(checked) => {
                    const newConfig = {
                      ...config,
                      globalSettings: {
                        ...config.globalSettings,
                        enableLogging: checked,
                      },
                    };
                    setConfig(newConfig);
                  }}
                />
                <Label htmlFor="enableLogging">Enable logging</Label>
              </div>
                  </div>
                  <Separator />
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => saveConfig(config)} className="bg-blue-600 hover:bg-blue-700">
                      Save Configuration
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
