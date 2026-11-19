import type { AssetFamily, EventAction } from '@explainer-studio/shared';
import type { z } from 'zod';
import type { OutlineShape } from '../draw/outline.ts';
import type { Rect, Theme } from '../theme/index.ts';

/**
 * Primitive definitions are React-free: the worker and server import them (through
 * `@explainer-studio/renderer/catalog`) for validation and prompts. Components live beside them
 * and are wired up in `components.ts`.
 */

export const PRIMITIVE_FAMILIES = [
  'annotation',
  'data',
  'spatial',
  'flow',
  'metric',
  'object',
  'ml',
] as const;
export type PrimitiveFamily = (typeof PRIMITIVE_FAMILIES)[number];

/** LLM-facing text. Plain sentences; the catalogue renders them into prompts and docs. */
export type LlmDescription = {
  /** One paragraph: what it looks like and what it shows. */
  summary: string;
  whenToUse: string;
  whenNotToUse: string;
};

/**
 * Intrinsic size in canvas px for the layout engine. Text cannot shrink below `min`; the layout
 * engine may grow an element up to the space its mode gives it.
 */
export type SizeHints = {
  minWidth: number;
  minHeight: number;
  preferredWidth: number;
  preferredHeight: number;
};

export type Size = { width: number; height: number };

export type Insets = { top: number; right: number; bottom: number; left: number };

/** An asset id a primitive's props reference, with its path inside `props`. */
/**
 * An asset id in the props. `family` is the family the prop implies (an `item_icon` shows an
 * object), so suggestions for an unknown id rank that family first.
 */
export type AssetRef = { path: (string | number)[]; id: string; family?: AssetFamily };

/**
 * Another element a primitive's props point to (`connector.from`), with its path inside `props`.
 * Validation checks that the id is in the beat's scope and, when `primitives` is given, that it is
 * one of those primitives. The layout engine resolves it to geometry (`layoutRole`, pins).
 */
export type ElementRef = {
  path: (string | number)[];
  id: string;
  primitives?: readonly string[];
  /**
   * The element is drawn inside this one (an `inset_panel`'s children): the scene layer nests it,
   * its presence is multiplied by the container's, and validation allows it in one container only.
   */
  contains?: boolean;
  /** Parts of the referenced element this ref is limited to (a `bracket` over some slots). */
  parts?: readonly string[];
  /**
   * This element is pinned to the referenced one: the layout keeps it on that side of it (or on a
   * connector's midpoint) wherever the referenced element goes.
   */
  pin?: PinSide;
  /**
   * This element follows the referenced one in time: with the `draw` enter style it enters only
   * once the referenced element has drawn (a packet stream on its connector). Pins and contained
   * children follow their host without it.
   */
  follows?: boolean;
};

/** Sides an element can be pinned to; `middle` is a connector's midpoint. */
export const PIN_SIDES = ['top', 'bottom', 'left', 'right', 'middle'] as const;
export type PinSide = (typeof PIN_SIDES)[number];

/**
 * Where an element is drawn: on the board (default) or as an overlay above the board. Overlays are
 * centred over the stage above a scrim that dims everything else; at most one shows at a time.
 */
export const PRIMITIVE_LAYERS = ['board', 'overlay'] as const;
export type PrimitiveLayer = (typeof PRIMITIVE_LAYERS)[number];

/**
 * How the layout engine treats a primitive beyond its size (omit for an ordinary element the
 * layout mode places):
 * - `background`: others may sit on it (a `map_base`); never counts as an overlap.
 * - `path`: drawn between the two elements its refs name (a `connector`), or along the path of
 *   the one it names (a `packet_stream`); the layout supplies the path.
 * - `frame`: shares the rect of the element its ref names (a `grid_overlay` `over` a map).
 * - `ring`: centred around the element its ref names, large enough to enclose it.
 * - `span`: drawn under the elements its refs name, as wide as all of them (a `bracket`).
 */
export const PRIMITIVE_LAYOUT_ROLES = ['background', 'path', 'frame', 'ring', 'span'] as const;
export type PrimitiveLayoutRole = (typeof PRIMITIVE_LAYOUT_ROLES)[number];

/** An element event as a primitive's own checks see it: the action and the parts it names. */
export type EventSummary = { action: EventAction; parts?: readonly string[] };

/** A warning a primitive reports about its own events; validation adds the path. */
export type PrimitiveWarning = { code: string; message: string };

/**
 * Named parts of an element (slots, cells, zones) that an event can address on its own with
 * `params.parts`. Part events drive `ElementState.parts`; element events still act on the whole.
 */
export type PartsDefinition<P> = {
  /** Actions an event naming parts may use; any other is a spec error. */
  actions: readonly EventAction[];
  /** Part ids in the props, in display order. */
  ids(props: P): string[];
};

export interface PrimitiveDefinition<Id extends string = string, S extends z.ZodType = z.ZodType> {
  id: Id;
  family: PrimitiveFamily;
  /** Validates `props` of a scene element; strict, so unknown props are errors. */
  propsSchema: S;
  /** Event actions this primitive reacts to; any other action targeting it is a spec error. */
  actions: readonly EventAction[];
  /** Method syntax keeps definitions with specific props assignable to the registry's type. */
  sizeHints(props: z.output<S>, theme: Theme): SizeHints;
  /** Asset ids in the props, for `unknown_asset` warnings. Omit when the primitive uses none. */
  assetRefs?(props: z.output<S>): AssetRef[];
  /** Other elements the props point to. Omit when the primitive stands alone. */
  elementRefs?(props: z.output<S>): ElementRef[];
  /** Parts events can address with `params.parts`. Omit when the element acts only as a whole. */
  parts?: PartsDefinition<z.output<S>>;
  /** `overlay` draws it above a scrim over the board (default `board`). */
  layer?: PrimitiveLayer;
  /** How the layout engine places it, when not as an ordinary element (see the role list). */
  layoutRole?: PrimitiveLayoutRole;
  /**
   * Text it draws outside its own body (a label on a ring's rim), in box px. The layout reports
   * `text_covered` when an element is placed over one. Omit when all its text is inside it.
   */
  textRects?(props: z.output<S>, box: Size, theme: Theme): Rect[];
  /**
   * Where contained elements go inside a container (an `inset_panel`): its padding in box px.
   * The layout sizes the container to its children plus this. Omit for non-containers.
   */
  contentInset?(props: z.output<S>, theme: Theme): Insets;
  /**
   * The borders its component draws, as shapes in box px (`src/draw/outline.ts`): with the
   * `draw` enter style they draw on along their stroke before fills and text fade in. Omit when
   * it has no outline to draw (it fades in) or draws itself along a path (`connector`).
   */
  outline?(props: z.output<S>, box: Size, theme: Theme): OutlineShape[];
  /**
   * Warnings about the events that act on one element (across its `continuesPrevious` chain), in
   * order. Omit when the primitive has no such rules.
   */
  eventWarnings?(props: z.output<S>, events: readonly EventSummary[]): PrimitiveWarning[];
  description: LlmDescription;
  /** One example usage; its props must parse (checked when the registry is built). */
  example: { props: z.input<S> };
}

export type AnyPrimitiveDefinition = PrimitiveDefinition<string, z.ZodType>;

/**
 * Keeps the literal id and the props type of a definition, and adds the actions that end held
 * states (`withEndings`: `recover`, `release`).
 */
export function definePrimitive<const Id extends string, S extends z.ZodType>(
  definition: PrimitiveDefinition<Id, S>,
): PrimitiveDefinition<Id, S> {
  const { parts } = definition;
  return {
    ...definition,
    actions: withEndings(definition.actions),
    ...(parts ? { parts: { ...parts, actions: withEndings(parts.actions) } } : {}),
  };
}

/** Held actions and the action that ends each one (`withEndings`). */
export const HELD_ENDINGS = { reject: 'recover', lock: 'release' } as const satisfies Partial<
  Record<EventAction, EventAction>
>;

/**
 * Anything that can be rejected can recover, and anything that can be locked can be released:
 * `recover` and `release` are supported exactly where `reject` and `lock` are (on the element and
 * on its parts), each added right after the action it ends. Definitions never list them.
 */
export function withEndings(actions: readonly EventAction[]): readonly EventAction[] {
  return actions.flatMap((a) => {
    const ending = (HELD_ENDINGS as Partial<Record<EventAction, EventAction>>)[a];
    return ending && !actions.includes(ending) ? [a, ending] : [a];
  });
}
