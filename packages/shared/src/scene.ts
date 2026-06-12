import { z } from 'zod';

export const BlendMode = z.enum(['normal', 'add', 'screen', 'multiply']);
export type BlendMode = z.infer<typeof BlendMode>;

export const CurveKind = z.enum(['linear', 'pow', 'exp', 'smoothstep', 'threshold']);
export type CurveKind = z.infer<typeof CurveKind>;

export const RouteTransform = z.object({
  gain: z.number().default(1),
  bias: z.number().default(0),
  curve: CurveKind.default('linear'),
  curveAmt: z.number().default(2),
  attack: z.number().min(0).default(0.015), // seconds
  release: z.number().min(0).default(0.25), // seconds
  min: z.number().default(0),
  max: z.number().default(1),
});
export type RouteTransform = z.infer<typeof RouteTransform>;

export const Route = z.object({
  id: z.string(),
  source: z.string(), // FeatureId, e.g. 'audio.drums.onset'
  target: z.object({
    layerId: z.string(), // layer or filter instance id, or 'master'
    paramId: z.string(),
  }),
  enabled: z.boolean().default(true),
  transform: RouteTransform,
});
export type Route = z.infer<typeof Route>;

export const Layer = z.object({
  id: z.string(),
  styleId: z.string(),
  enabled: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  blendMode: BlendMode.default('normal'),
  params: z.record(z.string(), z.number()).default({}),
});
export type Layer = z.infer<typeof Layer>;

export const FilterInstance = z.object({
  id: z.string(),
  filterId: z.string(),
  enabled: z.boolean().default(true),
  params: z.record(z.string(), z.number()).default({}),
});
export type FilterInstance = z.infer<typeof FilterInstance>;

export const AudioSource = z.enum(['file', 'system', 'mic']);
export type AudioSource = z.infer<typeof AudioSource>;

export const Scene = z.object({
  id: z.string(),
  name: z.string().default('Untitled'),
  layers: z.array(Layer).default([]), // ordered bottom -> top
  filters: z.array(FilterInstance).default([]), // ordered post-FX chain
  routing: z.array(Route).default([]),
  master: z
    .object({
      brightness: z.number().min(0).max(2).default(1),
      renderScale: z.number().min(0.25).max(1.5).default(1),
    })
    .default({ brightness: 1, renderScale: 1 }),
  audio: z
    .object({
      source: AudioSource.default('file'),
      stemMode: z.boolean().default(true), // use stems when available
      deviceId: z.string().optional(),
    })
    .default({ source: 'file', stemMode: true }),
});
export type Scene = z.infer<typeof Scene>;

export function defaultScene(): Scene {
  return Scene.parse({
    id: 'default',
    name: 'Default',
    layers: [
      {
        id: 'layer-tunnel',
        styleId: 'tunnel',
        enabled: true,
        opacity: 1,
        blendMode: 'normal',
        params: {},
      },
    ],
    filters: [],
    routing: [
      {
        id: 'r-bass-speed',
        source: 'audio.bass.rms',
        target: { layerId: 'layer-tunnel', paramId: 'speed' },
        enabled: true,
        transform: { gain: 2.0, bias: 0.25, curve: 'pow', curveAmt: 1.5, attack: 0.02, release: 0.3, min: 0, max: 3 },
      },
      {
        id: 'r-mid-hue',
        source: 'audio.mix.centroid',
        target: { layerId: 'layer-tunnel', paramId: 'hue' },
        enabled: true,
        transform: { gain: 1, bias: 0, curve: 'linear', curveAmt: 1, attack: 0.3, release: 0.6, min: 0, max: 1 },
      },
      {
        id: 'r-rms-glow',
        source: 'audio.mix.rms',
        target: { layerId: 'layer-tunnel', paramId: 'glow' },
        enabled: true,
        transform: { gain: 1.6, bias: 0.1, curve: 'pow', curveAmt: 2, attack: 0.01, release: 0.2, min: 0, max: 2 },
      },
      {
        id: 'r-drums-kick',
        source: 'audio.drums.onset',
        target: { layerId: 'layer-tunnel', paramId: 'kick' },
        enabled: true,
        transform: { gain: 1, bias: 0, curve: 'linear', curveAmt: 1, attack: 0, release: 0.15, min: 0, max: 1 },
      },
    ],
    master: { brightness: 1, renderScale: 1 },
    audio: { source: 'file', stemMode: true },
  });
}
