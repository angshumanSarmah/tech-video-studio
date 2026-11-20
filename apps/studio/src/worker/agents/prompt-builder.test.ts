import { join } from 'node:path';
import { SettingsSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import type { BuiltPrompt } from '#worker/llm/types.ts';
import { buildPrompt, fillTemplate, PromptBuildError, type PromptParts } from './prompt-builder.ts';
import { resolvePromptVariables } from './prompt-variables.ts';
import {
  loadPromptTemplates,
  PROMPT_ROLES,
  PROMPTS_DIR,
  type PromptRole,
} from './prompts/templates.ts';

const templates = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const variables = resolvePromptVariables(undefined, SettingsSchema.parse({}).video);

/** Fixture sections, written as placeholders like the catalogue's own examples. */
const FIXTURE = {
  catalogue:
    '## ALLOWED PATTERNS (exhaustive: use only these ids)\n- <example-pattern-id>: <example description>',
  references:
    '## REFERENCE BREAKDOWNS (structure only)\n- <example-reference>: hook, 6 beats, spec card',
  styleRules: '## STYLE RULES\n- <example-style-rule>',
  input: '{"topic": "<example-topic>", "notes": "<example-notes>"}',
};

function parts(role: PromptRole, extra: Partial<PromptParts> = {}): PromptParts {
  return {
    role,
    variables,
    catalogue: FIXTURE.catalogue,
    styleRules: FIXTURE.styleRules,
    ...(role === 'director' ? { references: FIXTURE.references } : {}),
    input: FIXTURE.input,
    ...extra,
  };
}

function render(prompt: BuiltPrompt): string {
  return prompt.messages.map((m) => `===== ${m.role} =====\n${m.content}\n`).join('\n');
}

describe('buildPrompt snapshots (default settings)', () => {
  it.each(PROMPT_ROLES)('%s', async (role) => {
    const prompt = buildPrompt(templates, parts(role));
    await expect(render(prompt)).toMatchFileSnapshot(`./__snapshots__/${role}.prompt.txt`);
  });
});

describe('buildPrompt', () => {
  it('puts static sections first in the documented order, the run input last', () => {
    const prompt = buildPrompt(templates, parts('director'));
    expect(prompt.messages.map((m) => m.role)).toEqual(['system', 'user']);
    const system = prompt.messages[0]!.content;
    const order = [
      'You are part of Tech Explainer Studio',
      'Role: Director.',
      FIXTURE.catalogue,
      FIXTURE.references,
      FIXTURE.styleRules,
    ].map((text) => system.indexOf(text));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(prompt.messages[1]!.content).toBe(FIXTURE.input);
  });

  it('puts a role’s registered output schema right after its role prompt', () => {
    const system = buildPrompt(templates, parts('researcher')).messages[0]!.content;
    const order = ['Role: Researcher.', '## OUTPUT SHAPE', '"hooks"', FIXTURE.catalogue].map(
      (text) => system.indexOf(text),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const director = buildPrompt(templates, parts('director')).messages[0]!.content;
    expect(director).not.toContain('## OUTPUT SHAPE');
  });

  it('keeps the system message identical across runs with different input (cache prefix)', () => {
    const a = buildPrompt(templates, parts('generator', { input: '{"beat": "<example-a>"}' }));
    const b = buildPrompt(templates, parts('generator', { input: '{"beat": "<example-b>"}' }));
    expect(a.messages[0]).toEqual(b.messages[0]);
  });

  it('records the preamble and role prompt versions', () => {
    expect(buildPrompt(templates, parts('scriptwriter')).versions).toEqual({
      preamble: 'preamble@v1',
      role: 'scriptwriter@v1',
    });
  });

  it('fills every variable, leaving no placeholder', () => {
    for (const role of PROMPT_ROLES) {
      const text = render(buildPrompt(templates, parts(role)));
      expect(text).not.toMatch(/\{\{|\}\}/);
    }
    const director = render(buildPrompt(templates, parts('director')));
    expect(director).toContain('Length: 45-150 s by topic depth; over 90 s only');
    expect(director).toContain('If parts are allowed (true)');
    expect(director).toContain('split it into 2-4 parts');
    expect(render(buildPrompt(templates, parts('scriptwriter')))).toContain(
      'About 2.7 words per second',
    );
  });

  it('changes the filled values with the settings, not the prompt', () => {
    const custom = { ...variables, lengthMaxSec: 120, allowParts: false };
    const text = render(buildPrompt(templates, parts('director', { variables: custom })));
    expect(text).toContain('45-120 s');
    expect(text).toContain('If parts are allowed (false)');
  });

  it('leaves out empty optional sections', () => {
    const prompt = buildPrompt(templates, { role: 'analyst', variables, input: 'note' });
    expect(prompt.messages[0]!.content).not.toContain('\n\n\n');
    expect(prompt.messages[0]!.content.endsWith('or rejects every rule.')).toBe(true);
  });

  it('refuses reference breakdowns outside the director, and empty input', () => {
    expect(() => buildPrompt(templates, parts('generator', { references: 'x' }))).toThrow(
      PromptBuildError,
    );
    expect(() => buildPrompt(templates, parts('generator', { input: '  ' }))).toThrow(
      /Empty input/,
    );
  });
});

describe('fillTemplate', () => {
  const template = (text: string) => ({ id: 'test@v1', text });

  it('fills known variables, with or without inner spaces', () => {
    expect(fillTemplate(template('{{lengthMinSec}}-{{ lengthMaxSec }} s'), variables)).toBe(
      '45-150 s',
    );
  });

  it('fails on an unknown variable', () => {
    expect(() => fillTemplate(template('{{lenghtMinSec}}'), variables)).toThrow(
      'Unknown prompt variable {{lenghtMinSec}} in test@v1',
    );
  });

  it('fails on an unfilled variable', () => {
    const partial: Record<string, unknown> = { ...variables, maxParts: undefined };
    expect(() => fillTemplate(template('up to {{maxParts}}'), partial)).toThrow(
      'Unfilled prompt variable {{maxParts}} in test@v1',
    );
  });

  it('fails on a malformed placeholder', () => {
    expect(() => fillTemplate(template('{{lengthMinSec}'), variables)).toThrow(/Malformed/);
    expect(() => fillTemplate(template('{{ {{x}} }}'), variables)).toThrow(PromptBuildError);
  });
});
