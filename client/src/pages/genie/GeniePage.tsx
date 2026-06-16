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
import { AlertCircle, Loader2, MapPin, Network, RotateCcw, Search, ShieldQuestion } from 'lucide-react';
import { useState } from 'react';
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
  plan?: ReferralPlan;
  engine?: {
    genieMode?: string;
    planner?: string;
  };
  generatedAt: string;
}

interface ReferralPlan {
  careNeed: string;
  primaryLocation: string;
  careTerms: string[];
  nearbyLocations: string[];
  urgency: 'routine' | 'urgent_or_emergency' | 'unknown';
  source: 'llm' | 'fallback';
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

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Network className="h-3.5 w-3.5" />
            MCP Genie
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
              <CardTitle className="text-base">Search expansion</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Planning care and location terms, then querying the configured Genie space through MCP.
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
            <>
              {result.plan && <ReferralPlanSummary plan={result.plan} />}
            </>
          )}
        </CardContent>
      </Card>

      {result && result.tables.length > 0 && (
        <div className="grid min-w-0 gap-4">
          {result.tables.map((table, index) => (
            <EvidenceTable
              key={`${table.attachmentId}-${table.statementId}`}
              table={table}
              query={result.queries[index]}
              plan={result.plan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReferralPlanSummary({ plan }: { plan: ReferralPlan }) {
  const careTerms = plan.careTerms.slice(0, 8);
  const locations = plan.nearbyLocations.slice(0, 8);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-md border bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">Care expansion</p>
          <Badge variant="outline">{plan.careNeed}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {careTerms.map((term) => (
            <Badge key={term} variant="secondary">
              {term}
            </Badge>
          ))}
        </div>
      </div>
      <div className="rounded-md border bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">Location expansion</p>
          <Badge variant="outline">{plan.primaryLocation}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {locations.map((location) => (
            <Badge key={location} variant="secondary">
              {location}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function EvidenceTable({ table, query, plan }: { table: ReferralTable; query?: ReferralQuery; plan?: ReferralPlan }) {
  if (table.rows.length === 0) {
    return null;
  }

  const visibleColumns = table.columns.slice(0, 8);
  const evidenceTerms = getEvidenceTerms(plan);
  const rankedRows = rankFacilityRows(table.rows, evidenceTerms).slice(0, 8);

  return (
    <Card className="min-w-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{query?.title || 'List of Facilities'}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <FacilityRankTable rows={rankedRows} />
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-full min-w-[960px] table-fixed text-sm">
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
              {rankedRows.map(({ row, key }) => {
                const rowKey = visibleColumns.map((column) => row[column] ?? '').join('|') || table.statementId;
                return (
                  <tr key={`${table.attachmentId}-${key}-${rowKey}`} className="border-t">
                    {visibleColumns.map((column) => (
                      <td key={column} className="break-words px-3 py-2 align-top text-muted-foreground">
                        {renderCell(row[column], evidenceTerms)}
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

interface RankedFacilityRow {
  row: Record<string, string | null>;
  key: string;
  score: number;
  careMatches: number;
  locationMatches: number;
  strength: 'Strong' | 'Moderate' | 'Weak';
}

interface EvidenceTerm {
  value: string;
  kind: 'care' | 'location';
}

function FacilityRankTable({ rows }: { rows: RankedFacilityRow[] }) {
  return (
    <div className="rounded-md border">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="w-16 px-3 py-2 font-medium">Rank</th>
            <th className="px-3 py-2 font-medium">Facility</th>
            <th className="w-36 px-3 py-2 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((rankedRow, position) => (
            <tr key={`rank-${rankedRow.key}`} className="border-t">
              <td className="px-3 py-2 text-muted-foreground">{position + 1}</td>
              <td className="break-words px-3 py-2 font-medium text-foreground">{getFacilityName(rankedRow.row)}</td>
              <td className="px-3 py-2">
                <Badge variant="outline" className={getStrengthClass(rankedRow.strength)}>
                  {rankedRow.strength}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(value: string | null | undefined, evidenceTerms: EvidenceTerm[]) {
  const listItems = parseListCell(value);
  if (listItems) {
    return (
      <div className="flex flex-wrap gap-1">
        {listItems.map((item) => (
          <Badge
            key={item}
            variant="outline"
            className={`max-w-full whitespace-normal rounded-none break-words px-1.5 py-0 text-left text-[11px] font-normal ${getEvidenceHighlightClass(item, evidenceTerms)}`}
          >
            {item}
          </Badge>
        ))}
      </div>
    );
  }

  return <span className="block whitespace-pre-wrap break-words">{renderHighlightedText(formatScalarCell(value), evidenceTerms)}</span>;
}

function formatScalarCell(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return 'Missing';
  }
  return value;
}

function parseListCell(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }

  const parsedItems = parseJsonList(trimmed) ?? parsePythonList(trimmed);
  const cleanedItems = parsedItems.map(cleanListItem).filter((item): item is string => Boolean(item));
  const uniqueItems = Array.from(new Set(cleanedItems));

  return uniqueItems.length > 0 ? uniqueItems : null;
}

function parseJsonList(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed
      .map((item) => {
        if (item === null || item === undefined) {
          return '';
        }
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          return String(item);
        }
        return JSON.stringify(item);
      })
      .filter(Boolean);
  } catch {
    return null;
  }
}

function parsePythonList(value: string) {
  const inner = value.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  const quotedItems = Array.from(inner.matchAll(/'([^']*)'|"([^"]*)"/g), (match) => match[1] ?? match[2] ?? '');
  if (quotedItems.length > 0) {
    return quotedItems;
  }

  return inner.split(',');
}

function cleanListItem(value: string) {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned || cleaned.toLowerCase() === 'null' || cleaned.toLowerCase() === 'none') {
    return null;
  }
  return cleaned;
}

function getEvidenceTerms(plan: ReferralPlan | undefined): EvidenceTerm[] {
  if (!plan) {
    return [];
  }

  const terms = [
    ...plan.careTerms.map((value) => ({ value, kind: 'care' as const })),
    ...plan.nearbyLocations.map((value) => ({ value, kind: 'location' as const })),
  ];
  const seen = new Set<string>();

  return terms.filter((term) => {
    const key = normalizeEvidenceText(term.value);
    if (!key || key.length < 3 || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function rankFacilityRows(rows: Array<Record<string, string | null>>, evidenceTerms: EvidenceTerm[]): RankedFacilityRow[] {
  return rows
    .map((row) => {
      const careMatches = countEvidenceMatches(row, evidenceTerms, 'care');
      const locationMatches = countEvidenceMatches(row, evidenceTerms, 'location');
      const score = careMatches * 3 + locationMatches;

      return {
        row,
        key: getFacilityKey(row),
        score,
        careMatches,
        locationMatches,
        strength: getEvidenceStrength(careMatches, locationMatches),
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.careMatches !== left.careMatches) {
        return right.careMatches - left.careMatches;
      }
      return getFacilityName(left.row).localeCompare(getFacilityName(right.row));
    });
}

function countEvidenceMatches(row: Record<string, string | null>, evidenceTerms: EvidenceTerm[], kind: EvidenceTerm['kind']) {
  const rowText = normalizeEvidenceText(Object.values(row).filter(Boolean).join(' '));

  return evidenceTerms.filter((term) => {
    if (term.kind !== kind) {
      return false;
    }

    const normalizedTerm = normalizeEvidenceText(term.value);
    return normalizedTerm && rowText.includes(normalizedTerm);
  }).length;
}

function getEvidenceStrength(careMatches: number, locationMatches: number): RankedFacilityRow['strength'] {
  if (careMatches >= 2 && locationMatches >= 1) {
    return 'Strong';
  }

  if (careMatches >= 1) {
    return 'Moderate';
  }

  return 'Weak';
}

function getStrengthClass(strength: RankedFacilityRow['strength']) {
  if (strength === 'Strong') {
    return 'border-emerald-300 bg-emerald-50 text-emerald-900';
  }

  if (strength === 'Moderate') {
    return 'border-amber-300 bg-amber-50 text-amber-900';
  }

  return 'border-muted bg-muted/40 text-muted-foreground';
}

function getFacilityName(row: Record<string, string | null>) {
  return row.name ?? row.facility_name ?? 'Unnamed facility';
}

function getFacilityKey(row: Record<string, string | null>) {
  const fingerprint = Object.values(row).join('|');
  return `${getFacilityName(row)}-${hashText(fingerprint)}`;
}

function hashText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function getEvidenceHighlightClass(value: string, evidenceTerms: EvidenceTerm[]) {
  const match = findEvidenceMatch(value, evidenceTerms);
  if (!match) {
    return '';
  }

  return match.kind === 'location'
    ? 'rounded-none border-sky-300 bg-sky-50 text-sky-900'
    : 'rounded-none border-emerald-300 bg-emerald-50 text-emerald-900';
}

function renderHighlightedText(value: string, evidenceTerms: EvidenceTerm[]) {
  const terms = evidenceTerms
    .map((term) => term.value.trim())
    .filter((term) => term.length >= 3)
    .sort((left, right) => right.length - left.length);

  if (terms.length === 0) {
    return value;
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = value.split(pattern);
  const renderedParts = [];
  let cursor = 0;

  for (const part of parts) {
    if (!part) {
      continue;
    }

    const start = value.toLowerCase().indexOf(part.toLowerCase(), cursor);
    const keyStart = start === -1 ? cursor : start;
    cursor = keyStart + part.length;
    const match = findEvidenceMatch(part, evidenceTerms, true);
    if (!match) {
      renderedParts.push(part);
      continue;
    }

    const className =
      match.kind === 'location'
        ? 'bg-sky-100 px-1 text-sky-950'
        : 'bg-emerald-100 px-1 text-emerald-950';

    renderedParts.push(
      <mark key={`${keyStart}-${part}`} className={className}>
        {part}
      </mark>,
    );
  }

  return renderedParts;
}

function findEvidenceMatch(value: string, evidenceTerms: EvidenceTerm[], exact = false) {
  const normalizedValue = normalizeEvidenceText(value);
  if (!normalizedValue) {
    return null;
  }

  return (
    evidenceTerms.find((term) => {
      const normalizedTerm = normalizeEvidenceText(term.value);
      if (!normalizedTerm) {
        return false;
      }

      return exact
        ? normalizedValue === normalizedTerm
        : normalizedValue.includes(normalizedTerm) || normalizedTerm.includes(normalizedValue);
    }) ?? null
  );
}

function normalizeEvidenceText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
