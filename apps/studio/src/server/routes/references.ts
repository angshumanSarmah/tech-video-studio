import {
  AvoidNameSchema,
  CreateReferenceRequestSchema,
  IdParamSchema,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  UpdateReferenceRequestSchema,
  type CreateReferenceResponse,
  type ReanalyzeReferenceResponse,
  type ReferenceDetailDto,
  type ReferenceListResponse,
} from '@explainer-studio/shared';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { InvalidSourceError } from '#core/errors.ts';
import {
  addReference,
  editReferenceRecord,
  listReferences,
  reanalyzeReference,
  referenceDetail,
  type Attachment,
} from '#core/services/references.ts';
import { toReferenceDetailDto, toReferenceSummaryDto } from '../dto.ts';
import { apiError, validationError } from '../errors.ts';
import { validate } from '../validate.ts';

const ReferenceParamsSchema = z.object({ id: IdParamSchema });

/** Every screenshot at its largest, plus the breakdown and form overhead. */
const MAX_BODY_BYTES = MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES + 256 * 1024;

/**
 * The reference library (P1C.11): list, add a pasted breakdown (JSON, or multipart with
 * screenshots), view, edit the record, analyse again. Adding or reanalysing queues an
 * `analyze_reference` job (202); the server never calls a model.
 */
export function createReferencesRoute(db: Db, dataDir: string) {
  return new Hono()
    .get('/', (c) =>
      c.json<ReferenceListResponse>({ items: listReferences(db).map(toReferenceSummaryDto) }),
    )
    .post(
      '/',
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: (c) => apiError(c, 400, 'bad_request', 'The upload is too large.'),
      }),
      async (c) => {
        const parsed = isMultipart(c) ? await fromForm(c) : await fromJson(c);
        if (parsed instanceof Response) return parsed;
        const { row, job } = db.transaction((tx) =>
          addReference(tx, dataDir, parsed.request, parsed.attachments),
        );
        return c.json<CreateReferenceResponse>({ id: row.id, slug: row.slug, jobId: job.id }, 202);
      },
    )
    .get('/:id', validate('param', ReferenceParamsSchema), (c) => {
      const { id } = c.req.valid('param');
      return c.json<ReferenceDetailDto>(toReferenceDetailDto(referenceDetail(db, dataDir, id)));
    })
    .put(
      '/:id',
      validate('param', ReferenceParamsSchema),
      validate('json', UpdateReferenceRequestSchema),
      (c) => {
        const { id } = c.req.valid('param');
        const { record } = c.req.valid('json');
        db.transaction((tx) => editReferenceRecord(tx, dataDir, id, record));
        return c.json<ReferenceDetailDto>(toReferenceDetailDto(referenceDetail(db, dataDir, id)));
      },
    )
    .post('/:id/reanalyze', validate('param', ReferenceParamsSchema), (c) => {
      const { id } = c.req.valid('param');
      const job = db.transaction((tx) => reanalyzeReference(tx, dataDir, id));
      return c.json<ReanalyzeReferenceResponse>({ jobId: job.id }, 202);
    });
}

interface ParsedCreate {
  readonly request: z.output<typeof CreateReferenceRequestSchema>;
  readonly attachments: Attachment[];
}

function isMultipart(c: Context): boolean {
  return (c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data');
}

async function fromJson(c: Context): Promise<ParsedCreate | Response> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = CreateReferenceRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(c, parsed.error);
  return { request: parsed.data, attachments: [] };
}

/** Fields `breakdown`, `title`, `namesToAvoid` (JSON text) and `attachments` (files). */
async function fromForm(c: Context): Promise<ParsedCreate | Response> {
  const form = await c.req.parseBody({ all: true });
  const names = typeof form['namesToAvoid'] === 'string' ? parseNames(form['namesToAvoid']) : [];
  const parsed = CreateReferenceRequestSchema.safeParse({
    breakdown: form['breakdown'],
    ...(typeof form['title'] === 'string' ? { title: form['title'] } : {}),
    ...(names.length > 0 ? { namesToAvoid: names } : {}),
  });
  if (!parsed.success) return validationError(c, parsed.error);
  const files = [form['attachments'] ?? []].flat().filter((f): f is File => f instanceof File);
  const attachments = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
  return { request: parsed.data, attachments };
}

function parseNames(text: string): z.infer<typeof AvoidNameSchema>[] {
  let value: unknown;
  try {
    value = JSON.parse(text || '[]');
  } catch {
    value = undefined;
  }
  const parsed = z.array(AvoidNameSchema).safeParse(value);
  if (!parsed.success) {
    throw new InvalidSourceError('namesToAvoid takes a JSON list of { "text", "kind" }.');
  }
  return parsed.data;
}
