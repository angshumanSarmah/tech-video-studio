import { join } from 'node:path';
import { DEFAULT_VIDEO_SETTINGS } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { buildPrompt } from '../prompt-builder.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '../prompts/templates.ts';
import { houseStyleText } from './house-style.ts';
import { assetCatalogue, assetUserMessage } from './input.ts';
import { DRAFT_SVGS } from './testing.ts';

const templates = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));

const REQUEST = {
  id: 'example_thread',
  name: 'Example thread',
  family: 'dev' as const,
  description: '<example-description>',
  usedIn: ['<example-narration>'],
  closest: ['cpu'],
};
const EXAMPLES = [{ id: 'cpu', name: 'CPU', family: 'infra' as const, svg: DRAFT_SVGS[0] }];

function prompt(feedback?: Parameters<typeof assetUserMessage>[2]) {
  return buildPrompt(templates, {
    role: 'asset',
    variables: DEFAULT_VIDEO_SETTINGS,
    catalogue: assetCatalogue(houseStyleText()),
    input: assetUserMessage(REQUEST, EXAMPLES, feedback),
  });
}

describe('the Asset drafter prompt', () => {
  it('is the role prompt, its schema, closed lists and house style, then the request', async () => {
    const built = prompt({
      round: 2,
      earlier: [{ number: 1, concept: '<example-concept>' }],
      notes: ['<example-note>'],
    });
    expect(built.versions).toEqual({ preamble: null, role: 'asset@v1' });
    const text = built.messages.map((m) => `===== ${m.role} =====\n${m.content}\n`).join('\n');
    await expect(text).toMatchFileSnapshot('./__snapshots__/asset.draft.prompt.txt');
  });

  it('keeps one system message for every request (it caches)', () => {
    const other = buildPrompt(templates, {
      role: 'asset',
      variables: DEFAULT_VIDEO_SETTINGS,
      catalogue: assetCatalogue(houseStyleText()),
      input: assetUserMessage({ ...REQUEST, id: 'other' }, []),
    });
    expect(other.messages[0]).toEqual(prompt().messages[0]);
  });

  it('adds FEEDBACK only on a later round', () => {
    expect(prompt().messages[1]?.content).not.toContain('FEEDBACK');
  });
});
