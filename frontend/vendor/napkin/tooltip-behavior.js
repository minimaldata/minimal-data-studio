/* Timing is independent of rendering. Durations start when shown; 0 means
   stay visible until the next phase. Pause means a stationary, non-drag pointer. */
(function(root) {
  const presets = {
    quiet: { name: 'Quiet', pauseAfterMs: 650,
      hover: { delayMs: 200, durationMs: 650, opacity: .55, compact: true },
      drag: { delayMs: 0, durationMs: 0, opacity: .65, compact: true },
      pause: { delayMs: 0, durationMs: 1800, opacity: .92, compact: false } },
    compact: { name: 'Compact', pauseAfterMs: 450,
      hover: { delayMs: 100, durationMs: 0, opacity: .7, compact: true },
      drag: { delayMs: 0, durationMs: 0, opacity: .75, compact: true },
      pause: { delayMs: 0, durationMs: 2500, opacity: .85, compact: true } },
    inspect: { name: 'Inspect', pauseAfterMs: 500,
      hover: { delayMs: 0, durationMs: 0, opacity: .9, compact: false },
      drag: { delayMs: 0, durationMs: 0, opacity: .85, compact: false },
      pause: { delayMs: 0, durationMs: 0, opacity: 1, compact: false } },
    onPause: { name: 'On pause', pauseAfterMs: 800,
      hover: { delayMs: 0, durationMs: 0, opacity: 0, compact: true },
      drag: { delayMs: 0, durationMs: 0, opacity: .55, compact: true },
      pause: { delayMs: 0, durationMs: 2200, opacity: .9, compact: false } },
  };
  class TooltipBehavior {
    constructor(preset, show, hide, clock = globalThis) {
      this.show = show; this.hide = hide; this.clock = clock; this.setPreset(preset);
    }
    setPreset(preset) { this.clear(); this.preset = structuredClone(preset); }
    clear() {
      for (const key of ['delayTimer', 'durationTimer', 'pauseTimer']) { this.clock.clearTimeout(this[key]); this[key] = null; }
      this.phase = null; this.visible = false; this.hide();
    }
    enter(phase) {
      this.clock.clearTimeout(this.delayTimer); this.clock.clearTimeout(this.durationTimer);
      this.phase = phase; this.visible = false; this.hide();
      const style = this.preset[phase];
      if (!style || style.opacity <= 0) return;
      const reveal = () => {
        this.visible = true; this.show(this.point, style, phase);
        if (style.durationMs > 0) this.durationTimer = this.clock.setTimeout(() => { this.visible = false; this.hide(); }, style.durationMs);
      };
      if (style.delayMs > 0) this.delayTimer = this.clock.setTimeout(reveal, style.delayMs); else reveal();
    }
    move(point, dragging = false) {
      this.point = point;
      const phase = dragging ? 'drag' : 'hover';
      if (this.phase !== phase) this.enter(phase);
      else if (this.visible) this.show(point, this.preset[phase], phase);
      this.clock.clearTimeout(this.pauseTimer);
      if (!dragging) this.pauseTimer = this.clock.setTimeout(() => this.enter('pause'), this.preset.pauseAfterMs);
    }
  }
  root.NapkinTooltipTemplates = presets; root.TooltipBehavior = TooltipBehavior;
  if (typeof module !== 'undefined') module.exports = { TooltipBehavior, presets };
})(globalThis);

