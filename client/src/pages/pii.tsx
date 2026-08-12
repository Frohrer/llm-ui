import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';

type PiiEntity = {
  id: number;
  value: string;
  type: string;
  tag: string;
  status: 'active' | 'false_positive' | 'allowlisted';
  source: 'regex' | 'classifier' | 'manual';
  created_at: string;
  updated_at: string;
};

type PiiSettings = {
  id: number;
  enabled: boolean;
  classifier_enabled: boolean;
  classifier_model: string;
};

const ENTITY_TYPES = ['name', 'email', 'phone', 'ssn', 'credit_card', 'ip', 'address', 'custom'];

const STATUS_META: Record<PiiEntity['status'], { label: string; className: string }> = {
  active: { label: 'Redacted', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  false_positive: { label: 'False positive', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' },
  allowlisted: { label: 'Allowlisted', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PiiPage() {
  const [settings, setSettings] = useState<PiiSettings | null>(null);
  const [entities, setEntities] = useState<PiiEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | PiiEntity['status']>('all');

  // Add-entity form
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState('name');
  const [newStatus, setNewStatus] = useState<'active' | 'allowlisted'>('active');
  const [adding, setAdding] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [settingsRes, entitiesRes] = await Promise.all([
        fetch('/api/admin/pii/settings'),
        fetch('/api/admin/pii/entities'),
      ]);
      if (settingsRes.ok) setSettings(await settingsRes.json());
      if (entitiesRes.ok) setEntities(await entitiesRes.json());
    } catch (err) {
      console.error('Failed to load PII data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const updateSettings = async (patch: Partial<PiiSettings>) => {
    if (!settings) return;
    // Optimistic update; server response is authoritative
    setSettings({ ...settings, ...patch });
    setSaving(true);
    try {
      const r = await fetch('/api/admin/pii/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (r.ok) setSettings(await r.json());
    } catch (err) {
      console.error('Failed to update PII settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const addEntity = async () => {
    const value = newValue.trim();
    if (!value) return;
    setAdding(true);
    try {
      const r = await fetch('/api/admin/pii/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, type: newType, status: newStatus }),
      });
      if (r.ok) {
        const entity = await r.json();
        setEntities((prev) => [entity, ...prev.filter((e) => e.id !== entity.id)]);
        setNewValue('');
      }
    } catch (err) {
      console.error('Failed to add PII entity:', err);
    } finally {
      setAdding(false);
    }
  };

  const setEntityStatus = async (id: number, status: PiiEntity['status']) => {
    try {
      const r = await fetch(`/api/admin/pii/entities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (r.ok) {
        const updated = await r.json();
        setEntities((prev) => prev.map((e) => (e.id === id ? updated : e)));
      }
    } catch (err) {
      console.error('Failed to update PII entity:', err);
    }
  };

  const deleteEntity = async (id: number) => {
    try {
      const r = await fetch(`/api/admin/pii/entities/${id}`, { method: 'DELETE' });
      if (r.ok) setEntities((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Failed to delete PII entity:', err);
    }
  };

  const filtered = useMemo(
    () => (statusFilter === 'all' ? entities : entities.filter((e) => e.status === statusFilter)),
    [entities, statusFilter],
  );

  const counts = useMemo(() => ({
    all: entities.length,
    active: entities.filter((e) => e.status === 'active').length,
    false_positive: entities.filter((e) => e.status === 'false_positive').length,
    allowlisted: entities.filter((e) => e.status === 'allowlisted').length,
  }), [entities]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">PII Redaction</h1>
          </div>
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settings</CardTitle>
            <CardDescription>
              When enabled, entries marked "Redacted" are replaced with stable tags (e.g.{' '}
              <code className="text-xs">[PII_NAME_4]</code>) before any request leaves for an
              upstream LLM. Tags are converted back to the real values locally — in the chat
              stream, the database, and tool executions. Allowlisted terms stay visible to the
              model so it can reason with them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Enable PII redaction</p>
                <p className="text-xs text-muted-foreground">
                  Structured PII (emails, phone numbers, SSNs, credit cards, public IPs) is
                  auto-detected and redacted on first sight.
                </p>
              </div>
              <Switch
                checked={settings?.enabled ?? false}
                disabled={loading}
                onCheckedChange={(v) => updateSettings({ enabled: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Person-name classifier (local NER model)</p>
                <p className="text-xs text-muted-foreground">
                  A small on-device NER model (~65MB, CPU, downloaded once) detects person
                  names inline — before each request leaves — so new names are redacted on
                  first sight, including names surfacing from memory. Runs in-process;
                  nothing leaves this machine. Cities and organizations are ignored so the
                  LLM can still use them for inference.
                </p>
              </div>
              <Switch
                checked={settings?.classifier_enabled ?? false}
                disabled={loading || !settings?.enabled}
                onCheckedChange={(v) => updateSettings({ classifier_enabled: v })}
              />
            </div>
            {settings?.classifier_enabled && (
              <div className="flex items-center gap-3">
                <Label htmlFor="classifier-model" className="text-sm shrink-0">Classifier model</Label>
                <Input
                  id="classifier-model"
                  className="max-w-xs"
                  defaultValue={settings.classifier_model}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== settings.classifier_model) updateSettings({ classifier_model: v });
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add entry</CardTitle>
            <CardDescription>
              Add PII the detectors can't know (e.g. your name) as "Redact", or pre-approve terms
              the LLM should see for inference (e.g. "Philadelphia") as "Allowlist".
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="Value (e.g. Jane Doe)"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addEntity()}
                className="sm:max-w-xs"
              />
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={newStatus} onValueChange={(v) => setNewStatus(v as 'active' | 'allowlisted')}>
                <SelectTrigger className="sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Redact</SelectItem>
                  <SelectItem value="allowlisted">Allowlist</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={addEntity} disabled={adding || !newValue.trim()} className="gap-2">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">Dictionary</CardTitle>
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <TabsList>
                <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                <TabsTrigger value="active">Redacted ({counts.active})</TabsTrigger>
                <TabsTrigger value="false_positive">False positives ({counts.false_positive})</TabsTrigger>
                <TabsTrigger value="allowlisted">Allowlisted ({counts.allowlisted})</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No entries{statusFilter !== 'all' ? ' with this status' : ' yet — detected PII and manual entries appear here'}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Value</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Tag</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium max-w-[200px] truncate" title={e.value}>
                          {e.value}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{e.type.replace('_', ' ')}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          [{e.tag}]
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_META[e.status].className} variant="outline">
                            {STATUS_META[e.status].label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.source}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(e.created_at)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {e.status !== 'active' && (
                            <Button
                              variant="ghost" size="sm" className="h-7 px-2 text-xs"
                              onClick={() => setEntityStatus(e.id, 'active')}
                            >
                              Redact
                            </Button>
                          )}
                          {e.status !== 'false_positive' && (
                            <Button
                              variant="ghost" size="sm" className="h-7 px-2 text-xs"
                              onClick={() => setEntityStatus(e.id, 'false_positive')}
                            >
                              False positive
                            </Button>
                          )}
                          {e.status !== 'allowlisted' && (
                            <Button
                              variant="ghost" size="sm" className="h-7 px-2 text-xs"
                              onClick={() => setEntityStatus(e.id, 'allowlisted')}
                            >
                              Allowlist
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                            title="Delete permanently (old tags in model context will stop resolving)"
                            onClick={() => deleteEntity(e.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
