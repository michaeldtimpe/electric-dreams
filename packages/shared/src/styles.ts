/** Style/filter manifests — shared so the dashboard can auto-generate controls. */

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  /** FeatureIds that make musical sense for this param (pre-populates routing UI). */
  suggestedFeatures?: string[];
}

export interface StyleManifest {
  id: string;
  name: string;
  kind: 'layer' | 'filter';
  description?: string;
  params: ParamSpec[];
  preferredBlend?: 'normal' | 'add' | 'screen' | 'multiply';
  /** Relative GPU cost, for the degradation governor. */
  costHint?: 1 | 2 | 3;
}
