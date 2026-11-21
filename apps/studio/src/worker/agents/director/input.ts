import type { DirectorInput, ResearchNotes } from '@explainer-studio/shared';
import { notesWithoutChunks } from '../sections.ts';

/**
 * The Director's run input (the user message) and its style-rules section. Static parts (role
 * prompt, output schema, catalogue) live in the system message; everything here varies by run.
 */

const INTRO =
  'Plan the video for this topic. The research notes below are the only facts you may use; ' +
  'cite their ids ("fact-<n>", "num-<n>") per beat. The recently used combinations are to ' +
  'avoid, and the past topics are not to repeat.';

export function directorUserMessage(input: DirectorInput, notes: ResearchNotes): string {
  const { recent } = input.memory;
  const payload = {
    topic: input.topic.title,
    angle: input.topic.notes,
    series: { name: input.series.name, label: input.series.label, number: input.series.nextNumber },
    title: titleInstruction(input),
    length: lengthInstruction(input),
    parts: partsInstruction(input),
    format: formatInstruction(input),
    recentlyUsed: {
      videos: recent.videos,
      devices: recent.devices,
      layoutModes: recent.layouts,
      patterns: recent.patterns,
      deviceLayoutCombos: recent.combos,
    },
    pastTopics: input.memory.pastTopics,
    researchNotes: notesWithoutChunks(notes),
  };
  return `${INTRO}\n\n${JSON.stringify(payload, null, 2)}`;
}

function titleInstruction({ titleMaxChars }: DirectorInput): string {
  return titleMaxChars === undefined
    ? 'Short and concrete.'
    : `At most about ${titleMaxChars} characters (what the HUD shows after the series label), or it is cut off.`;
}

function lengthInstruction({ length, parts }: DirectorInput): string {
  const per = parts.allowed ? ' (per part, if you split the topic)' : '';
  if (length.overrideSec !== undefined) {
    return `Fixed by this run: exactly ${length.overrideSec} s${per}.`;
  }
  return (
    `Decide within ${length.minSec}-${length.maxSec} s by topic depth${per}; over ` +
    `${length.reasonAboveSec} s needs a one-line lengthReason.`
  );
}

function partsInstruction({ parts, length }: DirectorInput): string {
  if (!parts.allowed) return 'Not allowed: plan one video.';
  return (
    `Allowed: split into 2-${parts.max} parts only if the topic needs more than about ` +
    `${length.maxSec} s; otherwise plan one video and omit "parts".`
  );
}

function formatInstruction({ formatOverride }: DirectorInput): string {
  return formatOverride
    ? `Fixed by this run: "${formatOverride}". Set meta.format to it.`
    : 'Recommend one in meta.format.';
}
