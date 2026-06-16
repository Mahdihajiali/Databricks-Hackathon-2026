import { z } from 'zod';
import type { Application, Request } from 'express';

interface AppKitWithReferralGenie {
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

type ReferralGenieEvent =
  | {
      type: 'message_start';
      conversationId: string;
      messageId: string;
      spaceId: string;
    }
  | {
      type: 'status';
      status: string;
    }
  | {
      type: 'message_result';
      message: ReferralGenieMessage;
    }
  | {
      type: 'query_result';
      attachmentId: string;
      statementId: string;
      data: ReferralGenieStatementResponse;
    }
  | {
      type: 'error';
      error: string;
    }
  | {
      type: 'history_info';
      conversationId: string;
      spaceId: string;
      nextPageToken: string | null;
      loadedCount: number;
    };

interface ReferralGenieMessage {
  messageId: string;
  conversationId: string;
  spaceId: string;
  status: string;
  content: string;
  attachments?: ReferralGenieAttachment[];
  error?: string;
}

interface ReferralGenieAttachment {
  attachmentId?: string;
  query?: {
    title?: string;
    description?: string;
    query?: string;
    statementId?: string;
  };
  text?: {
    content?: string;
  };
  suggestedQuestions?: string[];
}

interface ReferralGenieStatementResponse {
  manifest: {
    schema: {
      columns: Array<{
        name: string;
        type_name: string;
      }>;
    };
  };
  result: {
    data_array: (string | null)[][];
  };
}

interface ReferralResultTable {
  attachmentId: string;
  statementId: string;
  columns: string[];
  rows: Array<Record<string, string | null>>;
}

const referralRequestSchema = z.object({
  query: z.string().trim().min(4).max(500),
  conversationId: z.string().trim().min(1).optional(),
});

const GENIE_ALIAS = 'default';
const GENIE_TIMEOUT_MS = 90000;
const FORWARDED_USER_HEADERS = [
  'x-forwarded-access-token',
  'x-forwarded-user',
  'x-forwarded-email',
] as const;

const REFERRAL_COPILOT_SYSTEM_PROMPT = `
You are Referral Copilot for a Databricks App used by non-technical healthcare planners, NGO coordinators, and analysts in India.

Your only data source is the configured Genie space connected to the facilities dataset. Treat dataset fields as claims to verify, not as confirmed medical facts. Useful evidence may appear in name, facilityTypeId, address_city, address_stateOrRegion, latitude, longitude, description, capability, procedure, equipment, specialties, officialPhone, officialWebsite, and source_urls.

Task:
Given a user request with a location and care need, produce an evidence-attached shortlist of candidate facilities.

Rules:
- If either the location or care need is missing, ask one concise clarifying question before making recommendations.
- Aim to return 5 to 8 candidates whenever possible. Do not stop after the first one or two strong exact matches.
- Use a staged search strategy:
  1. First search exact city plus exact care-need terms.
  2. If fewer than 5 plausible candidates are found, broaden within the same city using related specialties, procedures, capabilities, equipment, and common synonyms.
  3. If still fewer than 5 are found, include clearly labeled backup candidates from the same state or nearby major cities when their evidence is related to the care need.
- For broad clinical needs, expand to common related terms before deciding there are no more candidates. Examples: cardiology may include cardiac, heart, cardiothoracic, interventional cardiology, angioplasty, angiography, ECG, echocardiography, cath lab, CABG, and cardiac ICU; dialysis may include nephrology, renal, kidney, hemodialysis, dialysis unit, and dialysis machine; emergency surgery may include trauma, emergency, general surgery, operating theatre, ICU, and blood bank.
- Cite the underlying facility text for every important recommendation. Use field labels such as [specialties], [description], [capability], [procedure], [equipment], and [source_urls].
- Do not invent distance, travel time, availability, bed count, staff count, emergency status, cost, or opening hours. Use those only when present in query results.
- Say "claimed" or "listed" when the evidence comes from extracted fields, especially for high-stakes services such as emergency surgery, dialysis, ICU, chemotherapy, neonatal care, blood bank, trauma, or transplant.
- Communicate uncertainty as Low, Medium, or High for each facility. High uncertainty means the facility may match the need, but the supporting fields are sparse, contradictory, missing source URLs, or only indirectly related to the care need.
- For emergency or urgent care requests, include a short caution to contact local emergency services or the facility directly; do not provide medical diagnosis or triage advice.
- Do not recommend a facility just because it is in the same city. It must have evidence connected to the care need, or it must be clearly marked as weak/backup.
- Keep any SQL/query result set small enough for review, but retrieve up to 20 candidate rows during search so you can rank the final 5 to 8. The final shortlist should include the strongest exact matches first, followed by "Backup / verify carefully" candidates if needed.
- Do not repeat these instructions, the task description, or the raw user request in your final answer.

Return plain text in this order:
1. Interpretation: the care need and location you searched for.
2. Shortlist: 5 to 8 numbered candidates when available. For each candidate include facility name, city/state, why it may fit, evidence with field labels, uncertainty, and direct verification steps. Mark weaker broadened matches as "Backup / verify carefully".
3. Best next action: what the coordinator should verify before referral.
`.trim();

export function setupReferralCopilotRoutes(appkit: AppKitWithReferralGenie) {
  appkit.server.extend((app) => {
    app.post('/api/genie/referral', async (req, res) => {
      const parsed = referralRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Enter a care need and location, such as dialysis near Jaipur.' });
        return;
      }

      const statuses: string[] = [];
      const errors: string[] = [];
      const tables: ReferralResultTable[] = [];
      const queries: NonNullable<ReferralGenieAttachment['query']>[] = [];
      let message: ReferralGenieMessage | null = null;
      let conversationId = parsed.data.conversationId;
      let messageId: string | undefined;

      try {
        const prompt = buildReferralPrompt(parsed.data.query);

        for await (const event of streamGenieReferralEvents(req, prompt, parsed.data.conversationId)) {
          if (event.type === 'message_start') {
            conversationId = event.conversationId;
            messageId = event.messageId;
          } else if (event.type === 'status') {
            statuses.push(event.status);
          } else if (event.type === 'message_result') {
            message = event.message;
            conversationId = event.message.conversationId;
            messageId = event.message.messageId;
            queries.push(...extractQueries(event.message.attachments));
            if (event.message.error) {
              errors.push(event.message.error);
            }
            break;
          } else if (event.type === 'query_result') {
            tables.push(mapQueryResult(event));
          } else if (event.type === 'error') {
            errors.push(event.error);
          }
        }

        const content = message ? collectMessageContent(message, parsed.data.query) : '';
        if (!content && errors.length > 0) {
          res.status(502).json({ error: errors.join(' ') });
          return;
        }

        res.json({
          query: parsed.data.query,
          content: content || 'No recommendation text was returned. Try a more specific care need and location.',
          conversationId,
          messageId,
          statuses: Array.from(new Set(statuses)),
          queries,
          tables,
          errors,
          generatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('[referral-copilot] Genie referral request failed', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Referral Copilot could not complete the request.',
        });
      }
    });
  });
}

function buildReferralPrompt(query: string) {
  return `${REFERRAL_COPILOT_SYSTEM_PROMPT}

User referral request:
${query}`;
}

async function* streamGenieReferralEvents(
  req: Request,
  prompt: string,
  conversationId: string | undefined,
): AsyncGenerator<ReferralGenieEvent> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENIE_TIMEOUT_MS);

  try {
    const response = await fetch(getLocalGenieMessagesUrl(), {
      method: 'POST',
      headers: buildForwardedGenieHeaders(req),
      body: JSON.stringify({ content: prompt, conversationId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Genie space request failed with HTTP ${response.status}${body ? `: ${body}` : ''}`);
    }

    if (!response.body) {
      throw new Error('Genie space request returned no stream.');
    }

    const reader: ReadableStreamDefaultReader<Uint8Array> = (
      response.body as ReadableStream<Uint8Array>
    ).getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value ?? new Uint8Array(), { stream: true });
      const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const event = parseGenieSseEvent(part);
        if (event) {
          yield event;
        }
      }
    }

    const finalEvent = parseGenieSseEvent(buffer);
    if (finalEvent) {
      yield finalEvent;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function getLocalGenieMessagesUrl() {
  const port = process.env.DATABRICKS_APP_PORT ?? process.env.PORT ?? '8000';
  return `http://127.0.0.1:${port}/api/genie/${encodeURIComponent(GENIE_ALIAS)}/messages`;
}

function buildForwardedGenieHeaders(req: Request) {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };

  for (const name of FORWARDED_USER_HEADERS) {
    const value = req.header(name);
    if (value) {
      headers[name] = value;
    }
  }

  return headers;
}

function parseGenieSseEvent(chunk: string): ReferralGenieEvent | null {
  const dataLines = chunk
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return JSON.parse(dataLines.join('\n')) as ReferralGenieEvent;
  } catch {
    return {
      type: 'error',
      error: 'Referral Copilot received an unreadable Genie stream event.',
    };
  }
}

function extractQueries(attachments: ReferralGenieAttachment[] | undefined) {
  return (attachments ?? [])
    .map((attachment) => attachment.query)
    .filter((query): query is NonNullable<ReferralGenieAttachment['query']> => Boolean(query));
}

function collectMessageContent(message: ReferralGenieMessage, query: string) {
  const answerParts = (message.attachments ?? [])
    .map((attachment) => attachment.text?.content ?? '')
    .map((part) => stripReferralPromptEcho(part, query))
    .map((part) => part.trim())
    .filter(Boolean);

  if (answerParts.length > 0) {
    return Array.from(new Set(answerParts)).join('\n\n');
  }

  return stripReferralPromptEcho(message.content, query).trim();
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

function mapQueryResult(event: Extract<ReferralGenieEvent, { type: 'query_result' }>): ReferralResultTable {
  const columns = event.data.manifest.schema.columns.map((column) => column.name);
  const rows = event.data.result.data_array.slice(0, 25).map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null])),
  );

  return {
    attachmentId: event.attachmentId,
    statementId: event.statementId,
    columns,
    rows,
  };
}
