import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@databricks/appkit-ui/react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  MapPin,
  Pencil,
  RefreshCw,
  Save,
  Search,
  ShieldQuestion,
  Star,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface SummaryMetrics {
  total_records?: number | string;
  high_priority_records?: number | string;
  queued_records?: number | string;
  reviewed_records?: number | string;
  shortlisted_records?: number | string;
  corrected_records?: number | string;
  proposed_corrections?: number | string;
  active_corrections?: number | string;
  weak_source_records?: number | string;
  average_risk_score?: number | string;
}

interface FieldProfile {
  field_name: string;
  present_count: number | string;
  corrected_count?: number | string;
  coverage_pct: number | string;
}

interface IssueDefinition {
  code: string;
  label: string;
  explanation: string;
}

interface EvidenceSnippet {
  field: string;
  text: string;
  corrected?: boolean;
}

interface ReviewState {
  status: ReviewStatus;
  note: string;
  shortlisted: boolean;
  priorityOverride: PriorityOverride;
  reviewer?: string;
  updatedAt?: string;
}

interface FacilityCorrection {
  fieldName: CorrectableFieldName;
  originalValue: string;
  correctedValue: string;
  status: CorrectionStatus;
  reason: string;
  evidenceNote: string;
  reviewer?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface CorrectableValue {
  original: string;
  effective: string;
  hasCorrection: boolean;
}

interface ReadinessRecord {
  id: string;
  name: string;
  location: string;
  facilityType: string;
  operatorType: string;
  riskScore: number;
  priority: string;
  uncertainty: string;
  issueCodes: string[];
  issues: IssueDefinition[];
  metrics: {
    missingCoreCount: number;
    sourceCount: number;
    evidenceChars: number;
    highAcuityClaim: boolean;
    weakSourceSupport: boolean;
    proposedCorrectionCount: number;
    approvedCorrectionCount: number;
    activeCorrectionCount: number;
  };
  details: {
    numberDoctors?: string;
    capacity?: string;
    yearEstablished?: string;
    officialPhone?: string;
    email?: string;
    officialWebsite?: string;
    recencyOfPageUpdate?: string;
    latestSocialPost?: string;
    latitude?: number | string | null;
    longitude?: number | string | null;
  };
  evidence: EvidenceSnippet[];
  values: Record<CorrectableFieldName, CorrectableValue>;
  corrections: FacilityCorrection[];
  review: ReviewState;
}

interface SummaryResponse {
  metrics: SummaryMetrics;
  fields: FieldProfile[];
  issues: IssueDefinition[];
  correctionFields?: CorrectionFieldOption[];
}

type ReviewStatus = 'unreviewed' | 'needs_review' | 'fix_needed' | 'verified' | 'not_relevant';
type PriorityOverride = 'none' | 'low' | 'medium' | 'high' | 'critical';
type CorrectionStatus = 'proposed' | 'approved' | 'rejected' | 'applied';
type CorrectableFieldName =
  | 'name'
  | 'facilityTypeId'
  | 'operatorTypeId'
  | 'address_city'
  | 'address_stateOrRegion'
  | 'address_zipOrPostcode'
  | 'description'
  | 'capability'
  | 'procedure'
  | 'equipment'
  | 'specialties'
  | 'source_urls'
  | 'numberDoctors'
  | 'capacity'
  | 'yearEstablished'
  | 'officialPhone'
  | 'email'
  | 'officialWebsite';

interface CorrectionFieldOption {
  name: CorrectableFieldName;
  label: string;
}

interface CorrectionDraft {
  fieldName: CorrectableFieldName;
  correctedValue: string;
  status: CorrectionStatus;
  reason: string;
  evidenceNote: string;
}

const REVIEW_STATUS_OPTIONS: Array<{ value: ReviewStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All decisions' },
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'fix_needed', label: 'Fix needed' },
  { value: 'verified', label: 'Verified' },
  { value: 'not_relevant', label: 'Not relevant' },
];

const DECISION_OPTIONS: Array<{ value: ReviewStatus; label: string }> = [
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'fix_needed', label: 'Fix needed' },
  { value: 'verified', label: 'Verified' },
  { value: 'not_relevant', label: 'Not relevant' },
];

const PRIORITY_OPTIONS: Array<{ value: PriorityOverride; label: string }> = [
  { value: 'none', label: 'Use score' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const CORRECTION_STATUS_OPTIONS: Array<{ value: CorrectionStatus; label: string }> = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'applied', label: 'Applied' },
];

const CORRECTABLE_FIELDS: CorrectionFieldOption[] = [
  { name: 'name', label: 'Name' },
  { name: 'facilityTypeId', label: 'Facility type' },
  { name: 'operatorTypeId', label: 'Operator type' },
  { name: 'address_city', label: 'City' },
  { name: 'address_stateOrRegion', label: 'State' },
  { name: 'address_zipOrPostcode', label: 'Postcode' },
  { name: 'description', label: 'Description' },
  { name: 'capability', label: 'Capability' },
  { name: 'procedure', label: 'Procedure' },
  { name: 'equipment', label: 'Equipment' },
  { name: 'specialties', label: 'Specialties' },
  { name: 'source_urls', label: 'Source URLs' },
  { name: 'numberDoctors', label: 'Doctors' },
  { name: 'capacity', label: 'Capacity' },
  { name: 'yearEstablished', label: 'Year established' },
  { name: 'officialPhone', label: 'Phone' },
  { name: 'email', label: 'Email' },
  { name: 'officialWebsite', label: 'Website' },
];

const FALLBACK_ISSUES: IssueDefinition[] = [
  {
    code: 'high_claim_weak_support',
    label: 'Complex claim needs support',
    explanation: 'Clinical claims appear in text while equipment, staff, or capacity evidence is thin.',
  },
  {
    code: 'facility_type_conflict',
    label: 'Facility type conflict',
    explanation: 'A small facility type is paired with complex-care claims.',
  },
  {
    code: 'sparse_evidence',
    label: 'Sparse evidence',
    explanation: 'Important planning fields are missing or the claim text is very short.',
  },
  {
    code: 'missing_staff_capacity',
    label: 'Staff or capacity missing',
    explanation: 'Doctor count or capacity is absent, making service scale hard to trust.',
  },
  {
    code: 'weak_source_support',
    label: 'Weak source support',
    explanation: 'Few usable source URLs are available for verification.',
  },
];

const emptyDraft: ReviewState = {
  status: 'unreviewed',
  note: '',
  shortlisted: false,
  priorityOverride: 'none',
};

const emptyCorrectionDraft: CorrectionDraft = {
  fieldName: 'capacity',
  correctedValue: '',
  status: 'proposed',
  reason: '',
  evidenceNote: '',
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function asNumber(value: number | string | undefined) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatCount(value: number | string | undefined) {
  return new Intl.NumberFormat('en-US').format(asNumber(value));
}

function truncateForDisplay(value: string, limit = 140) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trim()}...`;
}

function statusLabel(status: string) {
  return DECISION_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function correctionStatusLabel(status: string) {
  return CORRECTION_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function fieldLabel(fieldName: CorrectableFieldName, fields: CorrectionFieldOption[] = CORRECTABLE_FIELDS) {
  return fields.find((field) => field.name === fieldName)?.label ?? fieldName;
}

function defaultCorrectionField(record: ReadinessRecord) {
  const preferred: CorrectableFieldName[] = [
    'capacity',
    'numberDoctors',
    'equipment',
    'source_urls',
    'capability',
    'procedure',
    'description',
  ];
  return preferred.find((fieldName) => !record.values[fieldName]?.effective) ?? 'capacity';
}

function correctionDraftForRecord(record: ReadinessRecord, fieldName = defaultCorrectionField(record)): CorrectionDraft {
  const existing = record.corrections.find((correction) => correction.fieldName === fieldName);
  return {
    fieldName,
    correctedValue: existing?.correctedValue ?? record.values[fieldName]?.effective ?? '',
    status: existing?.status ?? 'proposed',
    reason: existing?.reason ?? '',
    evidenceNote: existing?.evidenceNote ?? '',
  };
}

function badgeClassForUncertainty(uncertainty: string) {
  if (uncertainty === 'high') return 'border-red-300 bg-red-50 text-red-700';
  if (uncertainty === 'medium') return 'border-amber-300 bg-amber-50 text-amber-700';
  return 'border-emerald-300 bg-emerald-50 text-emerald-700';
}

function badgeClassForPriority(priority: string) {
  if (priority === 'Critical') return 'border-red-300 bg-red-50 text-red-700';
  if (priority === 'High') return 'border-orange-300 bg-orange-50 text-orange-700';
  if (priority === 'Medium') return 'border-amber-300 bg-amber-50 text-amber-700';
  return 'border-slate-300 bg-slate-50 text-slate-700';
}

function badgeClassForCorrectionStatus(status: string) {
  if (status === 'approved' || status === 'applied') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  if (status === 'rejected') return 'border-slate-300 bg-slate-50 text-slate-700';
  return 'border-sky-300 bg-sky-50 text-sky-700';
}

export function LakebasePage() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [records, setRecords] = useState<ReadinessRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ReadinessRecord | null>(null);
  const [issueFilter, setIssueFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReviewState>(emptyDraft);
  const [correctionDraft, setCorrectionDraft] = useState<CorrectionDraft>(emptyCorrectionDraft);

  const issueDefinitions = summary?.issues.length ? summary.issues : FALLBACK_ISSUES;
  const correctionFields = summary?.correctionFields?.length ? summary.correctionFields : CORRECTABLE_FIELDS;

  const recordsUrl = useMemo(() => {
    const params = new URLSearchParams({
      issue: issueFilter,
      status: statusFilter,
      search,
      limit: '60',
    });
    return `/api/lakebase/readiness/records?${params.toString()}`;
  }, [issueFilter, search, statusFilter]);

  useEffect(() => {
    let active = true;
    setLoadingSummary(true);
    fetchJson<SummaryResponse>('/api/lakebase/readiness/summary')
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load summary');
      })
      .finally(() => {
        if (active) setLoadingSummary(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingRecords(true);
    fetchJson<{ records: ReadinessRecord[] }>(recordsUrl)
      .then((data) => {
        if (!active) return;
        setRecords(data.records);
        setSelectedId((current) => current ?? data.records[0]?.id ?? null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load records');
      })
      .finally(() => {
        if (active) setLoadingRecords(false);
      });
    return () => {
      active = false;
    };
  }, [recordsUrl]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedRecord(null);
      setDraft(emptyDraft);
      setCorrectionDraft(emptyCorrectionDraft);
      return;
    }

    let active = true;
    const localRecord = records.find((record) => record.id === selectedId);
    if (localRecord) {
      setSelectedRecord(localRecord);
      setDraft(localRecord.review);
      setCorrectionDraft(correctionDraftForRecord(localRecord));
    }

    setLoadingDetail(true);
    fetchJson<ReadinessRecord>(`/api/lakebase/readiness/records/${selectedId}`)
      .then((record) => {
        if (!active) return;
        setSelectedRecord(record);
        setDraft(record.review);
        setCorrectionDraft(correctionDraftForRecord(record));
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load facility detail');
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });

    return () => {
      active = false;
    };
  }, [selectedId, records]);

  const fieldProfile = useMemo(() => summary?.fields ?? [], [summary]);

  const refreshSummary = async () => {
    setSummary(null);
    setLoadingSummary(true);
    try {
      const refreshed = await fetchJson<SummaryResponse>('/api/lakebase/readiness/summary');
      setSummary(refreshed);
    } finally {
      setLoadingSummary(false);
    }
  };

  const refreshRecords = async () => {
    setLoadingRecords(true);
    try {
      const refreshed = await fetchJson<{ records: ReadinessRecord[] }>(recordsUrl);
      setRecords(refreshed.records);
    } finally {
      setLoadingRecords(false);
    }
  };

  const saveReview = async () => {
    if (!selectedRecord) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await fetchJson<ReadinessRecord>(
        `/api/lakebase/readiness/reviews/${selectedRecord.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewStatus: draft.status,
            note: draft.note,
            shortlisted: draft.shortlisted,
            priorityOverride: draft.priorityOverride,
          }),
        },
      );
      setSelectedRecord(updated);
      setDraft(updated.review);
      setRecords((current) => current.map((record) => (record.id === updated.id ? updated : record)));
      await refreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review');
    } finally {
      setSaving(false);
    }
  };

  const saveCorrection = async () => {
    if (!selectedRecord) return;
    setSavingCorrection(true);
    setError(null);
    try {
      const updated = await fetchJson<ReadinessRecord>(
        `/api/lakebase/readiness/corrections/${selectedRecord.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(correctionDraft),
        },
      );
      setSelectedRecord(updated);
      setCorrectionDraft(correctionDraftForRecord(updated, correctionDraft.fieldName));
      setRecords((current) => current.map((record) => (record.id === updated.id ? updated : record)));
      await Promise.all([refreshSummary(), refreshRecords()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save correction');
    } finally {
      setSavingCorrection(false);
    }
  };

  return (
    <div className="w-full max-w-[1500px] mx-auto space-y-6">
      <header className="space-y-2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-normal text-foreground">Data Readiness Desk</h2>
            <p className="text-base text-muted-foreground">
              What needs to be fixed before this dataset can be trusted for planning?
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setSearch('');
              setIssueFilter('all');
              setStatusFilter('all');
              setSelectedId(null);
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Reset view
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          icon={<Database className="h-4 w-4" />}
          label="Synced records"
          value={formatCount(summary?.metrics.total_records)}
          loading={loadingSummary}
        />
        <MetricCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Queued for review"
          value={formatCount(summary?.metrics.queued_records)}
          loading={loadingSummary}
        />
        <MetricCard
          icon={<ShieldQuestion className="h-4 w-4" />}
          label="High uncertainty"
          value={formatCount(summary?.metrics.high_priority_records)}
          loading={loadingSummary}
        />
        <MetricCard
          icon={<Pencil className="h-4 w-4" />}
          label="Proposed fixes"
          value={formatCount(summary?.metrics.proposed_corrections)}
          loading={loadingSummary}
        />
        <MetricCard
          icon={<ClipboardCheck className="h-4 w-4" />}
          label="Reviewed"
          value={formatCount(summary?.metrics.reviewed_records)}
          loading={loadingSummary}
        />
        <MetricCard
          icon={<Star className="h-4 w-4" />}
          label="Shortlisted"
          value={formatCount(summary?.metrics.shortlisted_records)}
          loading={loadingSummary}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div className="grid gap-3 rounded-md border bg-card p-4 md:grid-cols-[minmax(220px,1fr)_220px_220px]">
            <div className="space-y-2">
              <Label htmlFor="readiness-search">Search facilities</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="readiness-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, city, specialty, claim"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Issue</Label>
              <Select value={issueFilter} onValueChange={setIssueFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All issue types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All issue types</SelectItem>
                  {issueDefinitions.map((issue) => (
                    <SelectItem key={issue.code} value={issue.code}>
                      {issue.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Decision</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All decisions" />
                </SelectTrigger>
                <SelectContent>
                  {REVIEW_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3">
            {loadingRecords &&
              Array.from({ length: 5 }, (_, index) => (
                <Card key={`record-skeleton-${index}`} className="shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </CardContent>
                </Card>
              ))}

            {!loadingRecords && records.length === 0 && (
              <div className="rounded-md border bg-card p-8 text-center text-muted-foreground">
                No facilities match the current filters.
              </div>
            )}

            {!loadingRecords &&
              records.map((record) => (
                <FacilityRecordCard
                  key={record.id}
                  record={record}
                  selected={record.id === selectedRecord?.id}
                  onSelect={() => setSelectedId(record.id)}
                />
              ))}
          </div>
        </div>

        <aside className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Field Coverage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingSummary &&
                Array.from({ length: 4 }, (_, index) => <Skeleton key={`field-${index}`} className="h-4 w-full" />)}
              {!loadingSummary &&
                fieldProfile.map((field) => (
                  <div key={field.field_name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{field.field_name}</span>
                      <span className="text-muted-foreground">{Number(field.coverage_pct).toFixed(1)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${Math.min(100, Number(field.coverage_pct))}%` }}
                      />
                    </div>
                    {asNumber(field.corrected_count) > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {formatCount(field.corrected_count)} corrected
                      </div>
                    )}
                  </div>
                ))}
            </CardContent>
          </Card>

          <FacilityDetail
            record={selectedRecord}
            draft={draft}
            correctionDraft={correctionDraft}
            correctionFields={correctionFields}
            loading={loadingDetail}
            saving={saving}
            savingCorrection={savingCorrection}
            onDraftChange={setDraft}
            onCorrectionDraftChange={setCorrectionDraft}
            onSave={() => {
              void saveReview();
            }}
            onSaveCorrection={() => {
              void saveCorrection();
            }}
          />
        </aside>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="rounded-md border bg-muted p-2 text-muted-foreground">{icon}</span>
        </div>
        {loading ? <Skeleton className="mt-4 h-8 w-24" /> : <div className="mt-4 text-2xl font-bold">{value}</div>}
      </CardContent>
    </Card>
  );
}

function FacilityRecordCard({
  record,
  selected,
  onSelect,
}: {
  record: ReadinessRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const primaryEvidence = record.evidence[0];
  return (
    <Card className={`shadow-sm transition-colors ${selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}>
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-base font-semibold">{record.name}</h3>
                {record.review.shortlisted && <Star className="h-4 w-4 fill-amber-400 text-amber-500" />}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {record.location}
                </span>
                <span>{record.facilityType}</span>
                <span>{record.operatorType}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Badge variant="outline" className={badgeClassForPriority(record.priority)}>
                {record.priority}
              </Badge>
              <Badge variant="outline" className={badgeClassForUncertainty(record.uncertainty)}>
                {record.uncertainty} uncertainty
              </Badge>
              {record.metrics.activeCorrectionCount > 0 && (
                <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-700">
                  {record.metrics.activeCorrectionCount} fix
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {record.issues.slice(0, 3).map((issue) => (
              <Badge key={issue.code} variant="secondary">
                {issue.label}
              </Badge>
            ))}
          </div>

          {primaryEvidence && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{primaryEvidence.field}:</span> {primaryEvidence.text}
            </p>
          )}

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Score {record.riskScore}/100</span>
            <span>{record.metrics.sourceCount} source signals</span>
            <span>{record.metrics.missingCoreCount} core gaps</span>
            <span>{statusLabel(record.review.status)}</span>
          </div>
        </CardContent>
      </button>
    </Card>
  );
}

function FacilityDetail({
  record,
  draft,
  correctionDraft,
  correctionFields,
  loading,
  saving,
  savingCorrection,
  onDraftChange,
  onCorrectionDraftChange,
  onSave,
  onSaveCorrection,
}: {
  record: ReadinessRecord | null;
  draft: ReviewState;
  correctionDraft: CorrectionDraft;
  correctionFields: CorrectionFieldOption[];
  loading: boolean;
  saving: boolean;
  savingCorrection: boolean;
  onDraftChange: (next: ReviewState) => void;
  onCorrectionDraftChange: (next: CorrectionDraft) => void;
  onSave: () => void;
  onSaveCorrection: () => void;
}) {
  if (!record) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">Select a facility to review its evidence.</CardContent>
      </Card>
    );
  }

  const selectedValue = record.values[correctionDraft.fieldName];

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{record.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={badgeClassForPriority(record.priority)}>
                {record.priority} priority
              </Badge>
              <Badge variant="outline" className={badgeClassForUncertainty(record.uncertainty)}>
                {record.uncertainty} uncertainty
              </Badge>
              <Badge variant="secondary">{record.riskScore}/100 score</Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Location" value={record.location} />
              <Fact label="Type" value={record.facilityType} />
              <Fact label="Doctors" value={record.details.numberDoctors} />
              <Fact label="Capacity" value={record.details.capacity} />
              <Fact label="Website" value={record.details.officialWebsite} />
              <Fact label="Recent signal" value={record.details.latestSocialPost || record.details.recencyOfPageUpdate} />
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Why this is queued</h4>
              {record.issues.map((issue) => (
                <div key={issue.code} className="rounded-md border bg-muted/30 p-3">
                  <div className="text-sm font-medium">{issue.label}</div>
                  <div className="text-sm text-muted-foreground">{issue.explanation}</div>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Evidence</h4>
              {record.evidence.map((snippet) => (
                <div key={`${record.id}-${snippet.field}`} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium uppercase text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" />
                      {snippet.field}
                    </span>
                    {snippet.corrected && (
                      <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-700">
                        Corrected
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm">{snippet.text}</p>
                </div>
              ))}
            </div>

            <div className="space-y-4 rounded-md border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold">Facility correction</h4>
                {record.metrics.activeCorrectionCount > 0 && (
                  <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-700">
                    {record.metrics.activeCorrectionCount} active
                  </Badge>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Field</Label>
                  <Select
                    value={correctionDraft.fieldName}
                    onValueChange={(value) =>
                      onCorrectionDraftChange(correctionDraftForRecord(record, value as CorrectableFieldName))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {correctionFields.map((field) => (
                        <SelectItem key={field.name} value={field.name}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={correctionDraft.status}
                    onValueChange={(value) =>
                      onCorrectionDraftChange({ ...correctionDraft, status: value as CorrectionStatus })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CORRECTION_STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Fact label="Source value" value={selectedValue?.original} />
                <Fact label="Current value" value={selectedValue?.effective} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="corrected-value">Corrected value</Label>
                <textarea
                  id="corrected-value"
                  value={correctionDraft.correctedValue}
                  onChange={(event) =>
                    onCorrectionDraftChange({ ...correctionDraft, correctedValue: event.target.value })
                  }
                  className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder={selectedValue?.effective || selectedValue?.original || fieldLabel(correctionDraft.fieldName)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="correction-reason">Reason</Label>
                <Input
                  id="correction-reason"
                  value={correctionDraft.reason}
                  onChange={(event) => onCorrectionDraftChange({ ...correctionDraft, reason: event.target.value })}
                  placeholder="Incorrect, missing, outdated"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="correction-evidence">Evidence note</Label>
                <textarea
                  id="correction-evidence"
                  value={correctionDraft.evidenceNote}
                  onChange={(event) =>
                    onCorrectionDraftChange({ ...correctionDraft, evidenceNote: event.target.value })
                  }
                  className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Source URL checked or local verification"
                />
              </div>

              <Button type="button" onClick={onSaveCorrection} disabled={savingCorrection} className="w-full">
                {savingCorrection ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                Save correction
              </Button>

              {record.corrections.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-semibold">Saved corrections</h5>
                  {record.corrections.slice(0, 5).map((correction) => (
                    <div key={`${record.id}-${correction.fieldName}`} className="rounded-md border bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{fieldLabel(correction.fieldName, correctionFields)}</span>
                        <Badge variant="outline" className={badgeClassForCorrectionStatus(correction.status)}>
                          {correctionStatusLabel(correction.status)}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {truncateForDisplay(correction.correctedValue || 'Missing')}
                      </div>
                      {correction.reason && <div className="mt-1 text-xs text-muted-foreground">{correction.reason}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-md border bg-card p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Decision</Label>
                  <Select
                    value={draft.status}
                    onValueChange={(value) => onDraftChange({ ...draft, status: value as ReviewStatus })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DECISION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select
                    value={draft.priorityOverride}
                    onValueChange={(value) =>
                      onDraftChange({ ...draft, priorityOverride: value as PriorityOverride })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="review-note">Review note</Label>
                <textarea
                  id="review-note"
                  value={draft.note}
                  onChange={(event) => onDraftChange({ ...draft, note: event.target.value })}
                  className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Evidence checked, fix needed, or local context"
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant={draft.shortlisted ? 'default' : 'outline'}
                  onClick={() => onDraftChange({ ...draft, shortlisted: !draft.shortlisted })}
                  className="sm:flex-1"
                >
                  <Star className={`h-4 w-4 ${draft.shortlisted ? 'fill-current' : ''}`} />
                  {draft.shortlisted ? 'Shortlisted' : 'Shortlist'}
                </Button>
                <Button type="button" onClick={onSave} disabled={saving} className="sm:flex-1">
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save review
                </Button>
              </div>

              {record.review.updatedAt && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Last saved by {record.review.reviewer || 'reviewer'}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value || 'Missing'}</div>
    </div>
  );
}
