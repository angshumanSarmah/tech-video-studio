import { NO_FOCUS } from '../events/focus.ts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { elementState, type ElementEvent } from '../primitives/element-state.ts';
import { nestContained } from './beat-world.ts';
import { containedState, overlayLevel, splitLayers, type PrimitiveItem } from './scene-layers.ts';

const FPS = 30;
const at = (action: ElementEvent['action'], frame: number): ElementEvent => ({
  action,
  frame,
  sec: frame / FPS,
  beatEndSec: 100,
});

function item(id: string, primitive: string, props: unknown, events: ElementEvent[] = []) {
  const definition = DEFAULT_REGISTRIES.primitives.get(primitive);
  if (!definition) throw new Error(primitive);
  const parsed: unknown = definition.propsSchema.parse(props);
  const world: PrimitiveItem = {
    kind: 'primitive',
    key: id,
    definition,
    props: parsed,
    events,
    focus: NO_FOCUS,
    layer: definition.layer ?? 'board',
    children: [],
  };
  return world;
}

const board = item('api', 'node_card', { title: 'API' });
const note = item('note', 'tag', { text: '429' }, [at('enter', 0)]);
const zoom = item('zoom', 'inset_panel', { children: ['note'] }, [at('enter', 30), at('exit', 90)]);
const question = item('question', 'statement_card', { lines: [{ id: 'q', text: 'Why?' }] });

describe('containedState', () => {
  it('multiplies the child presence by its container, so children enter and exit with it', () => {
    const child = elementState(note.events, 60, FPS);
    expect(child.presence).toBe(1);
    const container = (frame: number) => elementState(zoom.events, frame, FPS).presence;
    expect(containedState(child, container(0)).presence).toBe(0);
    expect(containedState(child, container(35)).presence).toBeCloseTo(container(35));
    expect(containedState(child, container(60)).presence).toBe(1);
    expect(containedState(child, container(200)).presence).toBe(0);
  });

  it('keeps the child hidden while its own enter is still ahead, even inside a shown container', () => {
    const late = elementState([at('enter', 120)], 60, FPS);
    expect(containedState(late, 1).presence).toBe(0);
  });
});

describe('splitLayers', () => {
  it('puts overlays above the board and their children inside them, never on the board', () => {
    const layers = splitLayers(nestContained([board, note, zoom, question]));
    expect(layers.board.map((i) => i.key)).toEqual(['api']);
    expect(layers.overlays.map((i) => i.key)).toEqual(['zoom', 'question']);
    const inset = layers.overlays[0] as PrimitiveItem;
    expect(inset.children.map((c) => c.key)).toEqual(['note']);
  });

  it('never nests an overlay inside a container', () => {
    const holdsOverlay = item('box', 'inset_panel', { children: ['question'] });
    const layers = splitLayers(nestContained([holdsOverlay, question]));
    expect(layers.overlays.map((i) => i.key)).toEqual(['box', 'question']);
    expect((layers.overlays[0] as PrimitiveItem).children).toEqual([]);
  });
});

describe('overlayLevel', () => {
  it('follows the most present overlay, and is clear without one', () => {
    expect(overlayLevel([])).toBe(0);
    expect(overlayLevel([0.2, 0.8])).toBe(0.8);
  });
});
