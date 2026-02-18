import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ChevronUp, ChevronDown, RefreshCw, Loader2, GripVertical,
  ArrowLeft, Coins, Cpu, Clock, Activity, BarChart3, Settings2,
} from 'lucide-react';
import { clearProvidersCache } from '@/lib/llm/providers';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const MANAGEABLE_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', supportsRefresh: true },
  { id: 'anthropic', label: 'Anthropic', supportsRefresh: true },
  { id: 'deepseek', label: 'DeepSeek', supportsRefresh: true },
  { id: 'grok', label: 'Grok', supportsRefresh: true },
  { id: 'gemini', label: 'Gemini', supportsRefresh: true },
  { id: 'ollama', label: 'Ollama', supportsRefresh: true },
] as const;

type LatencyEvent = { timestamp: string; model: string; provider: string; latencyMs: number };
type AvgLatency = { model: string; provider: string; avgMs: number; count: number };
type TokensPerModel = { provider: string; model: string; totalTokens: number };

type StatsResponse = {
  latencyEvents: LatencyEvent[];
  avgLatencyPerModel: AvgLatency[];
  totalTokens: number;
  tokensPerModel: TokensPerModel[];
};

type SortConfig = {
  key: string;
  direction: 'asc' | 'desc';
};

type ModelSetting = {
  id: number;
  provider_id: string;
  model_id: string;
  display_name: string | null;
  context_length: number | null;
  is_enabled: boolean;
  is_default: boolean;
  skip_system_prompt: boolean;
  source: 'static' | 'api_discovered';
  owned_by: string | null;
  sort_order: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// --- KPI Card ---
function KpiCard({ title, value, subtitle, icon: Icon, color, loading }: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  loading?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-bold tracking-tight">{value}</p>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className={`rounded-lg p-2.5 ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Sortable Row ---
function SortableModelRow({
  model,
  isCustomOrder,
  togglingModels,
  onToggle,
  onToggleSkipSystemPrompt,
  onToggleDefault,
}: {
  model: ModelSetting;
  isCustomOrder: boolean;
  togglingModels: Set<string>;
  onToggle: (modelId: string, enabled: boolean) => void;
  onToggleSkipSystemPrompt: (modelId: string, skip: boolean) => void;
  onToggleDefault: (modelId: string, isDefault: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: model.model_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style} className="group">
      {isCustomOrder && (
        <TableCell className="py-1 w-[40px]">
          <button
            className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-muted touch-none opacity-40 group-hover:opacity-100 transition-opacity"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        </TableCell>
      )}
      <TableCell>
        <Switch
          checked={model.is_enabled}
          disabled={togglingModels.has(model.model_id)}
          onCheckedChange={(checked) => onToggle(model.model_id, checked)}
        />
      </TableCell>
      <TableCell>
        <Switch
          checked={model.skip_system_prompt}
          disabled={togglingModels.has(model.model_id)}
          onCheckedChange={(checked) => onToggleSkipSystemPrompt(model.model_id, checked)}
        />
      </TableCell>
      <TableCell>
        <Switch
          checked={model.is_default}
          disabled={togglingModels.has(model.model_id)}
          onCheckedChange={(checked) => onToggleDefault(model.model_id, checked)}
        />
      </TableCell>
      <TableCell className="font-mono text-sm">{model.model_id}</TableCell>
      <TableCell>{model.display_name || model.model_id}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {model.context_length ? model.context_length.toLocaleString() : '—'}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {formatDate(model.published_at)}
      </TableCell>
      <TableCell>
        <Badge variant={model.source === 'static' ? 'secondary' : 'outline'} className="text-xs">
          {model.source === 'static' ? 'Built-in' : 'Discovered'}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">{model.owned_by || '—'}</TableCell>
    </TableRow>
  );
}

// --- Page ---
export default function StatsPage() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokensSortConfig, setTokensSortConfig] = useState<SortConfig>({ key: 'totalTokens', direction: 'desc' });
  const [latencySortConfig, setLatencySortConfig] = useState<SortConfig>({ key: 'avgMs', direction: 'desc' });

  // Model management state
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [modelSettings, setModelSettings] = useState<ModelSetting[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [togglingModels, setTogglingModels] = useState<Set<string>>(new Set());
  const [modelsSortConfig, setModelsSortConfig] = useState<SortConfig>({ key: 'sort_order', direction: 'asc' });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch('/api/stats')
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load stats');
        return r.json();
      })
      .then((json: StatsResponse) => {
        if (mounted) setData(json);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => setLoading(false));
    return () => { mounted = false; };
  }, []);

  const fetchModelSettings = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const r = await fetch(`/api/admin/models/${selectedProvider}`);
      if (!r.ok) throw new Error('Failed to load model settings');
      const json: ModelSetting[] = await r.json();
      setModelSettings(json);
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setModelsLoading(false);
    }
  }, [selectedProvider]);

  useEffect(() => { fetchModelSettings(); }, [fetchModelSettings]);

  const handleRefreshModels = async () => {
    setRefreshing(true);
    setModelsError(null);
    try {
      const r = await fetch(`/api/admin/models/${selectedProvider}/refresh`, { method: 'POST' });
      if (!r.ok) throw new Error('Failed to refresh models');
      const json = await r.json();
      setModelSettings(json.models);
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleModel = async (modelId: string, enabled: boolean) => {
    setTogglingModels((prev) => new Set(prev).add(modelId));
    try {
      const r = await fetch(`/api/admin/models/${selectedProvider}/${encodeURIComponent(modelId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: enabled }),
      });
      if (!r.ok) throw new Error('Failed to toggle model');
      const updated: ModelSetting = await r.json();
      setModelSettings((prev) => prev.map((m) => (m.model_id === modelId ? updated : m)));
      clearProvidersCache();
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setTogglingModels((prev) => { const next = new Set(prev); next.delete(modelId); return next; });
    }
  };

  const handleToggleSkipSystemPrompt = async (modelId: string, skip: boolean) => {
    setTogglingModels((prev) => new Set(prev).add(modelId));
    try {
      const r = await fetch(`/api/admin/models/${selectedProvider}/${encodeURIComponent(modelId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip_system_prompt: skip }),
      });
      if (!r.ok) throw new Error('Failed to toggle skip system prompt');
      const updated: ModelSetting = await r.json();
      setModelSettings((prev) => prev.map((m) => (m.model_id === modelId ? updated : m)));
      clearProvidersCache();
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setTogglingModels((prev) => { const next = new Set(prev); next.delete(modelId); return next; });
    }
  };

  const handleToggleDefault = async (modelId: string, isDefault: boolean) => {
    setTogglingModels((prev) => new Set(prev).add(modelId));
    try {
      const r = await fetch(`/api/admin/models/${selectedProvider}/${encodeURIComponent(modelId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: isDefault }),
      });
      if (!r.ok) throw new Error('Failed to toggle default');
      const updated: ModelSetting = await r.json();
      setModelSettings((prev) =>
        prev.map((m) => {
          if (m.model_id === modelId) return updated;
          if (isDefault) return { ...m, is_default: false };
          return m;
        }),
      );
      clearProvidersCache();
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setTogglingModels((prev) => { const next = new Set(prev); next.delete(modelId); return next; });
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedModelSettings.findIndex((m) => m.model_id === active.id);
    const newIndex = sortedModelSettings.findIndex((m) => m.model_id === over.id);
    const reordered = arrayMove(sortedModelSettings, oldIndex, newIndex);
    const newModelIds = reordered.map((m) => m.model_id);
    setModelSettings(reordered.map((m, i) => ({ ...m, sort_order: i })));
    try {
      const r = await fetch(`/api/admin/models/${selectedProvider}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_ids: newModelIds }),
      });
      if (!r.ok) throw new Error('Failed to reorder models');
      const updated: ModelSetting[] = await r.json();
      setModelSettings(updated);
      clearProvidersCache();
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Unknown error');
      fetchModelSettings();
    }
  };

  // --- Derived stats ---
  const totalModels = useMemo(() => data?.tokensPerModel?.length || 0, [data]);
  const totalRequests = useMemo(() => {
    if (!data?.avgLatencyPerModel) return 0;
    return data.avgLatencyPerModel.reduce((s, r) => s + r.count, 0);
  }, [data]);
  const avgLatency = useMemo(() => {
    if (!data?.avgLatencyPerModel?.length) return 0;
    const total = data.avgLatencyPerModel.reduce((s, r) => s + r.avgMs * r.count, 0);
    const count = data.avgLatencyPerModel.reduce((s, r) => s + r.count, 0);
    return count ? Math.round(total / count) : 0;
  }, [data]);

  // --- Sorted model settings ---
  const sortedModelSettings = useMemo(() => {
    const sorted = [...modelSettings];
    const { key, direction } = modelsSortConfig;
    sorted.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (key) {
        case 'sort_order':
          aVal = a.sort_order ?? Number.MAX_SAFE_INTEGER;
          bVal = b.sort_order ?? Number.MAX_SAFE_INTEGER;
          if (aVal === bVal) return a.id - b.id;
          break;
        case 'model_id': aVal = a.model_id; bVal = b.model_id; break;
        case 'display_name':
          aVal = (a.display_name || a.model_id).toLowerCase();
          bVal = (b.display_name || b.model_id).toLowerCase();
          break;
        case 'context_length': aVal = a.context_length ?? 0; bVal = b.context_length ?? 0; break;
        case 'source': aVal = a.source; bVal = b.source; break;
        case 'owned_by': aVal = a.owned_by || ''; bVal = b.owned_by || ''; break;
        case 'published_at':
          aVal = a.published_at ? new Date(a.published_at).getTime() : 0;
          bVal = b.published_at ? new Date(b.published_at).getTime() : 0;
          break;
        case 'is_enabled': aVal = a.is_enabled ? 1 : 0; bVal = b.is_enabled ? 1 : 0; break;
        case 'skip_system_prompt': aVal = a.skip_system_prompt ? 1 : 0; bVal = b.skip_system_prompt ? 1 : 0; break;
        case 'is_default': aVal = a.is_default ? 1 : 0; bVal = b.is_default ? 1 : 0; break;
        default: return 0;
      }
      if (typeof aVal === 'string' && typeof bVal === 'string')
        return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [modelSettings, modelsSortConfig]);

  const handleModelsSort = (key: string) => {
    setModelsSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };
  const isCustomOrder = modelsSortConfig.key === 'sort_order';

  // --- Chart data ---
  const models = useMemo(() => {
    if (!data) return [] as string[];
    const s = new Set<string>();
    for (const e of data.latencyEvents) s.add(`${e.provider}:${e.model}`);
    return Array.from(s.values());
  }, [data]);

  const chartConfig = useMemo(() => {
    const palette = [
      'hsl(220 80% 56%)', 'hsl(350 75% 55%)', 'hsl(150 60% 42%)',
      'hsl(38 92% 50%)', 'hsl(270 65% 55%)', 'hsl(185 65% 45%)',
    ];
    const cfg: Record<string, { label: string; color: string }> = {};
    models.forEach((m, i) => {
      const [prov, mod] = m.split(':');
      cfg[m] = { label: `${prov}:${mod}`, color: palette[i % palette.length] };
    });
    return cfg;
  }, [models]);

  const chartData = useMemo(() => {
    if (!data) return [] as any[];
    const byBucket = new Map<string, Record<string, any>>();
    for (const e of data.latencyEvents) {
      const d = new Date(e.timestamp);
      const bucket = new Date(d);
      bucket.setSeconds(0, 0);
      const key = bucket.toISOString();
      const seriesKey = `${e.provider}:${e.model}`;
      const row = byBucket.get(key) || { time: key };
      row[seriesKey] = Math.round(e.latencyMs);
      byBucket.set(key, row);
    }
    return Array.from(byBucket.values()).sort((a, b) => a.time.localeCompare(b.time));
  }, [data]);

  // --- Tokens table ---
  const sortedTokensData = useMemo(() => {
    if (!data?.tokensPerModel) return [];
    return [...data.tokensPerModel].sort((a, b) => {
      let aV: any, bV: any;
      if (tokensSortConfig.key === 'model') {
        aV = `${a.provider}:${a.model}`; bV = `${b.provider}:${b.model}`;
      } else {
        aV = a[tokensSortConfig.key as keyof TokensPerModel];
        bV = b[tokensSortConfig.key as keyof TokensPerModel];
      }
      if (typeof aV === 'string' && typeof bV === 'string')
        return tokensSortConfig.direction === 'asc' ? aV.localeCompare(bV) : bV.localeCompare(aV);
      return tokensSortConfig.direction === 'asc' ? aV - bV : bV - aV;
    });
  }, [data?.tokensPerModel, tokensSortConfig]);

  const maxTokens = useMemo(() => {
    if (!sortedTokensData.length) return 1;
    return Math.max(...sortedTokensData.map((t) => t.totalTokens));
  }, [sortedTokensData]);

  // --- Latency table ---
  const sortedLatencyData = useMemo(() => {
    if (!data?.avgLatencyPerModel) return [];
    return [...data.avgLatencyPerModel].sort((a, b) => {
      let aV: any, bV: any;
      if (latencySortConfig.key === 'model') {
        aV = `${a.provider}:${a.model}`; bV = `${b.provider}:${b.model}`;
      } else {
        aV = a[latencySortConfig.key as keyof AvgLatency];
        bV = b[latencySortConfig.key as keyof AvgLatency];
      }
      if (typeof aV === 'string' && typeof bV === 'string')
        return latencySortConfig.direction === 'asc' ? aV.localeCompare(bV) : bV.localeCompare(aV);
      return latencySortConfig.direction === 'asc' ? aV - bV : bV - aV;
    });
  }, [data?.avgLatencyPerModel, latencySortConfig]);

  const handleTokensSort = (key: string) => {
    setTokensSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };
  const handleLatencySort = (key: string) => {
    setLatencySortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };

  const SortIcon = ({ sortKey, currentSort }: { sortKey: string; currentSort: SortConfig }) => {
    if (currentSort.key !== sortKey) return null;
    return currentSort.direction === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  const ModelSortHeader = ({ sortKey, children, className }: { sortKey: string; children: React.ReactNode; className?: string }) => (
    <TableHead
      className={`cursor-pointer hover:bg-muted/50 select-none ${className || ''}`}
      onClick={() => handleModelsSort(sortKey)}
    >
      <div className={`flex items-center gap-1 ${className?.includes('text-right') ? 'justify-end' : ''}`}>
        <span>{children}</span>
        <SortIcon sortKey={sortKey} currentSort={modelsSortConfig} />
      </div>
    </TableHead>
  );

  const enabledCount = modelSettings.filter((m) => m.is_enabled).length;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
        {/* ─── Header ─── */}
        <div className="border-b bg-background/80 backdrop-blur-lg sticky top-0 z-10">
          <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild className="shrink-0">
                <Link href="/"><ArrowLeft className="h-5 w-5" /></Link>
              </Button>
              <div>
                <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Admin Dashboard
                </h1>
                <p className="text-sm text-muted-foreground">Usage analytics & model management</p>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 space-y-6">
          {/* ─── KPI Cards ─── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Total Tokens"
              value={loading ? '—' : formatNumber(data?.totalTokens || 0)}
              subtitle="Across all models"
              icon={Coins}
              color="bg-blue-500/10 text-blue-500"
              loading={loading}
            />
            <KpiCard
              title="Models Used"
              value={loading ? '—' : String(totalModels)}
              subtitle="Unique model/provider pairs"
              icon={Cpu}
              color="bg-emerald-500/10 text-emerald-500"
              loading={loading}
            />
            <KpiCard
              title="Avg Latency"
              value={loading ? '—' : `${avgLatency.toLocaleString()} ms`}
              subtitle="Weighted across all models"
              icon={Clock}
              color="bg-amber-500/10 text-amber-500"
              loading={loading}
            />
            <KpiCard
              title="Total Requests"
              value={loading ? '—' : formatNumber(totalRequests)}
              subtitle="Assistant responses"
              icon={Activity}
              color="bg-violet-500/10 text-violet-500"
              loading={loading}
            />
          </div>

          {/* ─── Charts Row ─── */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            {/* Latency Chart */}
            <Card className="xl:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Latency Over Time</CardTitle>
                <CardDescription>Response time per model (ms)</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-[300px] w-full" />
                  </div>
                ) : error ? (
                  <div className="text-destructive text-sm py-8 text-center">{error}</div>
                ) : chartData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <BarChart3 className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm">No latency data yet</p>
                    <p className="text-xs mt-1">Send some messages to start tracking</p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
                      {models.map((m) => (
                        <div key={m} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: chartConfig[m]?.color }}
                          />
                          <span className="truncate max-w-[180px]">{chartConfig[m]?.label}</span>
                        </div>
                      ))}
                    </div>
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
                      <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                        <XAxis
                          dataKey="time"
                          tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          minTickGap={40}
                          className="text-xs"
                        />
                        <YAxis tickFormatter={(v) => `${Math.round(Number(v))}`} width={48} className="text-xs" />
                        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                        {models.map((m) => (
                          <Area
                            key={m}
                            type="monotone"
                            dataKey={m}
                            stroke={chartConfig[m]?.color}
                            fill={chartConfig[m]?.color}
                            fillOpacity={0.1}
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </AreaChart>
                    </ChartContainer>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Tokens per Model */}
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Token Usage by Model</CardTitle>
                <CardDescription>Total tokens per model</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="space-y-1.5">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-2.5 w-full" />
                      </div>
                    ))}
                  </div>
                ) : sortedTokensData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Coins className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm">No token usage yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sortedTokensData.map((t) => {
                      const pct = Math.round((t.totalTokens / maxTokens) * 100);
                      return (
                        <div key={`${t.provider}:${t.model}`} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium truncate mr-2">
                              <span className="text-muted-foreground">{t.provider}/</span>{t.model}
                            </span>
                            <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                              {formatNumber(t.totalTokens)}
                            </span>
                          </div>
                          <Progress value={pct} className="h-1.5" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ─── Average Latency Table ─── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Average Latency per Model</CardTitle>
              <CardDescription>Aggregated response times from your history</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : sortedLatencyData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Clock className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">No latency data yet</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead
                          className="cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleLatencySort('model')}
                        >
                          <div className="flex items-center gap-1">
                            <span>Model</span>
                            <SortIcon sortKey="model" currentSort={latencySortConfig} />
                          </div>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer hover:bg-muted/50 select-none text-right"
                          onClick={() => handleLatencySort('avgMs')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>Avg Latency</span>
                            <SortIcon sortKey="avgMs" currentSort={latencySortConfig} />
                          </div>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer hover:bg-muted/50 select-none text-right"
                          onClick={() => handleLatencySort('count')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>Requests</span>
                            <SortIcon sortKey="count" currentSort={latencySortConfig} />
                          </div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedLatencyData.map((r) => (
                        <TableRow key={`${r.provider}:${r.model}`}>
                          <TableCell className="font-medium">
                            <span className="text-muted-foreground">{r.provider}/</span>{r.model}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{Math.round(r.avgMs).toLocaleString()} ms</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{r.count.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ─── Model Management ─── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg p-2 bg-primary/10">
                    <Settings2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Model Management</CardTitle>
                    <CardDescription>
                      {modelSettings.length > 0
                        ? `${enabledCount} of ${modelSettings.length} models enabled`
                        : 'Configure which models appear in the chat selector'}
                    </CardDescription>
                  </div>
                </div>
                {MANAGEABLE_PROVIDERS.find(p => p.id === selectedProvider)?.supportsRefresh && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefreshModels}
                        disabled={refreshing}
                      >
                        {refreshing ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Refresh
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Discover new models from the provider API</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Tabs value={selectedProvider} onValueChange={setSelectedProvider} className="mb-4">
                <TabsList className="w-full justify-start">
                  {MANAGEABLE_PROVIDERS.map((p) => (
                    <TabsTrigger key={p.id} value={p.id} className="text-xs sm:text-sm">{p.label}</TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {modelsLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : modelsError ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
                  {modelsError}
                </div>
              ) : modelSettings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground rounded-md border border-dashed">
                  <Cpu className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm font-medium">No models configured</p>
                  <p className="text-xs mt-1 mb-4">Click Refresh to discover models from the provider API</p>
                  <Button variant="outline" size="sm" onClick={handleRefreshModels} disabled={refreshing}>
                    {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Refresh Models
                  </Button>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          {isCustomOrder && <TableHead className="w-[40px]" />}
                          <ModelSortHeader sortKey="is_enabled" className="w-[80px]">Enabled</ModelSortHeader>
                          <ModelSortHeader sortKey="skip_system_prompt" className="w-[100px]">Skip Prompt</ModelSortHeader>
                          <ModelSortHeader sortKey="is_default" className="w-[80px]">Default</ModelSortHeader>
                          <ModelSortHeader sortKey="model_id">Model ID</ModelSortHeader>
                          <ModelSortHeader sortKey="display_name">Display Name</ModelSortHeader>
                          <ModelSortHeader sortKey="context_length" className="text-right">Context</ModelSortHeader>
                          <ModelSortHeader sortKey="published_at">Published</ModelSortHeader>
                          <ModelSortHeader sortKey="source">Source</ModelSortHeader>
                          <ModelSortHeader sortKey="owned_by">Owner</ModelSortHeader>
                        </TableRow>
                      </TableHeader>
                      <SortableContext
                        items={sortedModelSettings.map((m) => m.model_id)}
                        strategy={verticalListSortingStrategy}
                        disabled={!isCustomOrder}
                      >
                        <TableBody>
                          {sortedModelSettings.map((m) => (
                            <SortableModelRow
                              key={m.model_id}
                              model={m}
                              isCustomOrder={isCustomOrder}
                              togglingModels={togglingModels}
                              onToggle={handleToggleModel}
                              onToggleSkipSystemPrompt={handleToggleSkipSystemPrompt}
                              onToggleDefault={handleToggleDefault}
                            />
                          ))}
                        </TableBody>
                      </SortableContext>
                    </Table>
                  </div>
                </DndContext>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}
