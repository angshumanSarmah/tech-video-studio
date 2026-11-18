import { TopicDtoSchema, TopicListResponseSchema } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, expectApiError, postJson, type TestServer } from '../testing.ts';

let s: TestServer;

beforeEach(() => {
  s = createTestServer();
});

afterEach(() => s.cleanup());

describe('/api/topics', () => {
  it('creates a topic and lists it newest first', async () => {
    await postJson(s.app, '/api/topics', { title: 'Consistent hashing' });
    const res = await postJson(s.app, '/api/topics', { title: '  Bloom filters ', notes: 'n' });

    expect(res.status).toBe(201);
    expect(TopicDtoSchema.parse(await res.json())).toMatchObject({
      title: 'Bloom filters',
      notes: 'n',
    });

    const list = TopicListResponseSchema.parse(await (await s.app.request('/api/topics')).json());
    expect(list.items.map((t) => t.title)).toEqual(['Bloom filters', 'Consistent hashing']);
    expect(list.items[1]?.notes).toBeNull();
  });

  it.each([
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(201) }, 'title'],
    [{ title: 'ok', extra: true }, ''],
    [{}, 'title'],
  ])('rejects %j with a 400 and issue paths', async (body, path) => {
    const res = await postJson(s.app, '/api/topics', body);
    const { error } = await expectApiError(res, 400, 'bad_request');
    expect(error.issues?.map((i) => i.path)).toContain(path);
  });
});
