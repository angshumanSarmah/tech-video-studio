import { z } from 'zod';
import type { SpecError } from '../spec/validate.ts';

/**
 * What the Curator reports (P1C.8). Every issue names the agent that owns the text or board to
 * change and how serious it is: `blocking` issues stop gate 3's auto-approve and are sent for
 * repair (Scriptwriter and Generator only); `advisory` ones are shown at the gate.
 */

/** Agents an issue can be sent to. Director and Researcher issues are never auto-repaired. */
export const CURATOR_OWNERS = ['scriptwriter', 'generator', 'director', 'researcher'] as const;
export const CuratorOwnerSchema = z.enum(CURATOR_OWNERS);
export type CuratorOwner = z.infer<typeof CuratorOwnerSchema>;

export const ISSUE_SEVERITIES = ['blocking', 'advisory'] as const;
export const IssueSeveritySchema = z.enum(ISSUE_SEVERITIES);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

/** Owners the Curator's repair loop sends issues to; the rest go to the gate. */
export const REPAIRABLE_OWNERS: readonly CuratorOwner[] = ['scriptwriter', 'generator'];

/** A deterministic finding on a finished spec, with who fixes it and how serious it is. */
export type CodeIssue = SpecError & { severity: IssueSeverity; owner: CuratorOwner };
