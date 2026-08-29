import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Brain, Loader2, Pin, Trash2 } from 'lucide-react';

type Memory = {
  id: number;
  kind: 'preference' | 'fact' | 'decision' | 'open_thread' | 'entity';
  body: string;
  pinned: boolean;
  use_count: number;
  created_at: string;
  source_conversation_id: number | null;
  source_conversation_title: string | null;
};

const KIND_LABELS: Record<Memory['kind'], string> = {
  preference: 'preference',
  fact: 'fact',
  decision: 'decision',
  open_thread: 'open thread',
  entity: 'entity',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function MemoryPage() {
  const [items, setItems] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [wiping, setWiping] = useState(false);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | Memory['kind']>('all');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/memory');
      if (r.ok) setItems(await r.json());
    } catch (err) {
      console.error('Failed to load memories:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const deleteOne = async (id: number) => {
    setDeletingId(id);
    try {
      const r = await fetch(`/api/memory/${id}`, { method: 'DELETE' });
      if (r.ok) setItems((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error('Failed to delete memory:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const deleteAll = async () => {
    if (!window.confirm(`Permanently delete all ${items.length} memories? This cannot be undone.`)) {
      return;
    }
    setWiping(true);
    try {
      const r = await fetch('/api/memory', { method: 'DELETE' });
      if (r.ok) setItems([]);
    } catch (err) {
      console.error('Failed to delete all memories:', err);
    } finally {
      setWiping(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (m) =>
        (kindFilter === 'all' || m.kind === kindFilter) &&
        (!q || m.body.toLowerCase().includes(q)),
    );
  }, [items, search, kindFilter]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Memory</h1>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1 min-w-[240px] space-y-1.5">
                <CardTitle className="text-base">
                  Saved memories{!loading && ` (${items.length})`}
                </CardTitle>
                <CardDescription>
                  Facts distilled from your past conversations and recalled in future ones.
                  Deleting a memory removes it permanently — the assistant will no longer
                  see it in any chat.
                </CardDescription>
              </div>
              {items.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={deleteAll}
                  disabled={wiping}
                  className="gap-2"
                >
                  {wiping ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Forget everything
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="Search memories…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as typeof kindFilter)}>
                <SelectTrigger className="sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All kinds</SelectItem>
                  {(Object.keys(KIND_LABELS) as Memory['kind'][]).map((k) => (
                    <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {items.length === 0
                  ? 'No memories yet — they accumulate as you chat.'
                  : 'No memories match the current filter.'}
              </p>
            ) : (
              <ul className="divide-y">
                {filtered.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm">{m.body}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <Badge variant="outline">{KIND_LABELS[m.kind]}</Badge>
                        {m.pinned && (
                          <Badge variant="outline" className="gap-1">
                            <Pin className="h-3 w-3" />
                            pinned
                          </Badge>
                        )}
                        <span>{formatDate(m.created_at)}</span>
                        {m.use_count > 0 && <span>· recalled {m.use_count}×</span>}
                        {m.source_conversation_title && (
                          <span className="truncate max-w-[240px]" title={m.source_conversation_title}>
                            · from “{m.source_conversation_title}”
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive"
                      title="Delete this memory permanently"
                      disabled={deletingId === m.id}
                      onClick={() => deleteOne(m.id)}
                    >
                      {deletingId === m.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
