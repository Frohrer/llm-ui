import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Edit2, Play, Code, Settings, Sparkles, Loader2 } from 'lucide-react';

interface CustomTool {
  id: number;
  name: string;
  description: string;
  python_code: string;
  parameters_schema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  packages?: string[];
  is_enabled: boolean;
  is_shared: boolean;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ToolFormData {
  name: string;
  description: string;
  python_code: string;
  parameters_schema: string; // JSON string
  packages: string[];
  is_enabled: boolean;
  is_shared: boolean;
}

export default function CustomToolsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<CustomTool | null>(null);
  const [formData, setFormData] = useState<ToolFormData>({
    name: '',
    description: '',
    python_code: '',
    parameters_schema: JSON.stringify({
      type: 'object',
      properties: {},
      required: []
    }, null, 2),
    packages: [],
    is_enabled: true,
    is_shared: false,
  });
  
  // Test console state
  const [testParameters, setTestParameters] = useState('{}');
  const [testFormData, setTestFormData] = useState<Record<string, any>>({});
  const [testOutput, setTestOutput] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isGeneratingSchema, setIsGeneratingSchema] = useState(false);
  const [useFormView, setUseFormView] = useState(true);
  
  // Package management state
  const [packageInput, setPackageInput] = useState('');

  // Fetch custom tools
  const { data: tools = [], isLoading } = useQuery<CustomTool[]>({
    queryKey: ['/api/custom-tools'],
  });

  // Create tool mutation
  const createToolMutation = useMutation({
    mutationFn: async (data: ToolFormData) => {
      const response = await fetch('/api/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          parameters_schema: JSON.parse(data.parameters_schema),
        }),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create tool');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/custom-tools'] });
      // Keep dialog open after saving
      toast({
        title: 'Tool created',
        description: 'Your custom tool has been created successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Update tool mutation
  const updateToolMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ToolFormData> }) => {
      const response = await fetch(`/api/custom-tools/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          parameters_schema: data.parameters_schema ? JSON.parse(data.parameters_schema) : undefined,
        }),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update tool');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/custom-tools'] });
      // Keep dialog open after updating
      toast({
        title: 'Tool updated',
        description: 'Your custom tool has been updated successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete tool mutation
  const deleteToolMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/custom-tools/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete tool');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/custom-tools'] });
      toast({
        title: 'Tool deleted',
        description: 'Your custom tool has been deleted successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Toggle tool mutation
  const toggleToolMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/custom-tools/${id}/toggle`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to toggle tool');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/custom-tools'] });
      toast({
        title: 'Tool toggled',
        description: 'Tool status has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      python_code: '',
      parameters_schema: JSON.stringify({
        type: 'object',
        properties: {},
        required: []
      }, null, 2),
      packages: [],
      is_enabled: true,
      is_shared: false,
    });
    setTestParameters('{}');
    setTestFormData({});
    setTestOutput(null);
    setPackageInput('');
  };

  // Parse schema and get form fields
  const getSchemaFields = () => {
    try {
      const schema = JSON.parse(formData.parameters_schema);
      if (schema.properties && typeof schema.properties === 'object') {
        return {
          properties: schema.properties,
          required: schema.required || []
        };
      }
    } catch (e) {
      // Invalid schema
    }
    return { properties: {}, required: [] };
  };

  // Sync form data to JSON when switching to JSON view
  const syncFormToJson = () => {
    setTestParameters(JSON.stringify(testFormData, null, 2));
  };

  // Sync JSON to form data when switching to form view
  const syncJsonToForm = () => {
    try {
      const parsed = JSON.parse(testParameters);
      setTestFormData(parsed);
    } catch (e) {
      // Keep existing form data if JSON is invalid
    }
  };

  const handleTestTool = async () => {
    setIsTesting(true);
    setTestOutput(null);
    
    try {
      // Get parameters from form or JSON depending on current view
      let parameters = {};
      
      if (useFormView) {
        // Use form data directly
        parameters = testFormData;
      } else {
        // Parse JSON
        try {
          parameters = JSON.parse(testParameters);
        } catch (e) {
          toast({
            title: 'Invalid JSON',
            description: 'Test parameters must be valid JSON.',
            variant: 'destructive',
          });
          return;
        }
      }

      const response = await fetch('/api/custom-tools/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          python_code: formData.python_code,
          parameters,
          packages: formData.packages.length > 0 ? formData.packages : undefined,
        }),
        credentials: 'include',
      });

      const result = await response.json();
      setTestOutput(result);

      if (result.success) {
        toast({
          title: 'Test successful',
          description: 'Your tool executed successfully.',
        });
      } else {
        toast({
          title: 'Test failed',
          description: result.error || 'Tool execution failed.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to test tool.',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleGenerateSchema = async () => {
    setIsGeneratingSchema(true);
    
    try {
      const response = await fetch('/api/custom-tools/generate-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          python_code: formData.python_code,
          description: formData.description,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate schema');
      }

      const { schema } = await response.json();
      setFormData({
        ...formData,
        parameters_schema: JSON.stringify(schema, null, 2),
      });

      toast({
        title: 'Schema generated',
        description: 'Parameter schema has been generated from your code.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate schema.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingSchema(false);
    }
  };

  const handleEdit = (tool: CustomTool) => {
    setEditingTool(tool);
    setFormData({
      name: tool.name,
      description: tool.description,
      python_code: tool.python_code,
      parameters_schema: JSON.stringify(tool.parameters_schema, null, 2),
      packages: tool.packages || [],
      is_enabled: tool.is_enabled,
      is_shared: tool.is_shared,
    });
    setIsCreateDialogOpen(true);
  };

  const handleSubmit = () => {
    // Validate JSON schema
    try {
      JSON.parse(formData.parameters_schema);
    } catch (e) {
      toast({
        title: 'Invalid JSON',
        description: 'Parameters schema must be valid JSON.',
        variant: 'destructive',
      });
      return;
    }

    if (editingTool) {
      updateToolMutation.mutate({ id: editingTool.id, data: formData });
    } else {
      createToolMutation.mutate(formData);
    }
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this tool?')) {
      deleteToolMutation.mutate(id);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Custom Tools</h1>
        <Button asChild variant="outline"><Link href="/">Back to Chat</Link></Button>
      </div>
      <p className="text-muted-foreground">
        Create and manage custom Python tools for your AI assistants
      </p>
      <div className="flex justify-end items-center">
        <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
          setIsCreateDialogOpen(open);
          if (!open) {
            // Reset form when dialog closes (handles cancel, save success, escape, etc.)
            setEditingTool(null);
            resetForm();
          }
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Tool
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTool ? 'Edit Tool' : 'Create New Tool'}</DialogTitle>
              <DialogDescription>
                Create a custom Python tool that can be used by AI assistants
              </DialogDescription>
            </DialogHeader>
            
            <Tabs defaultValue="config" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="config">Configuration</TabsTrigger>
                <TabsTrigger value="test">Test Console</TabsTrigger>
              </TabsList>
              
              <TabsContent value="config" className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Tool Name</Label>
                <Input
                  id="name"
                  placeholder="my_custom_tool"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Use lowercase with underscores only (e.g., calculate_fibonacci)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe what this tool does for the AI..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="python_code">Python Code</Label>
                <Textarea
                  id="python_code"
                  placeholder="# Your Python code here&#10;# Use print() to output results&#10;print('Hello from custom tool!')"
                  value={formData.python_code}
                  onChange={(e) => setFormData({ ...formData, python_code: e.target.value })}
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Use print() statements to see output. Parameters will be available as variables.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="packages">Python Packages</Label>
                <div className="flex gap-2">
                  <Input
                    id="packages"
                    placeholder="e.g., opencv-python, scikit-learn, beautifulsoup4"
                    value={packageInput}
                    onChange={(e) => setPackageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const pkg = packageInput.trim();
                        if (pkg && !formData.packages.includes(pkg)) {
                          setFormData({ ...formData, packages: [...formData.packages, pkg] });
                          setPackageInput('');
                        }
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const pkg = packageInput.trim();
                      if (pkg && !formData.packages.includes(pkg)) {
                        setFormData({ ...formData, packages: [...formData.packages, pkg] });
                        setPackageInput('');
                      }
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                {formData.packages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.packages.map((pkg, index) => (
                      <Badge key={index} variant="secondary" className="flex items-center gap-1">
                        {pkg}
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              packages: formData.packages.filter((_, i) => i !== index)
                            });
                          }}
                          className="ml-1 hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Add Python packages that will be installed when running this tool. Useful when package names differ from import names (e.g., opencv-python vs cv2).
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="parameters_schema">Parameters Schema (JSON)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateSchema}
                    disabled={isGeneratingSchema || !formData.python_code}
                  >
                    {isGeneratingSchema ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Generate Schema
                      </>
                    )}
                  </Button>
                </div>
                <Textarea
                  id="parameters_schema"
                  value={formData.parameters_schema}
                  onChange={(e) => setFormData({ ...formData, parameters_schema: e.target.value })}
                  rows={8}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Define the parameters your tool accepts in JSON Schema format, or click "Generate Schema" to auto-generate from your code
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="is_enabled"
                  checked={formData.is_enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_enabled: checked })}
                />
                <Label htmlFor="is_enabled">Enabled</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="is_shared"
                  checked={formData.is_shared}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_shared: checked })}
                />
                <Label htmlFor="is_shared">Share with all users</Label>
              </div>
            </TabsContent>
            
            <TabsContent value="test" className="space-y-4 py-4">
              {(() => {
                const { properties, required } = getSchemaFields();
                const hasFields = Object.keys(properties).length > 0;

                return (
                  <>
                    {hasFields && (
                      <div className="flex items-center justify-between mb-2">
                        <Label>Test Parameters</Label>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant={useFormView ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                              if (!useFormView) {
                                syncJsonToForm();
                              }
                              setUseFormView(true);
                            }}
                          >
                            Form View
                          </Button>
                          <Button
                            type="button"
                            variant={!useFormView ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                              if (useFormView) {
                                syncFormToJson();
                              }
                              setUseFormView(false);
                            }}
                          >
                            JSON View
                          </Button>
                        </div>
                      </div>
                    )}

                    {useFormView && hasFields ? (
                      <div className="space-y-4 p-4 border rounded-lg">
                        {Object.entries(properties).map(([key, prop]: [string, any]) => {
                          const isRequired = required.includes(key);
                          const type = prop.type || 'string';
                          const description = prop.description;

                          return (
                            <div key={key} className="space-y-2">
                              <Label htmlFor={`test_${key}`}>
                                {key}
                                {isRequired && <span className="text-red-500 ml-1">*</span>}
                              </Label>
                              
                              {type === 'boolean' ? (
                                <div className="flex items-center space-x-2">
                                  <Switch
                                    id={`test_${key}`}
                                    checked={testFormData[key] || false}
                                    onCheckedChange={(checked) => {
                                      setTestFormData({ ...testFormData, [key]: checked });
                                    }}
                                  />
                                  <span className="text-sm text-muted-foreground">
                                    {testFormData[key] ? 'True' : 'False'}
                                  </span>
                                </div>
                              ) : type === 'number' || type === 'integer' ? (
                                <Input
                                  id={`test_${key}`}
                                  type="number"
                                  placeholder={description || `Enter ${key}`}
                                  value={testFormData[key] ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value === '' ? undefined : Number(e.target.value);
                                    setTestFormData({ ...testFormData, [key]: value });
                                  }}
                                />
                              ) : type === 'array' ? (
                                <Textarea
                                  id={`test_${key}`}
                                  placeholder='["item1", "item2"] or [1, 2, 3]'
                                  value={testFormData[key] ? JSON.stringify(testFormData[key]) : ''}
                                  onChange={(e) => {
                                    try {
                                      const parsed = JSON.parse(e.target.value);
                                      if (Array.isArray(parsed)) {
                                        setTestFormData({ ...testFormData, [key]: parsed });
                                      }
                                    } catch {
                                      // Keep previous value if invalid JSON
                                    }
                                  }}
                                  rows={2}
                                  className="font-mono text-sm"
                                />
                              ) : (
                                <Input
                                  id={`test_${key}`}
                                  type="text"
                                  placeholder={description || `Enter ${key}`}
                                  value={testFormData[key] ?? ''}
                                  onChange={(e) => {
                                    setTestFormData({ ...testFormData, [key]: e.target.value });
                                  }}
                                />
                              )}
                              
                              {description && (
                                <p className="text-xs text-muted-foreground">{description}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="test_parameters">Test Parameters (JSON)</Label>
                        <Textarea
                          id="test_parameters"
                          placeholder='{"parameter_name": "value"}'
                          value={testParameters}
                          onChange={(e) => setTestParameters(e.target.value)}
                          rows={hasFields ? 6 : 4}
                          className="font-mono text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          {hasFields 
                            ? 'Edit parameters as JSON. Switch to Form View for easier editing.'
                            : 'Provide test parameters as JSON. Define a parameter schema in the Configuration tab to use Form View.'}
                        </p>
                      </div>
                    )}
                  </>
                );
              })()}
              
              
              <Button
                onClick={handleTestTool}
                disabled={isTesting || !formData.python_code}
                className="w-full"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running Test...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Test
                  </>
                )}
              </Button>
              
              {testOutput && (
                <div className="space-y-2">
                  <Label>Test Output</Label>
                  <Card className={testOutput.success ? 'border-green-500' : 'border-red-500'}>
                    <CardHeader>
                      <CardTitle className="text-sm">
                        {testOutput.success ? '✓ Success' : '✗ Failed'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {testOutput.output && (
                        <div className="space-y-2">
                          <div className="text-sm font-semibold">Output:</div>
                          <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                            {testOutput.output}
                          </pre>
                        </div>
                      )}
                      {testOutput.error && (
                        <div className="space-y-2 mt-2">
                          <div className="text-sm font-semibold text-red-500">Error:</div>
                          <pre className="bg-red-50 dark:bg-red-950 p-3 rounded text-xs overflow-x-auto text-red-700 dark:text-red-300">
                            {testOutput.error}
                          </pre>
                        </div>
                      )}
                      {testOutput.execution_time && (
                        <div className="text-xs text-muted-foreground mt-2">
                          Execution time: {testOutput.execution_time}s
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>
          </Tabs>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setIsCreateDialogOpen(false);
                // Form reset is handled by dialog's onOpenChange
              }}>
                Cancel
              </Button>
              <Button onClick={handleSubmit}>
                {editingTool ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-12">Loading tools...</div>
      ) : tools.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Code className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No custom tools yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first custom Python tool to extend your AI assistants
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Tool
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => (
            <Card key={tool.id} className={!tool.is_enabled ? 'opacity-60' : ''}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      <Code className="h-4 w-4" />
                      {tool.name}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      {tool.description}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(tool)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(tool.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant={tool.is_enabled ? 'default' : 'secondary'}>
                      {tool.is_enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    {tool.is_shared && <Badge variant="outline">Shared</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <div>Executions: {tool.execution_count}</div>
                    {tool.last_executed_at && (
                      <div>
                        Last run: {new Date(tool.last_executed_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-2"
                    onClick={() => toggleToolMutation.mutate(tool.id)}
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    {tool.is_enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

