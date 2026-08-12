import { useStore } from '../store/useStore'
import type { DisplayConfig } from '../store/types'

/** Per-display configuration panel (Feature 3/4). Config is stored per display. */
export default function DisplaySettings({ displayId }: { displayId?: string }) {
  const displays = useStore((s) => s.displays)
  const update = useStore((s) => s.updateDisplay)
  const setBlackout = useStore((s) => s.setBlackout)
  const d = displays.find((x) => x.id === displayId) ?? displays[0]
  if (!d) return null

  function set(patch: Partial<DisplayConfig>) {
    update(d.id, patch)
  }

  return (
    <div className="thin-scroll flex flex-col gap-4 overflow-auto bg-panel p-4 text-sm">
      <label className="flex items-center justify-between gap-2">
        <span className="text-neutral-300">Show notes on this display</span>
        <input
          type="checkbox"
          checked={d.showNotes}
          onChange={(e) => set({ showNotes: e.target.checked })}
          className="h-4 w-4 accent-accent"
          title="Director notes — leave OFF for any talent-facing display"
        />
      </label>

      <Toggle label="Mirror (beam-splitter)" checked={d.mirrorH} onChange={(v) => set({ mirrorH: v })} />
      <Toggle label="Flip vertical" checked={d.flipV} onChange={(v) => set({ flipV: v })} />
      <Toggle label="Rotate 180°" checked={d.rotate180} onChange={(v) => set({ rotate180: v })} />

      <Range label="Font size" min={24} max={140} step={2} value={d.fontSizePx} suffix="px"
        onChange={(v) => set({ fontSizePx: v })} />
      <Range label="Line height" min={1} max={2.4} step={0.05} value={d.lineHeight}
        onChange={(v) => set({ lineHeight: v })} />
      <Range label="Eyeline position" min={0.15} max={0.7} step={0.01} value={d.eyelineFrac}
        onChange={(v) => set({ eyelineFrac: v })} />
      <Range label="Side margins" min={0} max={0.3} step={0.01} value={d.marginXFrac}
        onChange={(v) => set({ marginXFrac: v })} />

      <label className="flex flex-col gap-1">
        <span className="text-neutral-400">Eyeline style</span>
        <select
          value={d.eyelineStyle}
          onChange={(e) => set({ eyelineStyle: e.target.value as DisplayConfig['eyelineStyle'] })}
          className="rounded border border-edge bg-panelalt px-2 py-1"
        >
          <option value="box">Focus box (Imaginary-style)</option>
          <option value="gradient">Focus gradient</option>
          <option value="line">Line</option>
          <option value="arrows">Side arrows</option>
          <option value="none">None</option>
        </select>
      </label>

      {(d.eyelineStyle === 'gradient' || d.eyelineStyle === 'box') && (
        <Range
          label="Dim intensity"
          min={0}
          max={1}
          step={0.05}
          value={d.eyelineGradientIntensity}
          onChange={(v) => set({ eyelineGradientIntensity: v })}
        />
      )}

      {d.eyelineStyle === 'box' && (
        <Range
          label="Focus box height"
          min={1}
          max={5}
          step={0.1}
          value={d.focusBoxHeightEm}
          suffix="em"
          onChange={(v) => set({ focusBoxHeightEm: v })}
        />
      )}

      <Toggle label="Show questions" checked={d.showQuestions} onChange={(v) => set({ showQuestions: v })} />

      <button
        onClick={() => setBlackout(d.id, !d.blackout)}
        className={`mt-2 rounded px-3 py-2 font-medium ${
          d.blackout ? 'bg-red-600 text-white' : 'bg-edge text-neutral-200'
        }`}
      >
        {d.blackout ? 'Blackout ON — click to clear' : 'Blackout display (B)'}
      </button>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-neutral-300">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent" />
    </label>
  )
}

function Range({
  label,
  min,
  max,
  step,
  value,
  suffix,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-neutral-400">
        <span>{label}</span>
        <span className="tabular-nums text-neutral-500">
          {value}
          {suffix ?? ''}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="accent-accent" />
    </label>
  )
}
