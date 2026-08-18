import { useStore } from '../store/useStore'
import type { DisplayConfig } from '../store/types'

/**
 * Display settings. The READING LAYOUT (font, line height, eyeline, focus box,
 * line width, questions) is SHARED across every screen — a change mirrors to all
 * outputs so the talent sees exactly the operator's readout. Only orientation
 * (mirror/flip/rotate) and blackout are per-screen.
 */
export default function DisplaySettings({ displayId }: { displayId?: string }) {
  const displays = useStore((s) => s.displays)
  const updateDisplay = useStore((s) => s.updateDisplay)
  const updateLayout = useStore((s) => s.updateLayout)
  const setBlackout = useStore((s) => s.setBlackout)
  const d = displays.find((x) => x.id === displayId) ?? displays[0]
  if (!d) return null

  // Per-screen (this display only).
  function setThis(patch: Partial<DisplayConfig>) {
    updateDisplay(d.id, patch)
  }
  // Shared reading layout (all screens at once).
  function setAll(patch: Partial<DisplayConfig>) {
    updateLayout(patch)
  }

  return (
    <div className="thin-scroll flex flex-col gap-4 overflow-auto bg-panel p-4 text-sm">
      {/* --- Per-screen: orientation for this rig --- */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          This screen only
        </h3>
        <Toggle label="Mirror (beam-splitter)" checked={d.mirrorH} onChange={(v) => setThis({ mirrorH: v })} />
        <Toggle label="Flip vertical" checked={d.flipV} onChange={(v) => setThis({ flipV: v })} />
        <Toggle label="Rotate 180°" checked={d.rotate180} onChange={(v) => setThis({ rotate180: v })} />
        <label className="flex items-center justify-between gap-2">
          <span className="text-neutral-300">Show notes on this display</span>
          <input
            type="checkbox"
            checked={d.showNotes}
            onChange={(e) => setThis({ showNotes: e.target.checked })}
            className="h-4 w-4 accent-accent"
            title="Director notes — leave OFF for any talent-facing display"
          />
        </label>
      </div>

      {/* --- Shared: reading layout mirrored to every screen --- */}
      <div className="flex flex-col gap-3 border-t border-edge pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Reading layout · all screens
        </h3>

        <Range label="Font size" min={24} max={160} step={2} value={d.fontSizePx} suffix="px"
          onChange={(v) => setAll({ fontSizePx: v })} />
        <Range label="Line height" min={1} max={2.4} step={0.05} value={d.lineHeight}
          onChange={(v) => setAll({ lineHeight: v })} />
        <Range label="Eyeline position" min={0.15} max={0.7} step={0.01} value={d.eyelineFrac}
          onChange={(v) => setAll({ eyelineFrac: v })} />
        <Range label="Line width" min={16} max={60} step={1} value={d.maxLineCh} suffix=" ch"
          onChange={(v) => setAll({ maxLineCh: v })} />

        <label className="flex flex-col gap-1">
          <span className="text-neutral-400">Eyeline style</span>
          <select
            value={d.eyelineStyle}
            onChange={(e) => setAll({ eyelineStyle: e.target.value as DisplayConfig['eyelineStyle'] })}
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
          <Range label="Dim intensity" min={0} max={1} step={0.05} value={d.eyelineGradientIntensity}
            onChange={(v) => setAll({ eyelineGradientIntensity: v })} />
        )}

        {d.eyelineStyle === 'box' && (
          <Range label="Focus box height" min={1} max={5} step={0.1} value={d.focusBoxHeightEm} suffix="em"
            onChange={(v) => setAll({ focusBoxHeightEm: v })} />
        )}

        <Toggle label="Show questions" checked={d.showQuestions} onChange={(v) => setAll({ showQuestions: v })} />
      </div>

      <button
        onClick={() => setBlackout(d.id, !d.blackout)}
        className={`mt-1 rounded px-3 py-2 font-medium ${
          d.blackout ? 'bg-red-600 text-white' : 'bg-edge text-neutral-200'
        }`}
      >
        {d.blackout ? 'Blackout ON — click to clear' : 'Blackout this screen (B)'}
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
