import { useRef, useState } from 'react';
import {
  F,
  FEATURES,
  type FilterInstance,
  type Layer,
  type ParamSpec,
  type Route,
  type StyleManifest,
} from '@ed/shared';
import { useStore } from './store';

/* ---------- shared bits ---------- */

function ParamSlider({
  spec,
  value,
  onEphemeral,
  onCommit,
}: {
  spec: ParamSpec;
  value: number;
  onEphemeral: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const v = local ?? value;
  return (
    <div className="param">
      <span className="name" title={spec.key}>
        {spec.label}
      </span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? (spec.max - spec.min) / 200}
        value={v}
        onChange={(e) => {
          const nv = Number(e.target.value);
          setLocal(nv);
          onEphemeral(nv);
        }}
        onPointerUp={() => {
          if (local !== null) {
            onCommit(local);
            setLocal(null);
          }
        }}
      />
      <span className="val">{v.toFixed(2)}</span>
    </div>
  );
}

const fmtTime = (s: number): string =>
  `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;

/* ---------- transport / audio ---------- */

function AudioPanel() {
  const { transport, send, devices, stemStatus, scene } = useStore();
  const [scrub, setScrub] = useState<number | null>(null);
  const t = transport;
  const playing = t?.state === 'playing';
  const stems = ['drums', 'bass', 'vocals', 'other'];
  return (
    <div className="panel">
      <h2>
        Audio
        <span className="right mono dim">{t?.bpm ? `${t.bpm} bpm` : ''}</span>
      </h2>
      <div className="row">
        <button onClick={() => send({ type: 'transport/loadFile' })}>Load file…</button>
        <button className="primary" onClick={() => send({ type: playing ? 'transport/pause' : 'transport/play' })}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="mono dim">
          {t?.trackName ?? 'no track'} {t && t.duration > 0 ? `· ${fmtTime(scrub ?? t.time)} / ${fmtTime(t.duration)}` : ''}
        </span>
      </div>
      {t && t.duration > 0 && t.source === 'file' && (
        <div className="row">
          <input
            className="scrub"
            type="range"
            min={0}
            max={t.duration}
            step={0.1}
            value={scrub ?? t.time}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={() => {
              if (scrub !== null) {
                send({ type: 'transport/seek', time: scrub });
                setScrub(null);
              }
            }}
          />
        </div>
      )}
      <div className="row">
        <label>Source</label>
        <select
          value={scene?.audio.source ?? 'file'}
          onChange={(e) =>
            send({
              type: 'audio/setSource',
              source: e.target.value as 'file' | 'system' | 'mic',
              deviceId: scene?.audio.deviceId,
            })
          }
        >
          <option value="file">File playback</option>
          <option value="system">System / loopback</option>
          <option value="mic">Mic / line-in</option>
        </select>
        {scene?.audio.source !== 'file' && (
          <select
            value={scene?.audio.deviceId ?? ''}
            onChange={(e) =>
              send({ type: 'audio/setSource', source: scene?.audio.source ?? 'mic', deviceId: e.target.value || undefined })
            }
          >
            <option value="">Default input</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={t?.stemMode ?? true}
            onChange={(e) => send({ type: 'audio/stemMode', enabled: e.target.checked })}
          />{' '}
          Stem mode {t?.stemsAvailable ? '' : '(no stems yet)'}
        </label>
        <button
          disabled={stemStatus.state === 'running'}
          onClick={() => send({ type: 'stems/separate', quality: 'fast' })}
        >
          Separate stems
        </button>
        {stemStatus.state === 'running' && (
          <>
            <div className="progress">
              <div className="fill" style={{ width: `${Math.round(stemStatus.progress * 100)}%` }} />
            </div>
            <span className="mono dim">{Math.round(stemStatus.progress * 100)}%</span>
          </>
        )}
      </div>
      {stemStatus.state === 'error' && <div className="dim">⚠ {stemStatus.message}</div>}
      {t?.stemsAvailable && t.stemMode && (
        <div>
          {stems.map((s) => (
            <StemGain key={s} stem={s} />
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <label>Video</label>
        <button onClick={() => send({ type: 'video/load' })}>Load video…</button>
        <button className="small" onClick={() => send({ type: 'video/clear' })}>
          Clear
        </button>
        <span className="dim">add a “Video” layer to show it</span>
      </div>
    </div>
  );
}

function StemGain({ stem }: { stem: string }) {
  const send = useStore((s) => s.send);
  const [v, setV] = useState(1);
  return (
    <div className="param">
      <span className="name">{stem}</span>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.01}
        value={v}
        onChange={(e) => {
          const nv = Number(e.target.value);
          setV(nv);
          send({ type: 'audio/stemGain', stem, gain: nv });
        }}
      />
      <span className="val">{v.toFixed(2)}</span>
    </div>
  );
}

/* ---------- meters ---------- */

const METER_DEFS: { label: string; idx: number }[] = [
  { label: 'mix', idx: F.MixRms },
  { label: 'drums', idx: F.DrumsRms },
  { label: 'bass', idx: F.BassRms },
  { label: 'vocals', idx: F.VocalsRms },
  { label: 'other', idx: F.OtherRms },
  { label: 'onset', idx: F.MixOnset },
];

function MetersPanel() {
  const { meters, fps, frameMs } = useStore();
  const beat = (meters[F.Beat] ?? 0) > 0.5;
  return (
    <div className="panel">
      <h2>
        Signal
        <span className="right row" style={{ marginBottom: 0 }}>
          <span className={`beat ${beat ? 'on' : ''}`} />
          <span className="mono dim">
            {fps} fps · {frameMs} ms
          </span>
        </span>
      </h2>
      {METER_DEFS.map((m) => (
        <div className="meter" key={m.label}>
          <span>{m.label}</span>
          <div className="bar">
            <div className="fill" style={{ width: `${Math.min(100, (meters[m.idx] ?? 0) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- layers & filters ---------- */

function InstanceCard({
  id,
  manifest,
  params,
  enabled,
  isLayer,
  opacity,
  blendMode,
}: {
  id: string;
  manifest: StyleManifest;
  params: Record<string, number>;
  enabled: boolean;
  isLayer: boolean;
  opacity?: number;
  blendMode?: string;
}) {
  const send = useStore((s) => s.send);
  const upd = (patch: Record<string, unknown>) =>
    isLayer
      ? send({ type: 'layer/update', layerId: id, patch } as never)
      : send({ type: 'filter/update', instanceId: id, patch } as never);
  const move = (dir: 'up' | 'down') =>
    isLayer ? send({ type: 'layer/move', layerId: id, dir }) : send({ type: 'filter/move', instanceId: id, dir });
  const remove = () =>
    isLayer ? send({ type: 'layer/remove', layerId: id }) : send({ type: 'filter/remove', instanceId: id });
  const param = (paramId: string, value: number, ephemeral: boolean) =>
    isLayer
      ? send({ type: 'layer/param', layerId: id, paramId, value, ephemeral })
      : send({ type: 'filter/param', instanceId: id, paramId, value, ephemeral });

  return (
    <div className={`card ${enabled ? '' : 'disabled'}`}>
      <div className="head">
        <input type="checkbox" checked={enabled} onChange={(e) => upd({ enabled: e.target.checked })} />
        <span className="name">{manifest.name}</span>
        {isLayer && (
          <select value={blendMode} onChange={(e) => upd({ blendMode: e.target.value })}>
            {['normal', 'add', 'screen', 'multiply'].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        )}
        <span className="right">
          <button className="small" title="move up the stack" onClick={() => move('up')}>
            ▲
          </button>
          <button className="small" onClick={() => move('down')}>
            ▼
          </button>
          <button className="small danger" onClick={remove}>
            ✕
          </button>
        </span>
      </div>
      {isLayer && (
        <ParamSlider
          spec={{ key: 'opacity', label: 'Opacity', min: 0, max: 1, default: 1 }}
          value={opacity ?? 1}
          onEphemeral={() => {}}
          onCommit={(v) => upd({ opacity: v })}
        />
      )}
      {manifest.params.map((spec) => (
        <ParamSlider
          key={spec.key}
          spec={spec}
          value={params[spec.key] ?? spec.default}
          onEphemeral={(v) => param(spec.key, v, true)}
          onCommit={(v) => param(spec.key, v, false)}
        />
      ))}
    </div>
  );
}

function LayersPanel() {
  const { scene, styles, send } = useStore();
  const [styleId, setStyleId] = useState('tunnel');
  if (!scene) return null;
  const byId = new Map(styles.map((m) => [m.id, m]));
  const layers = [...scene.layers].reverse(); // display top of stack first
  return (
    <div className="panel">
      <h2>
        Layers <span className="dim">(top first)</span>
        <span className="right row" style={{ marginBottom: 0 }}>
          <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
            {styles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button className="primary small" onClick={() => send({ type: 'layer/add', styleId })}>
            + Add
          </button>
        </span>
      </h2>
      {layers.map((l: Layer) => {
        const m = byId.get(l.styleId);
        return m ? (
          <InstanceCard
            key={l.id}
            id={l.id}
            manifest={m}
            params={l.params}
            enabled={l.enabled}
            isLayer
            opacity={l.opacity}
            blendMode={l.blendMode}
          />
        ) : null;
      })}
      {layers.length === 0 && <div className="dim">No layers — add one above.</div>}
    </div>
  );
}

function FiltersPanel() {
  const { scene, filters, send } = useStore();
  const [filterId, setFilterId] = useState('posterize');
  if (!scene) return null;
  const byId = new Map(filters.map((m) => [m.id, m]));
  return (
    <div className="panel">
      <h2>
        Post FX
        <span className="right row" style={{ marginBottom: 0 }}>
          <select value={filterId} onChange={(e) => setFilterId(e.target.value)}>
            {filters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button className="primary small" onClick={() => send({ type: 'filter/add', filterId })}>
            + Add
          </button>
        </span>
      </h2>
      {scene.filters.map((f: FilterInstance) => {
        const m = byId.get(f.filterId);
        return m ? (
          <InstanceCard key={f.id} id={f.id} manifest={m} params={f.params} enabled={f.enabled} isLayer={false} />
        ) : null;
      })}
      {scene.filters.length === 0 && <div className="dim">No filters.</div>}
    </div>
  );
}

/* ---------- routing ---------- */

function RouteCard({ route, targets }: { route: Route; targets: { id: string; label: string; params: ParamSpec[] }[] }) {
  const send = useStore((s) => s.send);
  const upd = (patch: Partial<Route>) => send({ type: 'route/update', routeId: route.id, patch });
  const updT = (patch: Partial<Route['transform']>) =>
    send({ type: 'route/update', routeId: route.id, patch: { transform: { ...route.transform, ...patch } } });
  const target = targets.find((t) => t.id === route.target.layerId);
  const groups = [...new Set(FEATURES.map((f) => f.group))];
  return (
    <div className="route" style={{ opacity: route.enabled ? 1 : 0.5 }}>
      <div className="line1">
        <input type="checkbox" checked={route.enabled} onChange={(e) => upd({ enabled: e.target.checked })} />
        <select value={route.source} onChange={(e) => upd({ source: e.target.value })}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {FEATURES.filter((f) => f.group === g).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="dim">→</span>
        <select
          value={route.target.layerId}
          onChange={(e) => {
            const t = targets.find((x) => x.id === e.target.value);
            upd({ target: { layerId: e.target.value, paramId: t?.params[0]?.key ?? '' } });
          }}
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={route.target.paramId}
          onChange={(e) => upd({ target: { ...route.target, paramId: e.target.value } })}
        >
          {(target?.params ?? []).map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="small danger" style={{ marginLeft: 'auto' }} onClick={() => send({ type: 'route/remove', routeId: route.id })}>
          ✕
        </button>
      </div>
      <div className="knobs">
        {(
          [
            ['gain', 0, 4, 0.01],
            ['bias', -1, 1, 0.01],
            ['attack', 0, 1, 0.005],
            ['release', 0, 2, 0.005],
          ] as const
        ).map(([k, mn, mx, st]) => (
          <label className="knob" key={k}>
            {k}: {route.transform[k].toFixed(2)}
            <input
              type="range"
              min={mn}
              max={mx}
              step={st}
              value={route.transform[k]}
              onChange={(e) => updT({ [k]: Number(e.target.value) } as never)}
            />
          </label>
        ))}
      </div>
      <div className="line1">
        <label className="knob">
          curve{' '}
          <select value={route.transform.curve} onChange={(e) => updT({ curve: e.target.value as Route['transform']['curve'] })}>
            {['linear', 'pow', 'exp', 'smoothstep', 'threshold'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="knob">
          range {route.transform.min.toFixed(1)}–{route.transform.max.toFixed(1)}
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={route.transform.max}
            onChange={(e) => updT({ max: Number(e.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}

function RoutingPanel() {
  const { scene, styles, filters, send } = useStore();
  if (!scene) return null;
  const manifests = new Map([...styles, ...filters].map((m) => [m.id, m]));
  const targets = [
    ...scene.layers.map((l) => ({
      id: l.id,
      label: manifests.get(l.styleId)?.name ?? l.styleId,
      params: manifests.get(l.styleId)?.params ?? [],
    })),
    ...scene.filters.map((f) => ({
      id: f.id,
      label: `FX: ${manifests.get(f.filterId)?.name ?? f.filterId}`,
      params: manifests.get(f.filterId)?.params ?? [],
    })),
  ];
  const addRoute = () => {
    const t = targets[0];
    if (!t) return;
    send({
      type: 'route/add',
      route: {
        id: '',
        source: 'audio.drums.onset',
        target: { layerId: t.id, paramId: t.params[0]?.key ?? '' },
        enabled: true,
        transform: { gain: 1, bias: 0, curve: 'linear', curveAmt: 2, attack: 0.015, release: 0.25, min: 0, max: 1 },
      },
    });
  };
  return (
    <div className="panel">
      <h2>
        Routing
        <button className="primary small right" onClick={addRoute}>
          + Route
        </button>
      </h2>
      {scene.routing.map((r) => (
        <RouteCard key={r.id} route={r} targets={targets} />
      ))}
      {scene.routing.length === 0 && <div className="dim">No routes — audio won’t modulate anything.</div>}
    </div>
  );
}

/* ---------- presets & master ---------- */

function PresetsPanel() {
  const { presets, send } = useStore();
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <div className="panel">
      <h2>Presets</h2>
      <div className="row">
        <input type="text" placeholder="preset name" ref={nameRef} />
        <button
          className="primary small"
          onClick={() => {
            const name = nameRef.current?.value.trim();
            if (name) {
              send({ type: 'preset/save', name });
              nameRef.current!.value = '';
            }
          }}
        >
          Save
        </button>
      </div>
      {presets.map((p) => (
        <div className="row" key={p.id}>
          <button className="small" onClick={() => send({ type: 'preset/load', id: p.id })}>
            {p.name}
          </button>
          <button className="small danger" onClick={() => send({ type: 'preset/delete', id: p.id })}>
            ✕
          </button>
        </div>
      ))}
      {presets.length === 0 && <div className="dim">No presets saved.</div>}
    </div>
  );
}

function MasterPanel() {
  const { scene, send } = useStore();
  const [blackout, setBlackout] = useState(false);
  if (!scene) return null;
  return (
    <div className="panel">
      <h2>Master</h2>
      <ParamSlider
        spec={{ key: 'brightness', label: 'Brightness', min: 0, max: 2, default: 1 }}
        value={scene.master.brightness}
        onEphemeral={() => {}}
        onCommit={(v) => send({ type: 'master/update', patch: { brightness: v } })}
      />
      <ParamSlider
        spec={{ key: 'renderScale', label: 'Render scale', min: 0.25, max: 1.5, default: 1 }}
        value={scene.master.renderScale}
        onEphemeral={() => {}}
        onCommit={(v) => send({ type: 'master/update', patch: { renderScale: v } })}
      />
      <div className="row">
        <button onClick={() => send({ type: 'visuals/fullscreen' })}>Toggle fullscreen</button>
        <button
          onClick={() => {
            send({ type: 'visuals/blackout', on: !blackout });
            setBlackout(!blackout);
          }}
        >
          {blackout ? 'Lights up' : 'Blackout'}
        </button>
      </div>
    </div>
  );
}

/* ---------- app ---------- */

export function App() {
  const { connected, toasts } = useStore();
  return (
    <>
      <div className="topbar">
        <span className={`conn ${connected ? 'ok' : ''}`} title={connected ? 'connected' : 'reconnecting…'} />
        <h1>Electric Dreams</h1>
        <span className="spacer" />
        <span className="stat dim">visuals window: F fullscreen · D stats · B blackout</span>
      </div>
      <div className="grid">
        <div className="col">
          <AudioPanel />
          <MetersPanel />
          <MasterPanel />
          <PresetsPanel />
        </div>
        <div className="col">
          <LayersPanel />
          <FiltersPanel />
        </div>
        <div className="col">
          <RoutingPanel />
        </div>
      </div>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}
