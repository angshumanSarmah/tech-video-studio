import { z } from 'zod';
import type { BuiltPrompt } from '#worker/llm/types.ts';
import { ROLE_OUTPUT_SCHEMAS } from './output-schemas.ts';
import { PROMPT_VARIABLE_NAMES, type PromptVariables } from './prompt-variables.ts';
import type { PromptRole, PromptTemplate, PromptTemplates } from './prompts/templates.ts';

export class PromptBuildError extends Error {
  override readonly name = 'PromptBuildError';
}

/**
 * What one call's prompt is built from. Sections arrive formatted (with their own headings) from
 * the step that owns them; the builder only fills variables and fixes the order.
 */
export interface PromptParts {
  readonly role: PromptRole;
  readonly variables: PromptVariables;
  /** 3. Closed lists and the catalogue block (P1C.4). */
  readonly catalogue?: string;
  /** 4. The person's accepted style rules (P1C.10). */
  readonly styleRules?: string;
  /**
   * 5. This run's input: topic, notes, plan, script or beat (the Director's also carries its
   * memory and reference videos, P1C.11).
   */
  readonly input: string;
}

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const KNOWN = new Set<string>(PROMPT_VARIABLE_NAMES);

/** Fills `{{name}}`; an unknown, unfilled or malformed placeholder throws. */
export function fillTemplate(
  template: PromptTemplate,
  variables: Readonly<Record<string, unknown>>,
): string {
  const filled = template.text.replace(PLACEHOLDER, (_match, rawName: string) => {
    const name = rawName.trim();
    if (!KNOWN.has(name)) {
      throw new PromptBuildError(`Unknown prompt variable {{${name}}} in ${template.id}`);
    }
    const value = variables[name];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new PromptBuildError(`Unfilled prompt variable {{${name}}} in ${template.id}`);
    }
    return String(value);
  });
  if (filled.includes('{{') || filled.includes('}}')) {
    throw new PromptBuildError(`Malformed placeholder left in ${template.id}`);
  }
  return filled;
}

/** The output shape as JSON Schema (input side: fields with defaults are optional). */
export function outputSchemaSection(schema: z.ZodType): string {
  const json = JSON.stringify(z.toJSONSchema(schema, { io: 'input' }), null, 2);
  return `## OUTPUT SHAPE (JSON Schema: return one JSON object that matches it)\n${json}`;
}

/** The role's registered output schema (`ROLE_OUTPUT_SCHEMAS`), if it has one. */
function outputSection(role: PromptRole): string[] {
  const schema = ROLE_OUTPUT_SCHEMAS[role];
  return schema ? [outputSchemaSection(schema)] : [];
}

function section(text: string | undefined): string[] {
  const trimmed = text?.trim();
  return trimmed ? [trimmed] : [];
}

/**
 * Assembles a prompt in the design doc's order, static content first so the provider's prefix
 * cache hits: preamble, role prompt, output JSON Schema, catalogue, style rules (one
 * system message), then the run's input (the user message).
 */
export function buildPrompt(templates: PromptTemplates, parts: PromptParts): BuiltPrompt {
  const preamble = templates.preamble;
  const rolePrompt = templates[parts.role];
  const system = [
    fillTemplate(preamble, parts.variables).trim(),
    fillTemplate(rolePrompt, parts.variables).trim(),
    ...outputSection(parts.role),
    ...section(parts.catalogue),
    ...section(parts.styleRules),
  ].join('\n\n');
  const input = parts.input.trim();
  if (!input) throw new PromptBuildError(`Empty input for ${parts.role}`);
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: input },
    ],
    versions: { preamble: preamble.id, role: rolePrompt.id },
  };
}
