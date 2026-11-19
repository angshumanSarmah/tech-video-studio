import { z } from 'zod';
import { lineText } from '../../primitives/common-props.ts';
import { DataFieldSchema } from '../../primitives/data-block/definition.ts';
import { el, link, nodeParam, nodeProps, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'inputs', description: 'The feature rows type in and are grouped.' },
  { name: 'model', description: 'The features flow into the model.' },
  { name: 'predict', description: 'The prediction flips from "?" to its value.' },
  {
    name: 'compare',
    description: 'A second input and its different prediction (only with comparison).',
    optional: true,
  },
] as const;

const featureList = (description: string) =>
  z.array(DataFieldSchema).min(1).max(5).describe(description);

const PredictionSchema = z.strictObject({
  value: z.number().finite().describe('The predicted number.'),
  unit: lineText(16, 'Optional unit after the number, e.g. MIN.').optional(),
  label: lineText(32, 'Optional caption under the number.').optional(),
  decimals: z.number().int().min(0).max(2).default(0).describe('Digits after the decimal point.'),
});
type Prediction = z.output<typeof PredictionSchema>;

export const inferenceCardPattern = definePattern({
  id: 'inference_card',
  family: 'data',
  layoutMode: 'pipeline',
  paramsSchema: z
    .strictObject({
      title: lineText(24, 'Optional title of the input record, e.g. ORDER 4127.').optional(),
      features: featureList('The input features as key/value rows, 1 to 5.'),
      group: lineText(16, 'Label of the bracket around the features.').default('FEATURES'),
      model: nodeParam('The model that reads the features.'),
      prediction: PredictionSchema.describe('What the model predicts for these features.'),
      comparison: z
        .strictObject({
          title: lineText(24, 'Optional title of the second record.').optional(),
          features: featureList('The second input, differing in what matters.'),
          prediction: PredictionSchema.describe('Its different prediction.'),
        })
        .optional()
        .describe('Optional second input with a different result; needs at.compare.'),
      at: anchorsSchema(ANCHORS),
    })
    .refine((p) => (p.comparison === undefined) === (p.at.compare === undefined), {
      message: 'Give at.compare exactly when there is a comparison.',
      path: ['at', 'compare'],
    }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  anchors: ANCHORS,
  targets: [
    { id: 'features', description: 'The feature rows.' },
    { id: 'group', description: 'The bracket around the features.' },
    { id: 'model', description: 'The model.' },
    { id: 'in-link', description: 'Arrow from the features to the model.' },
    { id: 'out-link', description: 'Arrow from the model to the prediction.' },
    { id: 'prediction', description: 'The prediction ("?" until predict).' },
    { id: 'compare-features', description: 'The second input (with comparison).' },
    { id: 'compare-link', description: 'Arrow from the second input to the model.' },
    { id: 'compare-prediction', description: 'The second prediction.' },
  ],
  description: {
    summary:
      'Inputs → model → prediction. Feature rows type in, grouped by a bracket, and flow into a ' +
      'model; the prediction flips from "?" to a value. An optional comparison feeds a second ' +
      'input with a different value in and gets a different prediction.',
    whenToUse:
      'Any ML prediction told as data in, number out: fraud score, delivery ETA, churn risk, price. Use ' +
      'the comparison to show which feature changes the answer.',
    whenNotToUse:
      'A single number without inputs (use `counter_transition`); a decision between candidates ' +
      '(use `pick_by_rule`).',
  },
  example: {
    params: {
      features: [
        { key: 'example_feature', value: '<example-value>' },
        { key: 'example_count', value: 3 },
      ],
      model: { title: '<example-model>', icon: 'cpu' },
      prediction: { value: 14, unit: '<example-unit>' },
      comparison: {
        features: [{ key: 'example_feature', value: '<example-other>' }],
        prediction: { value: 22, unit: '<example-unit>' },
      },
      at: {
        inputs: { type: 'word', index: 0 },
        model: { type: 'word', index: 1 },
        predict: { type: 'word', index: 2 },
        compare: { type: 'word', index: 3 },
      },
    },
  },
  expand: (p) => {
    const compare =
      p.comparison && p.at.compare ? { ...p.comparison, at: p.at.compare } : undefined;
    return {
      elements: [
        el('features', 'data_block', record(p.title, p.features), 'source'),
        el('group', 'bracket', { targets: ['features'], label: p.group, semantic: 'concept' }),
        el('model', 'node_card', nodeProps(p.model, { semantic: 'concept' }), 'stage'),
        link('in-link', 'features', 'model'),
        link('out-link', 'model', 'prediction', { semantic: 'focus' }),
        el('prediction', 'counter_transition', guess(p.prediction, 'focus'), 'sink'),
        ...(compare
          ? [
              el(
                'compare-features',
                'data_block',
                record(compare.title, compare.features),
                'aside',
              ),
              link('compare-link', 'compare-features', 'model', { dashed: true }),
              el(
                'compare-prediction',
                'counter_transition',
                guess(compare.prediction, 'concept'),
                'aside',
              ),
            ]
          : []),
      ],
      events: [
        on(p.at.inputs, 'enter', ['features', 'group']),
        on(p.at.model, 'enter', ['model', 'in-link']),
        on(p.at.model, 'move', ['in-link']),
        on(p.at.model, 'pulse', ['model']),
        on(p.at.predict, 'enter', ['out-link', 'prediction']),
        on(p.at.predict, 'move', ['out-link']),
        on(p.at.predict, 'count', ['prediction']),
        ...(compare
          ? [
              on(compare.at, 'enter', ['compare-features', 'compare-link', 'compare-prediction']),
              on(compare.at, 'move', ['compare-link']),
              on(compare.at, 'count', ['compare-prediction']),
            ]
          : []),
      ],
    };
  },
});

function record(title: string | undefined, fields: unknown[]) {
  return { ...(title ? { title } : {}), fields };
}

/** A prediction starts unknown ("?") and flips to its value on `count`. */
function guess(prediction: Prediction, semantic: 'focus' | 'concept') {
  return {
    from: null,
    to: prediction.value,
    decimals: prediction.decimals,
    toSemantic: semantic,
    ...(prediction.unit ? { unit: prediction.unit } : {}),
    ...(prediction.label ? { label: prediction.label } : {}),
  };
}
