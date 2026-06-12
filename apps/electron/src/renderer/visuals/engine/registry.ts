import type { StyleFactory } from './types';
import { TunnelStyle, TUNNEL_MANIFEST } from '../styles/tunnel';
import { SpectraStyle, SPECTRA_MANIFEST } from '../styles/spectra';
import { SwarmStyle, SWARM_MANIFEST } from '../styles/swarm';
import { TrailsStyle, TRAILS_MANIFEST } from '../styles/trails';
import { SmokeStyle, SMOKE_MANIFEST } from '../styles/smoke';
import { ShapesStyle, SHAPES_MANIFEST } from '../styles/shapes';
import { VideoStyle, VIDEO_MANIFEST } from '../styles/video';
import {
  PosterizeFilter,
  POSTERIZE_MANIFEST,
  HalftoneFilter,
  HALFTONE_MANIFEST,
  DuotoneFilter,
  DUOTONE_MANIFEST,
  ChromaFilter,
  CHROMA_MANIFEST,
  PixelateFilter,
  PIXELATE_MANIFEST,
} from '../filters';

export const FACTORIES: Record<string, StyleFactory> = {
  tunnel: { manifest: TUNNEL_MANIFEST, create: () => new TunnelStyle() },
  spectra: { manifest: SPECTRA_MANIFEST, create: () => new SpectraStyle() },
  swarm: { manifest: SWARM_MANIFEST, create: () => new SwarmStyle() },
  trails: { manifest: TRAILS_MANIFEST, create: () => new TrailsStyle() },
  smoke: { manifest: SMOKE_MANIFEST, create: () => new SmokeStyle() },
  shapes: { manifest: SHAPES_MANIFEST, create: () => new ShapesStyle() },
  video: { manifest: VIDEO_MANIFEST, create: () => new VideoStyle() },
  posterize: { manifest: POSTERIZE_MANIFEST, create: () => new PosterizeFilter() },
  halftone: { manifest: HALFTONE_MANIFEST, create: () => new HalftoneFilter() },
  duotone: { manifest: DUOTONE_MANIFEST, create: () => new DuotoneFilter() },
  chroma: { manifest: CHROMA_MANIFEST, create: () => new ChromaFilter() },
  pixelate: { manifest: PIXELATE_MANIFEST, create: () => new PixelateFilter() },
};

export const STYLE_MANIFESTS = Object.values(FACTORIES)
  .map((f) => f.manifest)
  .filter((m) => m.kind === 'layer');
export const FILTER_MANIFESTS = Object.values(FACTORIES)
  .map((f) => f.manifest)
  .filter((m) => m.kind === 'filter');
