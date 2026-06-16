import { z } from 'zod';
import type { Application, Request } from 'express';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const SOURCE_TABLE = 'public.facilities_deduplicated';

const CORRECTABLE_FIELD_NAMES = [
  'name',
  'facilityTypeId',
  'operatorTypeId',
  'address_city',
  'address_stateOrRegion',
  'address_zipOrPostcode',
  'description',
  'capability',
  'procedure',
  'equipment',
  'specialties',
  'source_urls',
  'numberDoctors',
  'capacity',
  'yearEstablished',
  'officialPhone',
  'email',
  'officialWebsite',
] as const;

type CorrectableFieldName = (typeof CORRECTABLE_FIELD_NAMES)[number];

const CORRECTION_STATUS_VALUES = ['proposed', 'approved', 'rejected', 'applied'] as const;

const SOURCE_FIELD_ALIASES: Record<CorrectableFieldName, string> = {
  name: 'name_source',
  facilityTypeId: 'facility_type_source',
  operatorTypeId: 'operator_type_source',
  address_city: 'city_source',
  address_stateOrRegion: 'state_source',
  address_zipOrPostcode: 'postcode_source',
  description: 'description_source',
  capability: 'capability_source',
  procedure: 'procedure_source',
  equipment: 'equipment_source',
  specialties: 'specialties_source',
  source_urls: 'source_urls_source',
  numberDoctors: 'number_doctors_source',
  capacity: 'capacity_source',
  yearEstablished: 'year_established_source',
  officialPhone: 'official_phone_source',
  email: 'email_source',
  officialWebsite: 'official_website_source',
};

const SETUP_SQL = `
  CREATE SCHEMA IF NOT EXISTS readiness;

  CREATE TABLE IF NOT EXISTS readiness.facility_reviews (
    facility_id TEXT PRIMARY KEY,
    review_status TEXT NOT NULL DEFAULT 'unreviewed'
      CHECK (review_status IN ('unreviewed', 'needs_review', 'fix_needed', 'verified', 'not_relevant')),
    note TEXT NOT NULL DEFAULT '',
    shortlisted BOOLEAN NOT NULL DEFAULT false,
    priority_override TEXT NOT NULL DEFAULT 'none'
      CHECK (priority_override IN ('none', 'low', 'medium', 'high', 'critical')),
    reviewer TEXT NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS readiness.facility_field_corrections (
    facility_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    original_value TEXT NOT NULL DEFAULT '',
    corrected_value TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'proposed'
      CHECK (status IN ('proposed', 'approved', 'rejected', 'applied')),
    reason TEXT NOT NULL DEFAULT '',
    evidence_note TEXT NOT NULL DEFAULT '',
    reviewer TEXT NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (facility_id, field_name)
  );

`;

const READINESS_CTE = `
  WITH source_rows AS (
    SELECT
      f."unique_id" AS facility_id,
      NULLIF(NULLIF(BTRIM(f."name"), ''), 'null') AS name_source,
      NULLIF(NULLIF(BTRIM(f."facilityTypeId"), ''), 'null') AS facility_type_source,
      NULLIF(NULLIF(BTRIM(f."operatorTypeId"), ''), 'null') AS operator_type_source,
      NULLIF(NULLIF(BTRIM(f."address_city"), ''), 'null') AS city_source,
      NULLIF(NULLIF(BTRIM(f."address_stateOrRegion"), ''), 'null') AS state_source,
      NULLIF(NULLIF(BTRIM(f."address_zipOrPostcode"), ''), 'null') AS postcode_source,
      f."latitude" AS latitude,
      f."longitude" AS longitude,
      NULLIF(NULLIF(BTRIM(f."description"), ''), 'null') AS description_source,
      CASE WHEN f."capability" IS NULL OR BTRIM(f."capability") IN ('', 'null', '[]') THEN NULL ELSE f."capability" END AS capability_source,
      CASE WHEN f."procedure" IS NULL OR BTRIM(f."procedure") IN ('', 'null', '[]') THEN NULL ELSE f."procedure" END AS procedure_source,
      CASE WHEN f."equipment" IS NULL OR BTRIM(f."equipment") IN ('', 'null', '[]') THEN NULL ELSE f."equipment" END AS equipment_source,
      CASE WHEN f."specialties" IS NULL OR BTRIM(f."specialties") IN ('', 'null', '[]') THEN NULL ELSE f."specialties" END AS specialties_source,
      CASE WHEN f."source_urls" IS NULL OR BTRIM(f."source_urls") IN ('', 'null', '[]') THEN NULL ELSE f."source_urls" END AS source_urls_source,
      NULLIF(NULLIF(BTRIM(f."numberDoctors"), ''), 'null') AS number_doctors_source,
      NULLIF(NULLIF(BTRIM(f."capacity"), ''), 'null') AS capacity_source,
      NULLIF(NULLIF(BTRIM(f."yearEstablished"), ''), 'null') AS year_established_source,
      NULLIF(NULLIF(BTRIM(f."officialPhone"), ''), 'null') AS official_phone_source,
      NULLIF(NULLIF(BTRIM(f."email"), ''), 'null') AS email_source,
      NULLIF(NULLIF(BTRIM(f."officialWebsite"), ''), 'null') AS official_website_source,
      NULLIF(NULLIF(BTRIM(f."recency_of_page_update"), ''), 'null') AS recency_of_page_update,
      NULLIF(NULLIF(BTRIM(f."distinct_social_media_presence_count"), ''), 'null') AS social_presence_count,
      NULLIF(NULLIF(BTRIM(f."post_metrics_most_recent_social_media_post_date"), ''), 'null') AS latest_social_post
    FROM ${SOURCE_TABLE} f
  ),
  active_corrections AS (
    SELECT *
    FROM readiness.facility_field_corrections
    WHERE status IN ('proposed', 'approved', 'applied')
  ),
  correction_pivot AS (
    SELECT
      facility_id,
      MAX(corrected_value) FILTER (WHERE field_name = 'name') AS name_correction,
      BOOL_OR(field_name = 'name') AS has_name_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'facilityTypeId') AS facility_type_correction,
      BOOL_OR(field_name = 'facilityTypeId') AS has_facility_type_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'operatorTypeId') AS operator_type_correction,
      BOOL_OR(field_name = 'operatorTypeId') AS has_operator_type_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'address_city') AS city_correction,
      BOOL_OR(field_name = 'address_city') AS has_city_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'address_stateOrRegion') AS state_correction,
      BOOL_OR(field_name = 'address_stateOrRegion') AS has_state_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'address_zipOrPostcode') AS postcode_correction,
      BOOL_OR(field_name = 'address_zipOrPostcode') AS has_postcode_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'description') AS description_correction,
      BOOL_OR(field_name = 'description') AS has_description_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'capability') AS capability_correction,
      BOOL_OR(field_name = 'capability') AS has_capability_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'procedure') AS procedure_correction,
      BOOL_OR(field_name = 'procedure') AS has_procedure_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'equipment') AS equipment_correction,
      BOOL_OR(field_name = 'equipment') AS has_equipment_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'specialties') AS specialties_correction,
      BOOL_OR(field_name = 'specialties') AS has_specialties_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'source_urls') AS source_urls_correction,
      BOOL_OR(field_name = 'source_urls') AS has_source_urls_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'numberDoctors') AS number_doctors_correction,
      BOOL_OR(field_name = 'numberDoctors') AS has_number_doctors_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'capacity') AS capacity_correction,
      BOOL_OR(field_name = 'capacity') AS has_capacity_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'yearEstablished') AS year_established_correction,
      BOOL_OR(field_name = 'yearEstablished') AS has_year_established_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'officialPhone') AS official_phone_correction,
      BOOL_OR(field_name = 'officialPhone') AS has_official_phone_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'email') AS email_correction,
      BOOL_OR(field_name = 'email') AS has_email_correction,
      MAX(corrected_value) FILTER (WHERE field_name = 'officialWebsite') AS official_website_correction,
      BOOL_OR(field_name = 'officialWebsite') AS has_official_website_correction,
      ARRAY_AGG(field_name ORDER BY field_name) AS active_corrected_fields,
      COUNT(*) FILTER (WHERE status = 'proposed')::int AS proposed_correction_count,
      COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_correction_count,
      COUNT(*)::int AS active_correction_count
    FROM active_corrections
    GROUP BY facility_id
  ),
  correction_lists AS (
    SELECT
      facility_id,
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'fieldName', field_name,
          'originalValue', original_value,
          'correctedValue', corrected_value,
          'status', status,
          'reason', reason,
          'evidenceNote', evidence_note,
          'reviewer', reviewer,
          'createdAt', created_at,
          'updatedAt', updated_at
        )
        ORDER BY updated_at DESC, field_name
      ) AS corrections_json
    FROM readiness.facility_field_corrections
    GROUP BY facility_id
  ),
  base AS (
    SELECT
      s.*,
      CASE WHEN COALESCE(p.has_name_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.name_correction, '')), ''), 'null') ELSE s.name_source END AS name,
      CASE WHEN COALESCE(p.has_facility_type_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.facility_type_correction, '')), ''), 'null') ELSE s.facility_type_source END AS facility_type,
      CASE WHEN COALESCE(p.has_operator_type_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.operator_type_correction, '')), ''), 'null') ELSE s.operator_type_source END AS operator_type,
      CASE WHEN COALESCE(p.has_city_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.city_correction, '')), ''), 'null') ELSE s.city_source END AS city,
      CASE WHEN COALESCE(p.has_state_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.state_correction, '')), ''), 'null') ELSE s.state_source END AS state,
      CASE WHEN COALESCE(p.has_postcode_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.postcode_correction, '')), ''), 'null') ELSE s.postcode_source END AS postcode,
      CASE WHEN COALESCE(p.has_description_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.description_correction, '')), ''), 'null') ELSE s.description_source END AS description_text,
      CASE WHEN COALESCE(p.has_capability_correction, false) THEN CASE WHEN BTRIM(COALESCE(p.capability_correction, '')) IN ('', 'null', '[]') THEN NULL ELSE p.capability_correction END ELSE s.capability_source END AS capability_text,
      CASE WHEN COALESCE(p.has_procedure_correction, false) THEN CASE WHEN BTRIM(COALESCE(p.procedure_correction, '')) IN ('', 'null', '[]') THEN NULL ELSE p.procedure_correction END ELSE s.procedure_source END AS procedure_text,
      CASE WHEN COALESCE(p.has_equipment_correction, false) THEN CASE WHEN BTRIM(COALESCE(p.equipment_correction, '')) IN ('', 'null', '[]') THEN NULL ELSE p.equipment_correction END ELSE s.equipment_source END AS equipment_text,
      CASE WHEN COALESCE(p.has_specialties_correction, false) THEN CASE WHEN BTRIM(COALESCE(p.specialties_correction, '')) IN ('', 'null', '[]') THEN NULL ELSE p.specialties_correction END ELSE s.specialties_source END AS specialties_text,
      CASE WHEN COALESCE(p.has_source_urls_correction, false) THEN CASE WHEN BTRIM(COALESCE(p.source_urls_correction, '')) IN ('', 'null', '[]') THEN NULL ELSE p.source_urls_correction END ELSE s.source_urls_source END AS source_urls_text,
      CASE WHEN COALESCE(p.has_number_doctors_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.number_doctors_correction, '')), ''), 'null') ELSE s.number_doctors_source END AS number_doctors,
      CASE WHEN COALESCE(p.has_capacity_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.capacity_correction, '')), ''), 'null') ELSE s.capacity_source END AS capacity,
      CASE WHEN COALESCE(p.has_year_established_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.year_established_correction, '')), ''), 'null') ELSE s.year_established_source END AS year_established,
      CASE WHEN COALESCE(p.has_official_phone_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.official_phone_correction, '')), ''), 'null') ELSE s.official_phone_source END AS official_phone,
      CASE WHEN COALESCE(p.has_email_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.email_correction, '')), ''), 'null') ELSE s.email_source END AS email,
      CASE WHEN COALESCE(p.has_official_website_correction, false) THEN NULLIF(NULLIF(BTRIM(COALESCE(p.official_website_correction, '')), ''), 'null') ELSE s.official_website_source END AS official_website,
      COALESCE(r.review_status, 'unreviewed') AS review_status,
      COALESCE(r.note, '') AS review_note,
      COALESCE(r.shortlisted, false) AS shortlisted,
      COALESCE(r.priority_override, 'none') AS priority_override,
      r.reviewer,
      r.updated_at AS review_updated_at,
      COALESCE(p.active_corrected_fields, ARRAY[]::text[]) AS active_corrected_fields,
      COALESCE(p.proposed_correction_count, 0) AS proposed_correction_count,
      COALESCE(p.approved_correction_count, 0) AS approved_correction_count,
      COALESCE(p.active_correction_count, 0) AS active_correction_count,
      COALESCE(cl.corrections_json, '[]'::json) AS corrections_json
    FROM source_rows s
    LEFT JOIN correction_pivot p ON p.facility_id = s.facility_id
    LEFT JOIN correction_lists cl ON cl.facility_id = s.facility_id
    LEFT JOIN readiness.facility_reviews r ON r.facility_id = s.facility_id
  ),
  signals AS (
    SELECT
      *,
      LOWER(CONCAT_WS(' ', description_text, capability_text, procedure_text, equipment_text, specialties_text)) AS claims_text,
      (
        CASE WHEN capability_text IS NULL THEN 1 ELSE 0 END +
        CASE WHEN procedure_text IS NULL THEN 1 ELSE 0 END +
        CASE WHEN equipment_text IS NULL THEN 1 ELSE 0 END +
        CASE WHEN number_doctors IS NULL THEN 1 ELSE 0 END +
        CASE WHEN capacity IS NULL THEN 1 ELSE 0 END
      ) AS missing_core_count,
      ((LENGTH(LOWER(COALESCE(source_urls_text, ''))) -
        LENGTH(REPLACE(LOWER(COALESCE(source_urls_text, '')), 'http', ''))) / 4)::int AS source_count,
      LENGTH(CONCAT_WS(' ', description_text, capability_text, procedure_text, equipment_text, specialties_text)) AS evidence_chars
    FROM base
  ),
  scored AS (
    SELECT
      *,
      claims_text ~* '(icu|emergency|trauma|surgery|surgical|operation theatre|operating theatre|ventilator|dialysis|mri|ct scan|ct scanner|chemotherapy|oncology|cardiac|cardiology|nicu|neonatal|blood bank|transplant|endoscopy|laparoscopy|ivf|infertility)' AS high_acuity_claim,
      facility_type ~* '(clinic|doctor|dentist|dental|diagnostic|laboratory|pharmacy)' AS small_facility_type,
      (latitude IS NULL OR longitude IS NULL OR postcode IS NULL) AS location_gap,
      (official_phone IS NULL AND email IS NULL AND official_website IS NULL) AS contact_gap,
      (source_count <= 1) AS weak_source_support,
      (evidence_chars < 220 OR missing_core_count >= 3) AS sparse_evidence,
      LEAST(
        100,
        (
          CASE WHEN claims_text ~* '(icu|emergency|trauma|surgery|surgical|operation theatre|operating theatre|ventilator|dialysis|mri|ct scan|ct scanner|chemotherapy|oncology|cardiac|cardiology|nicu|neonatal|blood bank|transplant|endoscopy|laparoscopy|ivf|infertility)' THEN 18 ELSE 0 END +
          CASE WHEN claims_text ~* '(icu|emergency|trauma|surgery|surgical|operation theatre|operating theatre|ventilator|dialysis|mri|ct scan|ct scanner|chemotherapy|oncology|cardiac|cardiology|nicu|neonatal|blood bank|transplant|endoscopy|laparoscopy|ivf|infertility)' AND (equipment_text IS NULL OR number_doctors IS NULL OR capacity IS NULL) THEN 24 ELSE 0 END +
          CASE WHEN facility_type ~* '(clinic|doctor|dentist|dental|diagnostic|laboratory|pharmacy)' AND claims_text ~* '(icu|emergency|trauma|surgery|surgical|operation theatre|operating theatre|ventilator|dialysis|mri|ct scan|ct scanner|chemotherapy|oncology|cardiac|cardiology|nicu|neonatal|blood bank|transplant|endoscopy|laparoscopy|ivf|infertility)' THEN 18 ELSE 0 END +
          CASE WHEN source_count <= 1 THEN 12 ELSE 0 END +
          CASE WHEN evidence_chars < 220 THEN 12 ELSE 0 END +
          CASE WHEN missing_core_count >= 3 THEN 10 ELSE 0 END +
          CASE WHEN latitude IS NULL OR longitude IS NULL OR postcode IS NULL THEN 8 ELSE 0 END +
          CASE WHEN official_phone IS NULL AND email IS NULL AND official_website IS NULL THEN 8 ELSE 0 END +
          CASE WHEN latest_social_post IS NULL AND recency_of_page_update IS NULL THEN 5 ELSE 0 END
        )
      ) AS risk_score
    FROM signals
  ),
  issue_rows AS (
    SELECT
      *,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN high_acuity_claim AND (equipment_text IS NULL OR number_doctors IS NULL OR capacity IS NULL) THEN 'high_claim_weak_support' END,
        CASE WHEN small_facility_type AND high_acuity_claim THEN 'facility_type_conflict' END,
        CASE WHEN sparse_evidence THEN 'sparse_evidence' END,
        CASE WHEN number_doctors IS NULL OR capacity IS NULL THEN 'missing_staff_capacity' END,
        CASE WHEN weak_source_support THEN 'weak_source_support' END,
        CASE WHEN location_gap THEN 'location_gap' END,
        CASE WHEN contact_gap THEN 'contact_gap' END,
        CASE WHEN latest_social_post IS NULL AND recency_of_page_update IS NULL THEN 'stale_presence' END
      ]::text[], NULL) AS issue_codes
    FROM scored
  ),
  readiness AS (
    SELECT
      *,
      CASE
        WHEN priority_override = 'critical' THEN 5
        WHEN priority_override = 'high' THEN 4
        WHEN priority_override = 'medium' THEN 3
        WHEN priority_override = 'low' THEN 2
        WHEN risk_score >= 75 THEN 5
        WHEN risk_score >= 55 THEN 4
        WHEN risk_score >= 35 THEN 3
        ELSE 2
      END AS priority_rank,
      CASE
        WHEN risk_score >= 70 OR (high_acuity_claim AND weak_source_support) THEN 'high'
        WHEN risk_score >= 40 OR missing_core_count >= 3 THEN 'medium'
        ELSE 'low'
      END AS uncertainty
    FROM issue_rows
  )
`;

const SUMMARY_SQL = `
  ${READINESS_CTE}
  SELECT
    COUNT(*)::int AS total_records,
    COUNT(*) FILTER (WHERE risk_score >= 70)::int AS high_priority_records,
    COUNT(*) FILTER (WHERE array_length(issue_codes, 1) > 0)::int AS queued_records,
    COUNT(*) FILTER (WHERE review_status <> 'unreviewed')::int AS reviewed_records,
    COUNT(*) FILTER (WHERE shortlisted)::int AS shortlisted_records,
    COUNT(*) FILTER (WHERE active_correction_count > 0)::int AS corrected_records,
    COALESCE(SUM(proposed_correction_count), 0)::int AS proposed_corrections,
    COALESCE(SUM(active_correction_count), 0)::int AS active_corrections,
    COUNT(*) FILTER (WHERE weak_source_support)::int AS weak_source_records,
    ROUND(AVG(risk_score))::int AS average_risk_score
  FROM readiness
`;

const FIELD_PROFILE_SQL = `
  ${READINESS_CTE}
  SELECT
    field_name,
    present_count,
    corrected_count,
    ROUND((present_count::numeric / NULLIF(total_count, 0)) * 100, 1)::float AS coverage_pct
  FROM (
    SELECT 'description' AS field_name, COUNT(*) FILTER (WHERE description_text IS NOT NULL)::int AS present_count, COUNT(*) FILTER (WHERE 'description' = ANY(active_corrected_fields))::int AS corrected_count, COUNT(*)::int AS total_count FROM readiness
    UNION ALL
    SELECT 'capability', COUNT(*) FILTER (WHERE capability_text IS NOT NULL)::int, COUNT(*) FILTER (WHERE 'capability' = ANY(active_corrected_fields))::int, COUNT(*)::int FROM readiness
    UNION ALL
    SELECT 'procedure', COUNT(*) FILTER (WHERE procedure_text IS NOT NULL)::int, COUNT(*) FILTER (WHERE 'procedure' = ANY(active_corrected_fields))::int, COUNT(*)::int FROM readiness
    UNION ALL
    SELECT 'equipment', COUNT(*) FILTER (WHERE equipment_text IS NOT NULL)::int, COUNT(*) FILTER (WHERE 'equipment' = ANY(active_corrected_fields))::int, COUNT(*)::int FROM readiness
    UNION ALL
    SELECT 'numberDoctors', COUNT(*) FILTER (WHERE number_doctors IS NOT NULL)::int, COUNT(*) FILTER (WHERE 'numberDoctors' = ANY(active_corrected_fields))::int, COUNT(*)::int FROM readiness
    UNION ALL
    SELECT 'capacity', COUNT(*) FILTER (WHERE capacity IS NOT NULL)::int, COUNT(*) FILTER (WHERE 'capacity' = ANY(active_corrected_fields))::int, COUNT(*)::int FROM readiness
    UNION ALL
    SELECT 'source_urls', COUNT(*) FILTER (WHERE source_urls_text IS NOT NULL)::int, COUNT(*) FILTER (WHERE 'source_urls' = ANY(active_corrected_fields))::int, COUNT(*)::int FROM readiness
  ) fields
`;

const RECORDS_SQL = `
  ${READINESS_CTE}
  SELECT *
  FROM readiness
  WHERE ($1 = 'all' OR $1 = ANY(issue_codes))
    AND ($2 = 'all' OR review_status = $2)
    AND (
      $3 = ''
      OR CONCAT_WS(' ', name, city, state, facility_type, description_text, capability_text, procedure_text, equipment_text, specialties_text) ILIKE '%' || $3 || '%'
    )
  ORDER BY
    shortlisted DESC,
    priority_rank DESC,
    risk_score DESC,
    name ASC
  LIMIT $4
`;

const RECORD_BY_ID_SQL = `
  ${READINESS_CTE}
  SELECT *
  FROM readiness
  WHERE facility_id = $1
`;

const ReviewBody = z.object({
  reviewStatus: z.enum(['unreviewed', 'needs_review', 'fix_needed', 'verified', 'not_relevant']),
  note: z.string().max(4000).default(''),
  shortlisted: z.boolean().default(false),
  priorityOverride: z.enum(['none', 'low', 'medium', 'high', 'critical']).default('none'),
});

const CorrectionBody = z.object({
  fieldName: z.enum(CORRECTABLE_FIELD_NAMES),
  correctedValue: z.string().max(12000).default(''),
  status: z.enum(CORRECTION_STATUS_VALUES).default('proposed'),
  reason: z.string().max(2000).default(''),
  evidenceNote: z.string().max(4000).default(''),
});

const ISSUE_COPY: Record<string, { label: string; explanation: string }> = {
  high_claim_weak_support: {
    label: 'Complex claim needs support',
    explanation: 'Clinical claims appear in text while equipment, staff, or capacity evidence is thin.',
  },
  facility_type_conflict: {
    label: 'Facility type conflict',
    explanation: 'A small facility type is paired with complex-care claims.',
  },
  sparse_evidence: {
    label: 'Sparse evidence',
    explanation: 'Important planning fields are missing or the claim text is very short.',
  },
  missing_staff_capacity: {
    label: 'Staff or capacity missing',
    explanation: 'Doctor count or capacity is absent, making service scale hard to trust.',
  },
  weak_source_support: {
    label: 'Weak source support',
    explanation: 'Few usable source URLs are available for verification.',
  },
  location_gap: {
    label: 'Location gap',
    explanation: 'Coordinates or postcode are missing.',
  },
  contact_gap: {
    label: 'Contact gap',
    explanation: 'Phone, email, and official website are all missing.',
  },
  stale_presence: {
    label: 'Freshness unknown',
    explanation: 'No page-update or recent social-post signal is available.',
  },
};

function textValue(value: unknown, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const serialized = JSON.stringify(value);
  return serialized ?? fallback;
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function booleanValue(value: unknown) {
  return value === true || value === 'true';
}

function stringArrayValue(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  if (value.startsWith('{') && value.endsWith('}')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value ? [value] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.map((item: unknown) => item);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item: unknown) => item) : [];
  } catch {
    return [];
  }
}

function correctionArrayValue(value: unknown) {
  return parseJsonArray(value)
    .filter(isRecord)
    .map((item) => ({
      fieldName: textValue(item.fieldName),
      originalValue: textValue(item.originalValue),
      correctedValue: textValue(item.correctedValue),
      status: textValue(item.status, 'proposed'),
      reason: textValue(item.reason),
      evidenceNote: textValue(item.evidenceNote),
      reviewer: textValue(item.reviewer),
      createdAt: textValue(item.createdAt),
      updatedAt: textValue(item.updatedAt),
    }));
}

function parseTextArray(value: unknown, maxItems = 4) {
  const text = textValue(value).trim();
  if (!text || text === 'null' || text === '[]') return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .slice(0, maxItems);
    }
  } catch {
    // Fall through to plain text handling.
  }
  return [text];
}

function truncate(text: string, limit = 220) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trim()}...`;
}

function evidenceSnippet(field: string, value: unknown, limit = 220) {
  const parts = parseTextArray(value, field === 'source_urls' ? 3 : 4);
  if (parts.length === 0) return null;
  return {
    field,
    text: truncate(parts.join('; '), limit),
    corrected: false,
  };
}

function buildEvidence(row: Record<string, unknown>) {
  const correctedFields = stringArrayValue(row.active_corrected_fields);
  return [
    evidenceSnippet('description', row.description_text),
    evidenceSnippet('capability', row.capability_text),
    evidenceSnippet('procedure', row.procedure_text),
    evidenceSnippet('equipment', row.equipment_text),
    evidenceSnippet('specialties', row.specialties_text, 180),
    evidenceSnippet('source_urls', row.source_urls_text, 260),
  ]
    .filter((item): item is { field: string; text: string; corrected: boolean } => item !== null)
    .map((item) => ({
      ...item,
      corrected: correctedFields.includes(item.field),
    }));
}

function correctableValue(
  row: Record<string, unknown>,
  sourceAlias: string,
  effectiveAlias: string,
  fieldName: CorrectableFieldName,
  correctedFields: string[],
) {
  return {
    original: textValue(row[sourceAlias]),
    effective: textValue(row[effectiveAlias]),
    hasCorrection: correctedFields.includes(fieldName),
  };
}

function buildCorrectableValues(row: Record<string, unknown>, correctedFields: string[]) {
  return {
    name: correctableValue(row, 'name_source', 'name', 'name', correctedFields),
    facilityTypeId: correctableValue(row, 'facility_type_source', 'facility_type', 'facilityTypeId', correctedFields),
    operatorTypeId: correctableValue(row, 'operator_type_source', 'operator_type', 'operatorTypeId', correctedFields),
    address_city: correctableValue(row, 'city_source', 'city', 'address_city', correctedFields),
    address_stateOrRegion: correctableValue(row, 'state_source', 'state', 'address_stateOrRegion', correctedFields),
    address_zipOrPostcode: correctableValue(row, 'postcode_source', 'postcode', 'address_zipOrPostcode', correctedFields),
    description: correctableValue(row, 'description_source', 'description_text', 'description', correctedFields),
    capability: correctableValue(row, 'capability_source', 'capability_text', 'capability', correctedFields),
    procedure: correctableValue(row, 'procedure_source', 'procedure_text', 'procedure', correctedFields),
    equipment: correctableValue(row, 'equipment_source', 'equipment_text', 'equipment', correctedFields),
    specialties: correctableValue(row, 'specialties_source', 'specialties_text', 'specialties', correctedFields),
    source_urls: correctableValue(row, 'source_urls_source', 'source_urls_text', 'source_urls', correctedFields),
    numberDoctors: correctableValue(row, 'number_doctors_source', 'number_doctors', 'numberDoctors', correctedFields),
    capacity: correctableValue(row, 'capacity_source', 'capacity', 'capacity', correctedFields),
    yearEstablished: correctableValue(row, 'year_established_source', 'year_established', 'yearEstablished', correctedFields),
    officialPhone: correctableValue(row, 'official_phone_source', 'official_phone', 'officialPhone', correctedFields),
    email: correctableValue(row, 'email_source', 'email', 'email', correctedFields),
    officialWebsite: correctableValue(row, 'official_website_source', 'official_website', 'officialWebsite', correctedFields),
  };
}

function sourceValueForField(row: Record<string, unknown>, fieldName: CorrectableFieldName) {
  return textValue(row[SOURCE_FIELD_ALIASES[fieldName]]);
}

function correctionFieldLabels() {
  return [
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
}

function priorityLabel(rank: number) {
  if (rank >= 5) return 'Critical';
  if (rank >= 4) return 'High';
  if (rank >= 3) return 'Medium';
  return 'Low';
}

function mapRecord(row: Record<string, unknown>) {
  const issueCodes = stringArrayValue(row.issue_codes);
  const priorityRank = numberValue(row.priority_rank);
  const correctedFields = stringArrayValue(row.active_corrected_fields);
  return {
    id: textValue(row.facility_id),
    name: textValue(row.name, 'Unnamed facility'),
    location: [textValue(row.city), textValue(row.state)].filter(Boolean).join(', ') || 'Location not specified',
    facilityType: textValue(row.facility_type, 'Unknown type'),
    operatorType: textValue(row.operator_type, 'Unknown operator'),
    riskScore: numberValue(row.risk_score),
    priority: priorityLabel(priorityRank),
    uncertainty: textValue(row.uncertainty, 'medium'),
    issueCodes,
    issues: issueCodes.map((code) => ({
      code,
      label: ISSUE_COPY[code]?.label ?? code,
      explanation: ISSUE_COPY[code]?.explanation ?? 'Needs human review.',
    })),
    metrics: {
      missingCoreCount: numberValue(row.missing_core_count),
      sourceCount: numberValue(row.source_count),
      evidenceChars: numberValue(row.evidence_chars),
      highAcuityClaim: booleanValue(row.high_acuity_claim),
      weakSourceSupport: booleanValue(row.weak_source_support),
      proposedCorrectionCount: numberValue(row.proposed_correction_count),
      approvedCorrectionCount: numberValue(row.approved_correction_count),
      activeCorrectionCount: numberValue(row.active_correction_count),
    },
    details: {
      numberDoctors: textValue(row.number_doctors),
      capacity: textValue(row.capacity),
      yearEstablished: textValue(row.year_established),
      officialPhone: textValue(row.official_phone),
      email: textValue(row.email),
      officialWebsite: textValue(row.official_website),
      recencyOfPageUpdate: textValue(row.recency_of_page_update),
      latestSocialPost: textValue(row.latest_social_post),
      latitude: row.latitude,
      longitude: row.longitude,
    },
    evidence: buildEvidence(row),
    values: buildCorrectableValues(row, correctedFields),
    corrections: correctionArrayValue(row.corrections_json),
    review: {
      status: textValue(row.review_status, 'unreviewed'),
      note: textValue(row.review_note),
      shortlisted: booleanValue(row.shortlisted),
      priorityOverride: textValue(row.priority_override, 'none'),
      reviewer: textValue(row.reviewer),
      updatedAt: textValue(row.review_updated_at),
    },
  };
}

function requestUser(req: Request) {
  return req.header('x-forwarded-email') ?? req.header('x-databricks-user') ?? 'local-reviewer';
}

export async function setupDataReadinessRoutes(appkit: AppKitWithLakebase) {
  try {
    await appkit.lakebase.query(SETUP_SQL);
    console.log('[readiness] Created or verified readiness.facility_reviews');
  } catch (err) {
    console.warn('[readiness] Database setup failed:', (err as Error).message);
    console.warn('[readiness] Routes will be registered but may return errors');
  }

  appkit.server.extend((app) => {
    app.get('/api/lakebase/readiness/summary', async (_req, res) => {
      try {
        const [summary, fields] = await Promise.all([
          appkit.lakebase.query(SUMMARY_SQL),
          appkit.lakebase.query(FIELD_PROFILE_SQL),
        ]);
        res.json({
          metrics: summary.rows[0],
          fields: fields.rows,
          issues: Object.entries(ISSUE_COPY).map(([code, copy]) => ({ code, ...copy })),
          correctionFields: correctionFieldLabels(),
        });
      } catch (err) {
        console.error('Failed to load readiness summary:', err);
        res.status(500).json({ error: 'Failed to load readiness summary' });
      }
    });

    app.get('/api/lakebase/readiness/records', async (req, res) => {
      try {
        const issue = typeof req.query.issue === 'string' ? req.query.issue : 'all';
        const status = typeof req.query.status === 'string' ? req.query.status : 'all';
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 40;
        const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(rawLimit, 100)) : 40;
        const result = await appkit.lakebase.query(RECORDS_SQL, [issue, status, search, limit]);
        res.json({ records: result.rows.map(mapRecord) });
      } catch (err) {
        console.error('Failed to load readiness records:', err);
        res.status(500).json({ error: 'Failed to load readiness records' });
      }
    });

    app.get('/api/lakebase/readiness/records/:id', async (req, res) => {
      try {
        const result = await appkit.lakebase.query(RECORD_BY_ID_SQL, [req.params.id]);
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Facility not found' });
          return;
        }
        res.json(mapRecord(result.rows[0]));
      } catch (err) {
        console.error('Failed to load readiness record:', err);
        res.status(500).json({ error: 'Failed to load readiness record' });
      }
    });

    app.put('/api/lakebase/readiness/reviews/:id', async (req, res) => {
      try {
        const parsed = ReviewBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid review payload' });
          return;
        }

        await appkit.lakebase.query(
          `
            INSERT INTO readiness.facility_reviews
              (facility_id, review_status, note, shortlisted, priority_override, reviewer, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (facility_id) DO UPDATE SET
              review_status = EXCLUDED.review_status,
              note = EXCLUDED.note,
              shortlisted = EXCLUDED.shortlisted,
              priority_override = EXCLUDED.priority_override,
              reviewer = EXCLUDED.reviewer,
              updated_at = NOW()
          `,
          [
            req.params.id,
            parsed.data.reviewStatus,
            parsed.data.note.trim(),
            parsed.data.shortlisted,
            parsed.data.priorityOverride,
            requestUser(req),
          ],
        );

        const result = await appkit.lakebase.query(RECORD_BY_ID_SQL, [req.params.id]);
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Facility not found after review update' });
          return;
        }
        res.json(mapRecord(result.rows[0]));
      } catch (err) {
        console.error('Failed to save readiness review:', err);
        res.status(500).json({ error: 'Failed to save readiness review' });
      }
    });

    app.put('/api/lakebase/readiness/corrections/:id', async (req, res) => {
      try {
        const parsed = CorrectionBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid correction payload' });
          return;
        }

        const before = await appkit.lakebase.query(RECORD_BY_ID_SQL, [req.params.id]);
        if (before.rows.length === 0) {
          res.status(404).json({ error: 'Facility not found' });
          return;
        }

        await appkit.lakebase.query(
          `
            INSERT INTO readiness.facility_field_corrections
              (facility_id, field_name, original_value, corrected_value, status, reason, evidence_note, reviewer, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (facility_id, field_name) DO UPDATE SET
              original_value = EXCLUDED.original_value,
              corrected_value = EXCLUDED.corrected_value,
              status = EXCLUDED.status,
              reason = EXCLUDED.reason,
              evidence_note = EXCLUDED.evidence_note,
              reviewer = EXCLUDED.reviewer,
              updated_at = NOW()
          `,
          [
            req.params.id,
            parsed.data.fieldName,
            sourceValueForField(before.rows[0], parsed.data.fieldName),
            parsed.data.correctedValue.trim(),
            parsed.data.status,
            parsed.data.reason.trim(),
            parsed.data.evidenceNote.trim(),
            requestUser(req),
          ],
        );

        const result = await appkit.lakebase.query(RECORD_BY_ID_SQL, [req.params.id]);
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Facility not found after correction update' });
          return;
        }
        res.json(mapRecord(result.rows[0]));
      } catch (err) {
        console.error('Failed to save facility correction:', err);
        res.status(500).json({ error: 'Failed to save facility correction' });
      }
    });
  });
}
