import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

type LatencyEvent = { timestamp: string; model: string; provider: string; latencyMs: number };
type AvgLatency = { model: string; provider: string; avgMs: number; count: number };
type TokensPerModel = { provider: string; model: string; totalTokens: number };

type StatsResponse = {
  latencyEvents: LatencyEvent[];
  avgLatencyPerModel: AvgLatency[];
  totalTokens: number;
  tokensPerModel: TokensPerModel[];
};

export default function StatsPage() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    return () => {
      mounted = false;
    };
  }, []);

  const models = useMemo(() => {
    if (!data) return [] as string[];
    const s = new Set<string>();
    for (const e of data.latencyEvents) s.add(`${e.provider}:${e.model}`);
    return Array.from(s.values());
  }, [data]);

  const chartConfig = useMemo(() => {
    // Assign deterministic colors
    const palette = [
      'hsl(220 80% 50%)',
      'hsl(0 80% 50%)',
      'hsl(140 70% 40%)',
      'hsl(45 90% 50%)',
      'hsl(280 70% 50%)',
      'hsl(190 70% 45%)',
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
    // Bucket by minute for smoother lines
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

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-semibold">Statistics</h1>
        <Button asChild variant="outline"><Link href="/">Back to Chat</Link></Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Total Tokens</CardTitle>
            <CardDescription>Sum of assistant tokens across all models</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{loading ? '…' : (data?.totalTokens?.toLocaleString() || '0')}</div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tokens per Model</CardTitle>
            <CardDescription>Total tokens grouped by provider and model</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-muted-foreground">Loading…</div>
            ) : error ? (
              <div className="text-destructive">{error}</div>
            ) : (
              <div className="space-y-2">
                {data?.tokensPerModel?.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    {data.tokensPerModel.map((t) => (
                      <div key={`${t.provider}:${t.model}`} className="flex items-center justify-between border rounded-md px-3 py-2">
                        <div className="text-sm font-medium">{t.provider}:{t.model}</div>
                        <div className="font-mono">{t.totalTokens.toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground">No data</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Latency over Time</CardTitle>
          <CardDescription>Latency between user message and assistant reply, per model</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="text-destructive">{error}</div>
          ) : (
            <ChartContainer config={chartConfig} className="h-[360px] w-full">
              <AreaChart data={chartData} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  minTickGap={32}
                />
                <YAxis
                  tickFormatter={(v) => `${Math.round(Number(v))}ms`}
                  width={60}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                {models.map((m) => (
                  <Area
                    key={m}
                    type="monotone"
                    dataKey={m}
                    stroke={chartConfig[m]?.color}
                    fill={chartConfig[m]?.color}
                    fillOpacity={0.15}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
                <ChartLegend verticalAlign="top" content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Average Latency per Model</CardTitle>
            <CardDescription>Aggregated over your history</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-muted-foreground">Loading…</div>
            ) : error ? (
              <div className="text-destructive">{error}</div>
            ) : data?.avgLatencyPerModel?.length ? (
              <div className="space-y-2">
                {data.avgLatencyPerModel.map((r) => (
                  <div key={`${r.provider}:${r.model}`} className="flex items-center justify-between border rounded-md px-3 py-2">
                    <div className="text-sm font-medium">{r.provider}:{r.model}</div>
                    <div className="font-mono">{r.avgMs.toLocaleString()} ms</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

