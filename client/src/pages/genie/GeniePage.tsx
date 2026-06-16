import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Skeleton,
  Textarea,
} from '@databricks/appkit-ui/react';
import { AlertCircle, Copy, Loader2, MapPin, RotateCcw, Search, ShieldQuestion, Stethoscope } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';

interface ReferralResult {
  query: string;
  content: string;
  conversationId?: string;
  messageId?: string;
  statuses: string[];
  queries: ReferralQuery[];
  tables: ReferralTable[];
  errors: string[];
  generatedAt: string;
}

interface ReferralQuery {
  title?: string;
  description?: string;
  query?: string;
  statementId?: string;
}

interface ReferralTable {
  attachmentId: string;
  statementId: string;
  columns: string[];
  rows: Array<Record<string, string | null>>;
}

const EXAMPLE_PROMPTS = [
  'dialysis near Jaipur',
  'emergency surgery near Patna',
  'neonatal ICU near Lucknow',
  'cardiology near Pune',
] as const;

const DEFAULT_QUERY: string = EXAMPLE_PROMPTS[0];

export function GeniePage() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<ReferralResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evidenceTableCount = result?.tables.filter((table) => table.rows.length > 0).length ?? 0;
  const statusText = useMemo(() => formatStatuses(result?.statuses ?? []), [result?.statuses]);

  async function runReferralSearch(nextQuery = query) {
    const trimmedQuery = nextQuery.trim();
    if (!trimmedQuery) {
      setError('Enter a care need and location, such as dialysis near Jaipur.');
      return;
    }

    setQuery(trimmedQuery);
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch('/api/genie/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ query: trimmedQuery }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `Referral Copilot failed with HTTP ${response.status}`));
      }
      if (!isReferralResult(payload)) {
        throw new Error('Referral Copilot returned an unexpected response.');
      }
      setResult(payload);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Referral Copilot is taking longer than expected. Try a narrower request, such as dialysis near Jaipur.');
      } else {
        setError(err instanceof Error ? err.message : 'Referral Copilot could not complete the request.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runReferralSearch();
  }

  function handleExample(example: string) {
    void runReferralSearch(example);
  }

  async function copyResult() {
    if (!result?.content) {
      return;
    }
    await navigator.clipboard.writeText(result.content);
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Stethoscope className="h-3.5 w-3.5" />
            Genie agent
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <ShieldQuestion className="h-3.5 w-3.5" />
            Evidence required
          </Badge>
        </div>
        <h2 className="text-2xl font-bold text-foreground">Referral Copilot</h2>
        <p className="text-sm text-muted-foreground">Where should a patient or coordinator actually go?</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" />
            Search care need and location
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="referral-query">Care need</Label>
              <Textarea
                id="referral-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-24 resize-y"
                placeholder="dialysis near Jaipur"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((example) => (
                  <Button
                    key={example}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleExample(example)}
                    disabled={loading}
                  >
                    {example}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setQuery(DEFAULT_QUERY);
                    setResult(null);
                    setError(null);
                  }}
                  disabled={loading}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {loading ? 'Searching' : 'Find referrals'}
                </Button>
              </div>
            </div>
          </form>
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">Evidence-attached shortlist</CardTitle>
              {result && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {result.query}
                  {statusText ? ` · ${statusText}` : ''}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {result && evidenceTableCount > 0 && (
                <Badge variant="outline">
                  {evidenceTableCount} evidence {evidenceTableCount === 1 ? 'table' : 'tables'}
                </Badge>
              )}
              {result && (
                <Button type="button" variant="outline" size="sm" onClick={() => void copyResult()}>
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching the configured Genie space. This can take a moment while Genie checks the facilities table.
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          )}
          {!loading && !result && (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              Try one of the examples above or enter a care need with an Indian city.
            </div>
          )}
          {!loading && result && (
            <div className="space-y-5">
              <div className="whitespace-pre-wrap rounded-md border bg-muted/20 p-4 text-sm leading-6 text-foreground">
                {result.content}
              </div>
              {result.errors.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{result.errors.join(' ')}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {result && result.tables.length > 0 && (
        <div className="grid gap-4">
          {result.tables.map((table, index) => (
            <EvidenceTable
              key={`${table.attachmentId}-${table.statementId}`}
              table={table}
              query={result.queries[index]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceTable({ table, query }: { table: ReferralTable; query?: ReferralQuery }) {
  if (table.rows.length === 0) {
    return null;
  }

  const visibleColumns = table.columns.slice(0, 8);

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{query?.title || 'Genie evidence'}</CardTitle>
        {query?.description && <p className="text-sm text-muted-foreground">{query.description}</p>}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                {visibleColumns.map((column) => (
                  <th key={column} className="px-3 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, 8).map((row) => {
                const rowKey = visibleColumns.map((column) => row[column] ?? '').join('|') || table.statementId;
                return (
                  <tr key={`${table.attachmentId}-${rowKey}`} className="border-t">
                    {visibleColumns.map((column) => (
                      <td key={column} className="max-w-64 px-3 py-2 align-top text-muted-foreground">
                        <span className="line-clamp-3">{formatCell(row[column])}</span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function formatStatuses(statuses: string[]) {
  if (statuses.length === 0) {
    return '';
  }
  return statuses
    .map((status) => status.toLowerCase().replace(/_/g, ' '))
    .filter((status, index, all) => all.indexOf(status) === index)
    .join(', ');
}

function formatCell(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return 'Missing';
  }
  return value;
}

function getErrorMessage(value: unknown, fallback: string) {
  if (isRecord(value) && typeof value.error === 'string') {
    return value.error;
  }
  return fallback;
}

function isReferralResult(value: unknown): value is ReferralResult {
  return (
    isRecord(value) &&
    typeof value.query === 'string' &&
    typeof value.content === 'string' &&
    Array.isArray(value.statuses) &&
    Array.isArray(value.queries) &&
    Array.isArray(value.tables) &&
    Array.isArray(value.errors) &&
    typeof value.generatedAt === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
