import { randomUUID } from 'node:crypto';
import {
  Scene,
  Route,
  defaultScene,
  type ClientMessage,
  type StyleManifest,
} from '@ed/shared';

export type SceneListener = (scene: Scene, rev: number) => void;

/** Single source of truth for the live scene. Mutations come in as dashboard intents. */
export class SceneStore {
  private scene: Scene = defaultScene();
  private rev = 0;
  private listeners = new Set<SceneListener>();
  private manifests = new Map<string, StyleManifest>();

  get current(): Scene {
    return this.scene;
  }
  get revision(): number {
    return this.rev;
  }

  setManifests(all: StyleManifest[]): void {
    this.manifests.clear();
    for (const m of all) this.manifests.set(m.id, m);
  }

  onChange(fn: SceneListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  replace(scene: Scene): void {
    this.scene = Scene.parse(scene);
    this.commit();
  }

  /** Returns true if the message mutated the scene. */
  apply(msg: ClientMessage): boolean {
    const s = this.scene;
    switch (msg.type) {
      case 'layer/add': {
        const manifest = this.manifests.get(msg.styleId);
        const params: Record<string, number> = {};
        if (manifest) for (const p of manifest.params) params[p.key] = p.default;
        const layer = {
          id: `layer-${randomUUID().slice(0, 8)}`,
          styleId: msg.styleId,
          enabled: true,
          opacity: 1,
          blendMode: manifest?.preferredBlend ?? ('normal' as const),
          params,
        };
        if (msg.atBottom) s.layers.unshift(layer);
        else s.layers.push(layer);
        break;
      }
      case 'layer/remove': {
        s.layers = s.layers.filter((l) => l.id !== msg.layerId);
        s.routing = s.routing.filter((r) => r.target.layerId !== msg.layerId);
        break;
      }
      case 'layer/move': {
        const i = s.layers.findIndex((l) => l.id === msg.layerId);
        if (i < 0) return false;
        const j = msg.dir === 'up' ? i + 1 : i - 1; // up = toward top of stack (end of array)
        if (j < 0 || j >= s.layers.length) return false;
        [s.layers[i], s.layers[j]] = [s.layers[j], s.layers[i]];
        break;
      }
      case 'layer/update': {
        const l = s.layers.find((x) => x.id === msg.layerId);
        if (!l) return false;
        Object.assign(l, msg.patch);
        break;
      }
      case 'layer/param': {
        if (msg.ephemeral) return false; // fast path handled outside the store
        const l = s.layers.find((x) => x.id === msg.layerId);
        if (!l) return false;
        l.params[msg.paramId] = msg.value;
        break;
      }
      case 'filter/add': {
        const manifest = this.manifests.get(msg.filterId);
        const params: Record<string, number> = {};
        if (manifest) for (const p of manifest.params) params[p.key] = p.default;
        s.filters.push({
          id: `fx-${randomUUID().slice(0, 8)}`,
          filterId: msg.filterId,
          enabled: true,
          params,
        });
        break;
      }
      case 'filter/remove': {
        s.filters = s.filters.filter((f) => f.id !== msg.instanceId);
        s.routing = s.routing.filter((r) => r.target.layerId !== msg.instanceId);
        break;
      }
      case 'filter/move': {
        const i = s.filters.findIndex((f) => f.id === msg.instanceId);
        if (i < 0) return false;
        const j = msg.dir === 'up' ? i + 1 : i - 1;
        if (j < 0 || j >= s.filters.length) return false;
        [s.filters[i], s.filters[j]] = [s.filters[j], s.filters[i]];
        break;
      }
      case 'filter/update': {
        const f = s.filters.find((x) => x.id === msg.instanceId);
        if (!f) return false;
        Object.assign(f, msg.patch);
        break;
      }
      case 'filter/param': {
        if (msg.ephemeral) return false;
        const f = s.filters.find((x) => x.id === msg.instanceId);
        if (!f) return false;
        f.params[msg.paramId] = msg.value;
        break;
      }
      case 'route/add': {
        const route = Route.parse({ ...msg.route, id: msg.route.id || `r-${randomUUID().slice(0, 8)}` });
        s.routing.push(route);
        break;
      }
      case 'route/remove': {
        s.routing = s.routing.filter((r) => r.id !== msg.routeId);
        break;
      }
      case 'route/update': {
        const r = s.routing.find((x) => x.id === msg.routeId);
        if (!r) return false;
        const { transform, ...rest } = msg.patch;
        Object.assign(r, rest);
        if (transform) Object.assign(r.transform, transform);
        break;
      }
      case 'master/update': {
        Object.assign(s.master, msg.patch);
        break;
      }
      case 'audio/setSource': {
        s.audio.source = msg.source;
        s.audio.deviceId = msg.deviceId;
        break;
      }
      case 'audio/stemMode': {
        s.audio.stemMode = msg.enabled;
        break;
      }
      default:
        return false;
    }
    this.commit();
    return true;
  }

  private commit(): void {
    this.rev++;
    for (const fn of this.listeners) fn(this.scene, this.rev);
  }
}
