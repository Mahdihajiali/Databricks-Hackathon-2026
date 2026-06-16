import { WorkspaceClient } from '@databricks/sdk-experimental';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import type { Application, Request } from 'express';

interface AppKitWithReferralGenie {
  server: {
    extend(fn: (app: Application) => void): void;
  };
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

interface ReferralResultTable {
  attachmentId: string;
  statementId: string;
  columns: string[];
  rows: Array<Record<string, string | null>>;
}

interface GenieMcpPayload {
  content?: {
    queryAttachments?: GenieMcpQueryAttachment[];
    textAttachments?: string[];
    suggestedQuestions?: string[];
  };
  conversationId?: string;
  conversation_id?: string;
  messageId?: string;
  message_id?: string;
  status?: string;
  error?: string;
}

interface GenieMcpQueryAttachment {
  query?: string;
  description?: string;
  statement_response?: GenieStatementResponse;
  statementResponse?: GenieStatementResponse;
}

interface GenieStatementResponse {
  statement_id?: string;
  statementId?: string;
  manifest?: {
    schema?: {
      columns?: Array<{
        name?: string;
        type_name?: string;
        type_text?: string;
      }>;
    };
  };
  result?: {
    data_array?: GenieDataRow[];
  };
}

type GenieDataRow = GenieDataCell[] | { values?: GenieDataCell[] };
type GenieDataCell =
  | string
  | number
  | boolean
  | null
  | {
      string_value?: string;
      long_value?: number;
      double_value?: number;
      boolean_value?: boolean;
      null_value?: boolean;
    };

interface GenieMcpResponse {
  payload: GenieMcpPayload;
  conversationId?: string;
  messageId?: string;
  statuses: string[];
  queries: ReferralQuery[];
  tables: ReferralResultTable[];
}

const referralRequestSchema = z.object({
  query: z.string().trim().min(4).max(500),
});

const llmPlanSchema = z.object({
  careNeed: z.string().trim().min(1).max(120),
  primaryLocation: z.string().trim().min(1).max(120),
  careTerms: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  nearbyLocations: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  urgency: z.enum(['routine', 'urgent_or_emergency', 'unknown']).default('unknown'),
});

const workspaceClient = new WorkspaceClient({});
const DEFAULT_LLM_ENDPOINT = 'databricks-meta-llama-3-3-70b-instruct';
const GENIE_TIMEOUT_MS = 120000;
const GENIE_POLL_INTERVAL_MS = 3000;
const GENIE_MAX_POLLS = 30;
const MAX_TERMS = 10;
const MAX_LOCATIONS = 10;

const CARE_TERM_HINTS: Array<{ pattern: RegExp; terms: string[] }> = [
  {
    pattern: /cardio|cardiac|heart/i,
    terms: [
      'cardiology',
      'heart specialist',
      'heart clinic',
      'cardiac clinic',
      'cardiac care',
      'heart care',
      'cardiologist',
      'echocardiography',
      'angioplasty',
      'cath lab',
    ],
  },
  {
    pattern: /dialysis|kidney|renal|nephro/i,
    terms: [
      'dialysis',
      'hemodialysis',
      'nephrology',
      'renal care',
      'kidney care',
      'dialysis unit',
      'dialysis machine',
      'nephrologist',
    ],
  },
  {
    pattern: /emergency|trauma|urgent|surgery|operation/i,
    terms: [
      'emergency surgery',
      'trauma',
      'general surgery',
      'operating theatre',
      'operation theatre',
      'ICU',
      'blood bank',
      'critical care',
    ],
  },
  {
    pattern: /neonatal|nicu|newborn|infant/i,
    terms: [
      'neonatal ICU',
      'NICU',
      'neonatology',
      'newborn care',
      'pediatric ICU',
      'pediatrician',
      'incubator',
      'ventilator',
    ],
  },
  {
    pattern: /cancer|oncology|chemo/i,
    terms: [
      'oncology',
      'cancer care',
      'chemotherapy',
      'medical oncology',
      'surgical oncology',
      'radiation oncology',
      'cancer hospital',
    ],
  },
];

const LOCATION_HINTS: Array<{ pattern: RegExp; locations: string[] }> = [
  {
    pattern: /\bpune\b/i,
    locations: ['Pune', 'Pimpri-Chinchwad', 'PCMC', 'Hinjewadi', 'Wakad', 'Baner', 'Aundh', 'Kothrud', 'Hadapsar', 'Kharadi'],
  },
  {
    pattern: /\bjaipur\b/i,
    locations: ['Jaipur', 'Malviya Nagar', 'Mansarovar', 'Vaishali Nagar', 'Sanganer', 'Jagatpura', 'Tonk Road', 'C Scheme'],
  },
  {
    pattern: /\bpatna\b/i,
    locations: ['Patna', 'Kankarbagh', 'Danapur', 'Patliputra', 'Bailey Road', 'Rajendra Nagar', 'Boring Road', 'Phulwari Sharif'],
  },
  {
    pattern: /\blucknow\b/i,
    locations: ['Lucknow', 'Gomti Nagar', 'Indira Nagar', 'Aliganj', 'Hazratganj', 'Jankipuram', 'Aminabad', 'Vikas Nagar'],
  },
];

const REFERRAL_COPILOT_SYSTEM_PROMPT = `
You are Referral Copilot for a Databricks App used by non-technical healthcare planners, NGO coordinators, and analysts in India.

Your only data source is the configured Genie space connected to the facilities dataset. Treat dataset fields as claims to verify, not as confirmed medical facts. Useful evidence may appear in name, facilityTypeId, address_city, address_stateOrRegion, latitude, longitude, description, capability, procedure, equipment, specialties, officialPhone, officialWebsite, and source_urls.

Task:
Given a user request with a location and care need, produce an evidence-attached shortlist of candidate facilities.

Rules:
- If either the location or care need is missing, ask one concise clarifying question before making recommendations.
- Aim to return 5 to 8 candidates whenever possible. Do not stop after the first one or two strong exact matches.
- Use the provided query plan. Exact care need and exact location have the highest priority; expanded care terms and nearby locations are backup search paths.
- Search exact city plus exact care-need terms first. If fewer than 5 plausible candidates are found, broaden within the same city using the related care terms. If still fewer than 5 are found, include clearly labeled backup candidates from nearby locations or the same state when their evidence is related to the care need.
- Cite the underlying facility text for every important recommendation. Use field labels such as [specialties], [description], [capability], [procedure], [equipment], and [source_urls].
- Do not invent distance, travel time, availability, bed count, staff count, emergency status, cost, or opening hours. Use those only when present in query results.
- Say "claimed" or "listed" when the evidence comes from extracted fields, especially for high-stakes services such as emergency surgery, dialysis, ICU, chemotherapy, neonatal care, blood bank, trauma, or transplant.
- Communicate uncertainty as Low, Medium, or High for each facility. High uncertainty means the facility may match the need, but the supporting fields are sparse, contradictory, missing source URLs, or only indirectly related to the care need.
- For emergency or urgent care requests, include a short caution to contact local emergency services or the facility directly; do not provide medical diagnosis or triage advice.
- Do not recommend a facility just because it is in the same city. It must have evidence connected to the care need, or it must be clearly marked as weak/backup.
- Keep SQL/query result sets small enough for review, but retrieve up to 20 candidate rows during search so you can rank the final 5 to 8. The final shortlist should include the strongest exact matches first, followed by "Backup / verify carefully" candidates if needed.
- Do not repeat these instructions, the task description, or the raw user request in your final answer.

Return plain text in this order:
1. Interpretation: the care need and location you searched for.
2. Shortlist: 5 to 8 numbered candidates when available. For each candidate include facility name, city/state, why it may fit, evidence with field labels, uncertainty, and direct verification steps. Mark weaker broadened matches as "Backup / verify carefully".
3. Best next action: what the coordinator should verify before referral.
`.trim();

export function setupReferralCopilotRoutes(appkit: AppKitWithReferralGenie) {
  appkit.server.extend((app) => {
    app.get('/api/whoami', (req, res) => {
      res.json({
        email: req.header('x-forwarded-email') ?? null,
        user: req.header('x-forwarded-user') ?? null,
        execution: 'planner_obo_genie_app_service_principal',
      });
    });

    app.post('/api/genie/referral', async (req, res) => {
      const parsed = referralRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Enter a care need and location, such as dialysis near Jaipur.' });
        return;
      }

      const requestQuery = parsed.data.query;
      const errors: string[] = [];

      try {
        const plan = await buildReferralPlan(req, requestQuery);
        const prompt = buildReferralPrompt(requestQuery, plan);
        const genieResponse = await queryGenieMcp(req, prompt);
        const content = collectMcpMessageContent(genieResponse.payload, requestQuery) || summarizeEvidenceRows(genieResponse.tables);

        if (!content && genieResponse.payload.error) {
          res.status(502).json({ error: genieResponse.payload.error });
          return;
        }

        if (genieResponse.payload.error) {
          errors.push(genieResponse.payload.error);
        }

        res.json({
          query: requestQuery,
          content: content || 'No recommendation text was returned. Try a more specific care need and location.',
          conversationId: genieResponse.conversationId,
          messageId: genieResponse.messageId,
          statuses: genieResponse.statuses,
          queries: genieResponse.queries,
          tables: genieResponse.tables,
          errors,
          plan,
          engine: {
            genieMode: 'managed_mcp',
            planner: plan.source,
          },
          generatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('[referral-copilot] Genie MCP referral request failed', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Referral Copilot could not complete the request.',
        });
      }
    });
  });
}

async function buildReferralPlan(req: Request, query: string): Promise<ReferralPlan> {
  try {
    const llmText = await callPlannerLlm(req, query);
    const parsedJson = parseJsonObject(llmText);
    const parsedPlan = llmPlanSchema.safeParse(parsedJson);

    if (parsedPlan.success) {
      return normalizePlan(
        {
          ...parsedPlan.data,
          source: 'llm',
        },
        query,
      );
    }
  } catch (error) {
    console.warn('[referral-copilot] LLM query planner fell back to local hints', error);
  }

  return normalizePlan(
    {
      ...buildFallbackPlan(query),
      source: 'fallback',
    },
    query,
  );
}

async function callPlannerLlm(req: Request, query: string) {
  const endpointName = process.env.DATABRICKS_REFERRAL_LLM_ENDPOINT ?? process.env.DATABRICKS_SERVING_ENDPOINT_NAME ?? DEFAULT_LLM_ENDPOINT;
  const host = await getDatabricksHost();
  const headers = await buildDatabricksHeaders(req, {
    'Content-Type': 'application/json',
  });

  const response = await fetch(`${host}/serving-endpoints/${encodeURIComponent(endpointName)}/invocations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content:
            'You are a healthcare referral query planner for India. Return only compact JSON. No markdown, no prose.',
        },
        {
          role: 'user',
          content: `Extract a care-search plan from the request. Include 6-10 careTerms with common Indian facility wording, and 6-10 nearbyLocations that are neighborhoods, satellite cities, abbreviations, or adjacent localities near the primary location. Prioritize the exact care need and exact place first. Schema: {"careNeed":string,"primaryLocation":string,"careTerms":string[],"nearbyLocations":string[],"urgency":"routine"|"urgent_or_emergency"|"unknown"}. Request: ${query}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Planner LLM failed with HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }

  return extractChatContent(await response.json());
}

function buildFallbackPlan(query: string): Omit<ReferralPlan, 'source'> {
  const parsed = parseCareNeedAndLocation(query);
  const careTerms = CARE_TERM_HINTS.find((entry) => entry.pattern.test(query))?.terms ?? [parsed.careNeed];
  const nearbyLocations = LOCATION_HINTS.find((entry) => entry.pattern.test(query))?.locations ?? [parsed.primaryLocation];
  const urgency = /emergency|urgent|trauma|accident|icu|critical/i.test(query) ? 'urgent_or_emergency' : 'routine';

  return {
    careNeed: parsed.careNeed,
    primaryLocation: parsed.primaryLocation,
    careTerms,
    nearbyLocations,
    urgency,
  };
}

function parseCareNeedAndLocation(query: string) {
  const match = query.match(/^(.*?)\s+(?:near|in|around|at)\s+(.+)$/i);
  if (match) {
    return {
      careNeed: match[1]?.trim() || query.trim(),
      primaryLocation: match[2]?.trim() || 'India',
    };
  }

  return {
    careNeed: query.trim(),
    primaryLocation: 'India',
  };
}

function normalizePlan(plan: Omit<ReferralPlan, 'source'> & { source: ReferralPlan['source'] }, originalQuery: string): ReferralPlan {
  const fallback = buildFallbackPlan(originalQuery);
  const careNeed = plan.careNeed || fallback.careNeed;
  const primaryLocation = plan.primaryLocation || fallback.primaryLocation;

  return {
    careNeed,
    primaryLocation,
    careTerms: uniqueNonEmpty([careNeed, ...plan.careTerms, ...fallback.careTerms]).slice(0, MAX_TERMS),
    nearbyLocations: uniqueNonEmpty([primaryLocation, ...plan.nearbyLocations, ...fallback.nearbyLocations]).slice(0, MAX_LOCATIONS),
    urgency: plan.urgency,
    source: plan.source,
  };
}

function buildReferralPrompt(query: string, plan: ReferralPlan) {
  return `${REFERRAL_COPILOT_SYSTEM_PROMPT}

User referral request:
${query}

Query plan generated before asking Genie:
- Primary care need: ${plan.careNeed}
- Care-term priority list: ${plan.careTerms.join(', ')}
- Primary location: ${plan.primaryLocation}
- Location priority list: ${plan.nearbyLocations.join(', ')}
- Urgency signal: ${plan.urgency}

Use the primary care need and primary location first. Use the expanded terms and nearby locations only to increase recall after exact matches are checked.`;
}

async function queryGenieMcp(req: Request, prompt: string): Promise<GenieMcpResponse> {
  const spaceId = getGenieSpaceId();
  const client = new Client({ name: 'caretrust-referral-copilot', version: '1.0.0' });
  const host = await getDatabricksHost();
  const headers = await buildDatabricksHeaders(req, undefined, { useForwardedToken: false });
  const transport = new StreamableHTTPClientTransport(new URL(`${host}/api/2.0/mcp/genie/${encodeURIComponent(spaceId)}`), {
    requestInit: {
      headers: Object.fromEntries(headers.entries()),
      signal: AbortSignal.timeout(GENIE_TIMEOUT_MS),
    },
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools(undefined, { timeout: GENIE_TIMEOUT_MS });
    const queryTool = tools.tools.find((tool) => tool.name.startsWith('query_space_'))?.name;
    const pollTool = tools.tools.find((tool) => tool.name.startsWith('poll_response_'))?.name;

    if (!queryTool || !pollTool) {
      throw new Error('The configured Genie MCP server did not expose the expected query and poll tools.');
    }

    let result = await client.callTool({ name: queryTool, arguments: { query: prompt } }, undefined, { timeout: GENIE_TIMEOUT_MS });
    let payload = parseMcpPayload(result);
    const statuses = uniqueNonEmpty([payload.status]);
    const conversationId = getPayloadConversationId(payload);
    const messageId = getPayloadMessageId(payload);

    if (!conversationId || !messageId) {
      throw new Error('Genie MCP did not return a conversation_id and message_id.');
    }

    for (let pollCount = 0; !isTerminalGenieStatus(payload.status) && pollCount < GENIE_MAX_POLLS; pollCount += 1) {
      await wait(GENIE_POLL_INTERVAL_MS);
      result = await client.callTool(
        {
          name: pollTool,
          arguments: {
            conversation_id: conversationId,
            message_id: messageId,
          },
        },
        undefined,
        { timeout: GENIE_TIMEOUT_MS },
      );
      payload = parseMcpPayload(result);
      statuses.push(...uniqueNonEmpty([payload.status]));
    }

    if (!isTerminalGenieStatus(payload.status)) {
      throw new Error('Genie MCP is still processing. Try a narrower care need or location.');
    }

    if (payload.status === 'FAILED') {
      throw new Error(payload.error || 'Genie MCP reported that the request failed.');
    }

    const attachments = payload.content?.queryAttachments ?? [];

    return {
      payload,
      conversationId,
      messageId,
      statuses: Array.from(new Set(statuses)),
      queries: attachments.map(mapMcpQuery),
      tables: attachments.map(mapMcpTable).filter((table): table is ReferralResultTable => Boolean(table)),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function getGenieSpaceId() {
  const spaceId = process.env.DATABRICKS_GENIE_SPACE_ID;
  if (!spaceId) {
    throw new Error('DATABRICKS_GENIE_SPACE_ID is not configured for the Genie MCP server.');
  }
  return spaceId;
}

async function getDatabricksHost() {
  const envHost = process.env.DATABRICKS_HOST;
  if (envHost) {
    return normalizeDatabricksHost(envHost);
  }

  const host = await workspaceClient.config.getHost();
  return normalizeDatabricksHost(host.origin);
}

function normalizeDatabricksHost(host: string) {
  const trimmed = host.trim().replace(/\/$/, '');
  if (!trimmed) {
    throw new Error('Databricks workspace host is not configured.');
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function buildDatabricksHeaders(
  req: Request,
  baseHeaders?: Record<string, string>,
  options: { useForwardedToken?: boolean } = {},
) {
  const headers = new Headers(baseHeaders);
  const forwardedToken = req.header('x-forwarded-access-token');

  if (options.useForwardedToken !== false && forwardedToken) {
    headers.set('Authorization', forwardedToken.startsWith('Bearer ') ? forwardedToken : `Bearer ${forwardedToken}`);
  } else {
    await workspaceClient.config.authenticate(headers);
  }

  return headers;
}

function parseMcpPayload(result: unknown): GenieMcpPayload {
  if (!isRecord(result)) {
    return {};
  }

  if (isRecord(result.structuredContent)) {
    return result.structuredContent;
  }

  const contentParts: unknown[] = Array.isArray(result.content) ? result.content : [];
  const textPayload = contentParts
    .filter(isTextContentPart)
    .map((part) => part.text)
    .join('\n')
    .trim();

  const parsed = parseJsonObject(textPayload);
  if (isRecord(parsed)) {
    return parsed;
  }

  return {};
}

function collectMcpMessageContent(payload: GenieMcpPayload, query: string) {
  const answerParts = (payload.content?.textAttachments ?? [])
    .map((part) => stripReferralPromptEcho(part, query))
    .map((part) => part.trim())
    .filter(Boolean);

  return Array.from(new Set(answerParts)).join('\n\n');
}

function stripReferralPromptEcho(content: string, query: string) {
  const requestMarker = 'User referral request:';
  const answerMarkers = ['\nInterpretation:', '\n1. Interpretation:', '\nShortlist:', '\nTwo facilities'];
  const requestIndex = content.indexOf(requestMarker);

  if (requestIndex === -1) {
    return content;
  }

  const queryIndex = content.indexOf(query, requestIndex + requestMarker.length);
  if (queryIndex !== -1) {
    return content.slice(queryIndex + query.length).trim();
  }

  for (const marker of answerMarkers) {
    const answerIndex = content.indexOf(marker, requestIndex + requestMarker.length);
    if (answerIndex !== -1) {
      return content.slice(answerIndex).trim();
    }
  }

  return '';
}

function summarizeEvidenceRows(tables: ReferralResultTable[]) {
  const rows = tables.flatMap((table) => table.rows).slice(0, 8);
  if (rows.length === 0) {
    return '';
  }

  const lines = rows.map((row, index) => {
    const name = row.name ?? row.facility_name ?? `Candidate ${index + 1}`;
    const city = row.address_city ?? row.city ?? 'city not listed';
    const state = row.address_stateOrRegion ?? row.state ?? 'state not listed';
    const evidence = row.description ?? row.capability ?? row.procedure ?? row.specialties ?? 'Evidence fields returned by Genie should be verified.';
    return `${index + 1}. ${name} (${city}, ${state}) - Evidence returned by Genie: ${evidence}`;
  });

  return `Interpretation: Genie returned evidence rows, but no narrative answer.\n\nShortlist:\n${lines.join('\n')}\n\nBest next action: Verify the listed service directly with the facility before referral.`;
}

function mapMcpQuery(attachment: GenieMcpQueryAttachment, index: number): ReferralQuery {
  const statementResponse = attachment.statement_response ?? attachment.statementResponse;
  return {
    title: index === 0 ? 'List of Facilities' : `List of Facilities ${index + 1}`,
    query: attachment.query,
    statementId: statementResponse?.statement_id ?? statementResponse?.statementId,
  };
}

function mapMcpTable(attachment: GenieMcpQueryAttachment, index: number): ReferralResultTable | null {
  const statementResponse = attachment.statement_response ?? attachment.statementResponse;
  const statementId = statementResponse?.statement_id ?? statementResponse?.statementId ?? `mcp-statement-${index + 1}`;
  const columns = (statementResponse?.manifest?.schema?.columns ?? [])
    .map((column) => column.name)
    .filter((column): column is string => Boolean(column));

  if (columns.length === 0) {
    return null;
  }

  const rows = (statementResponse?.result?.data_array ?? []).slice(0, 25).map((row) => {
    const cells = Array.isArray(row) ? row : row.values ?? [];
    return Object.fromEntries(columns.map((column, cellIndex) => [column, formatGenieCell(cells[cellIndex])]));
  });

  return {
    attachmentId: `mcp-attachment-${index + 1}`,
    statementId,
    columns,
    rows,
  };
}

function formatGenieCell(value: GenieDataCell | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value.null_value) {
    return null;
  }

  if (value.string_value !== undefined) {
    return value.string_value;
  }

  if (value.long_value !== undefined) {
    return String(value.long_value);
  }

  if (value.double_value !== undefined) {
    return String(value.double_value);
  }

  if (value.boolean_value !== undefined) {
    return String(value.boolean_value);
  }

  return JSON.stringify(value);
}

function getPayloadConversationId(payload: GenieMcpPayload) {
  return payload.conversationId ?? payload.conversation_id;
}

function getPayloadMessageId(payload: GenieMcpPayload) {
  return payload.messageId ?? payload.message_id;
}

function isTerminalGenieStatus(status: string | undefined) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

function extractChatContent(value: unknown) {
  if (!isRecord(value)) {
    return '';
  }

  const choices = Array.isArray(value.choices) ? value.choices : [];
  const firstChoice = choices.find(isRecord);
  const message = isRecord(firstChoice?.message) ? firstChoice.message : null;
  const content = message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!isRecord(part)) {
          return '';
        }
        if (typeof part.text === 'string') {
          return part.text;
        }
        if (typeof part.summary_text === 'string') {
          return part.summary_text;
        }
        return '';
      })
      .join('\n');
  }

  return '';
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed;
  } catch {
    return null;
  }
}

function isTextContentPart(value: unknown): value is { type: 'text'; text: string } {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string';
}

function uniqueNonEmpty(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(normalized);
  }

  return results;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
