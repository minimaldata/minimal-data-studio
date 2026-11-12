/* SVG renderer: owns geometry and gestures; CurveModel owns data and constraints. */
class D3NapkinChart {
  constructor(container, model, { topLabel = 'Remaining', topColor = '#a78bfa', template = {}, tooltipBehavior = NapkinTooltipTemplates.quiet, showEditHints = true, autoAlign = true, alignmentMode = 'axis' } = {}) {
    this.hiddenLines=new Set(); this.container = container; this.model = model; this.viewport = [...model.domain];
    this.yDomain = [...model.bounds]; this.editMode = true; this.tool = 'point'; this.showEditHints = showEditHints; this.autoAlign = autoAlign; this.alignmentMode = alignmentMode;
    this.template = {}; this.container.classList.add('d3-napkin-chart');
    this.topLabel = topLabel; this.topColor = topColor; this.margin = { left: 55, right: 24, top: 24, bottom: 42 };
    this.svg = d3.select(container).append('svg').attr('role', 'img').attr('aria-label', model.area ? 'Editable allocation boundaries' : 'Editable assumption curves');
    const clipId = 'plot-' + D3NapkinChart.nextId++;
    this.clipRect = this.svg.append('defs').append('clipPath').attr('id', clipId).append('rect');
    this.grid = this.svg.append('g').attr('class', 'grid');
    this.xAxis = this.svg.append('g').attr('class', 'axis'); this.yAxis = this.svg.append('g').attr('class', 'axis');
    this.plot = this.svg.append('g').attr('clip-path', `url(#${clipId})`).style('pointer-events', 'none');
    this.bands = this.plot.append('g'); this.paths = this.plot.append('g'); this.preview = this.plot.append('g');
    this.crosshair = this.plot.append('line').attr('class', 'crosshair').style('display', 'none');
    this.handles = this.svg.append('g').style('pointer-events', 'none');
    this.tooltip = d3.select(container).append('div').attr('class', 'tooltip').style('display', 'none');
    this.tooltipBehavior = new TooltipBehavior(tooltipBehavior, (p, style, phase) => this.showTooltip(p, style, phase), () => { this.tooltip.style('display', 'none'); this.crosshair.style('display', 'none'); });
    this.editHint = d3.select(container).append('div').attr('class', 'edit-hint').style('display', 'none');
    this.modifierListener = event => {
      if(event.key==='Shift'&&event.type==='keyup')this.deleteAnchor=null;
      if(event.key==='Escape'&&this.gesture?.deleting){this.gesture=null;this.deleteAnchor=null;this.model.cancel();this.clearHover();}
      if (['Shift', 'Control', 'Meta', 'Alt'].includes(event.key) && this.lastHover && !this.gesture) this.renderEditPreview(this.lastHover, event);
    };
    this.blurListener = () => {this.deleteAnchor=null;this.gesture=null;this.model.cancel();this.clearHover();};
    window.addEventListener('keydown', this.modifierListener);
    window.addEventListener('keyup', this.modifierListener);
    window.addEventListener('blur', this.blurListener);
    this.svg.on('pointerdown', e => this.down(e)).on('pointermove', e => this.pointer(e)).on('pointerup', e => this.up(e))
      .on('pointercancel', () => { this.gesture = null; model.cancel(); this.clearHover(); }).on('pointerleave', () => { if (!this.gesture) this.clearHover(); });
    this.unsubscribe = model.on(e => {if(e.type==='history')this.deleteAnchor=null;this.render();});
    this.observer = new ResizeObserver(() => this.render()); this.observer.observe(container);
    this.setTemplate(template);
  }
  // Presentation-only: does not touch model values, history, viewport, or gestures.
  setTemplate(template = {}) {
    this.template = { ...template, palette: [...(template.palette || [])], colors: { ...(template.colors || {}) } };
    const css = { surface: 'surface', grid: 'grid', axis: 'axis', text: 'text',
      crosshair: 'crosshair', tooltipBackground: 'tooltip-background',
      tooltipText: 'tooltip-text', tooltipRadius: 'tooltip-radius', font: 'font' };
    for (const [key, name] of Object.entries(css)) {
      const value = template[key];
      if (value == null) this.container.style.removeProperty('--napkin-' + name);
      else this.container.style.setProperty('--napkin-' + name, value);
    }
    this.render();
  }
  colorFor(line) {
    const index = this.model.lines.findIndex(item => item.id === line.id);
    return this.template.colors[line.id] || this.template.palette[index] || line.color || '#337b68';
  }
  setAutoAlign(enabled) { this.autoAlign = Boolean(enabled); this.preview.selectAll('.alignment-guide').remove(); }
  setEditHints(enabled) {
    this.showEditHints = Boolean(enabled);
    this.editHint.style('display', 'none');
    if (this.lastHover && !this.gesture) this.renderEditPreview(this.lastHover, this.lastModifiers || {});
  }
  setTooltipBehavior(preset) { this.tooltipBehavior.setPreset(preset); }
  setViewport(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || min < this.model.domain[0] || max > this.model.domain[1]) return false;
    this.clearHover(); this.viewport = [min, max]; this.render(); return true;
  }
  setYDomain(min, max) { if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return false; this.yDomain = [min, max]; this.render(); return true; }
  on(fn) { return this.model.on(fn); }
  setEditMode(enabled) { this.editMode = Boolean(enabled); this.clearHover(); this.render(); }
  resize() { this.render(); }
  exportDataAsJSON() { return JSON.stringify(this.model.lines, null, 2); }
  destroy() { window.removeEventListener('keydown', this.modifierListener); window.removeEventListener('keyup', this.modifierListener); window.removeEventListener('blur', this.blurListener); this.editHint.remove(); this.tooltipBehavior.clear(); this.observer.disconnect(); this.unsubscribe(); this.svg.remove(); this.tooltip.remove(); }
  point(event) { const [px, py] = d3.pointer(event, this.svg.node()); return { px, py, x: this.x.invert(px), y: this.y.invert(py) }; }
  inside(p) { return p.px >= this.margin.left && p.px <= this.width - this.margin.right && p.py >= this.margin.top && p.py <= this.height - this.margin.bottom; }
  visibleLines(){return this.model.lines.filter(l=>!this.hiddenLines?.has(l.id));}
  toggleLine(id){this.gesture=null;this.deleteAnchor=null;this.model.cancel();this.clearHover();if(this.hiddenLines.has(id))this.hiddenLines.delete(id);else this.hiddenLines.add(id);this.render();}
  nearest(p) {
    const candidates = [];
    this.model.lines.forEach((line, li) => line.data.forEach(([x, y], index) => {
      if(this.hiddenLines?.has(line.id))return;
      if (!this.model.editable(line, x, 'move') && !this.model.editable(line, x, 'delete')) return;
      if (x < this.viewport[0] || x > this.viewport[1]) return;
      const distance = Math.hypot(this.x(x) - p.px, this.y(y) - p.py);
      if (distance <= 12) candidates.push({ line, li, index, distance, y });
    }));
    candidates.sort((a, b) => Math.abs(a.distance - b.distance) > 0.5 ? a.distance - b.distance : (this.model.area ? (Math.abs(a.y - this.model.bounds[0]) < 1e-8 ? a.li - b.li : b.li - a.li) : a.li - b.li));
    return candidates[0];
  }
  nearestLine(p) {
    return this.visibleLines().filter(l => this.model.editable(l, Math.round(p.x), 'add')).sort((a, b) => Math.abs((this.model.valueAt(a.id, p.x) ?? curveValueAt(a.data, p.x)) - p.y) - Math.abs((this.model.valueAt(b.id, p.x) ?? curveValueAt(b.data, p.x)) - p.y))[0];
  }
  mode(event) { return event.metaKey || event.ctrlKey ? 'step' : event.altKey ? 'spike' : this.tool; }
  down(event) {
    if (event.button !== 0 || !this.editMode) return;
    const p = this.point(event); if (!this.inside(p)) return;
    event.preventDefault(); const hit = this.nearest(p); this.clearHover();
    if(hit&&(event.shiftKey||this.tool==='delete')){
      const x=hit.line.data[hit.index][0],anchor=event.shiftKey&&this.deleteAnchor?.id===hit.line.id?this.deleteAnchor.x:x;
      this.gesture={hit,start:p,deleting:true,anchor,end:x,shiftClick:event.shiftKey,pointerId:event.pointerId};
      this.svg.node().setPointerCapture(event.pointerId);this.rangePreview(hit.line,anchor,x);return;
    }
    this.deleteAnchor=null;
    this.gesture = { hit, start: p, shiftClick: event.shiftKey, origin: hit ? [...hit.line.data[hit.index]] : null, moved: false, mode: this.mode(event), pointerId: event.pointerId };
    if (hit) this.model.begin('move', hit.line.id);
    this.svg.node().setPointerCapture(event.pointerId);
  }
  pointer(event) {
    const p = this.point(event);
    if (this.gesture) {
      const g = this.gesture;
      if(g.deleting){const line=this.model.lines.find(l=>l.id===g.hit.line.id);const nearest=line.data.reduce((a,b)=>Math.abs(b[0]-p.x)<Math.abs(a[0]-p.x)?b:a);g.end=nearest[0];this.rangePreview(line,g.anchor,g.end);return;}
      if (Math.hypot(p.px - g.start.px, p.py - g.start.py) > 3) g.moved = true;
      if (g.hit && g.moved) {
        let target = { x: p.x, y: p.y, guides: {} };
        this.preview.selectAll('.alignment-guide').remove();
        if (this.autoAlign && event.shiftKey) {
          const points = this.visibleLines().flatMap(line => line.data.filter((point, index) => !(line.id === g.hit.line.id && index === g.hit.index)));
          target = alignNapkinDrag({ x: p.x, y: p.y, origin: g.origin, points,
            scaleX: this.x, scaleY: this.y, mode: this.alignmentMode, axis: g.alignmentAxis });
          g.alignmentAxis = target.axis;
        } else g.alignmentAxis = null;
        target.x = Math.max(this.viewport[0], Math.min(this.viewport[1], target.x));
        target.y = Math.max(this.yDomain[0], Math.min(this.yDomain[1], target.y));
        this.model.move(g.hit.line.id, g.hit.index, target.x, target.y, { snapY: target.guides.y == null });
        const actual = this.model.lines.find(l => l.id === g.hit.line.id).data[g.hit.index];
        const guide = this.preview;
        if (target.guides.x != null && Math.abs(actual[0] - target.guides.x) < 1e-8) guide.append('line').attr('class', 'alignment-guide').attr('x1', this.x(actual[0])).attr('x2', this.x(actual[0])).attr('y1', this.margin.top).attr('y2', this.height - this.margin.bottom);
        if (target.guides.y != null && Math.abs(actual[1] - target.guides.y) < 1e-8) guide.append('line').attr('class', 'alignment-guide').attr('x1', this.margin.left).attr('x2', this.width - this.margin.right).attr('y1', this.y(actual[1])).attr('y2', this.y(actual[1]));
        this.svg.style('cursor', target.axis === 'horizontal' ? 'ew-resize' : target.axis === 'vertical' ? 'ns-resize' : 'grabbing');
      }
      this.tooltipBehavior.move(p, true); return;
    }
    if (!this.inside(p)) { this.clearHover(); return; }
    this.tooltipBehavior.move(p);
    this.lastHover = p;
    this.renderEditPreview(p, event);
  }
  // Preview uses the same model operations as the actual click, on a detached copy.
  renderEditPreview(p, event) {
    this.lastModifiers = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey };
    this.preview.selectAll('*').remove(); this.paths.selectAll('path').style('opacity', null);
    this.editHint.style('display', 'none');
    if (!this.editMode) { this.svg.style('cursor', 'default'); return; }
    const hit = this.nearest(p);
    const deleting = event.shiftKey || this.tool === 'delete';
    const line = deleting ? hit?.line : hit?.line || this.nearestLine(p);
    const label = (text, blocked = false) => {
      if (!this.showEditHints) return;
      this.editHint.text(text).classed('blocked', blocked).style('display', 'block');
      const width = this.editHint.node().getBoundingClientRect().width;
      this.editHint.style('left', Math.max(4, Math.min(this.width - width - 4, p.px + 14)) + 'px').style('top', Math.min(this.height - 30, p.py + 15) + 'px');
    };
    if (!line) { this.svg.style('cursor', deleting ? 'not-allowed' : 'default'); if (deleting) label('Hover a point to delete', true); return; }
    if (hit && !deleting) {
      const movable = this.model.editable(line, line.data[hit.index][0], 'move');
      this.svg.style('cursor', movable ? 'grab' : 'not-allowed');
      label(movable ? '↔ Drag point · Shift to delete' : 'Point is locked', !movable); return;
    }
    if(deleting&&hit){const x=line.data[hit.index][0],anchor=event.shiftKey&&this.deleteAnchor?.id===line.id?this.deleteAnchor.x:x;this.rangePreview(line,anchor,x);return;}
    const proposal = new CurveModel({ lines: this.model.lines, domain: this.model.domain, bounds: this.model.bounds, area: this.model.area, snap: this.model.snap, monotonic: this.model.monotonic });
    const allowed = deleting ? proposal.remove(line.id, hit.index) : proposal.add(line.id, p.x, p.y, this.mode(event));
    this.svg.style('cursor', allowed ? 'crosshair' : 'not-allowed');
    if (!allowed) {
      let reason = 'Edit blocked by constraints';
      if (deleting && line.data.length <= 2) reason = 'Keep at least two points';
      else if (deleting && this.model.area && (hit.index === 0 || hit.index === line.data.length - 1)) reason = 'Area endpoint is pinned';
      else if (deleting && !this.model.editable(line, line.data[hit.index][0], 'delete')) reason = 'Point is locked';
      else if (!deleting && line.data.some(pt => pt[0] === Math.round(p.x))) reason = 'A point already exists at this X';
      label('⊘ ' + reason, true);
    } else {
      const proposed = proposal.lines.find(l => l.id === line.id);
      const data = this.displayData(proposed);
      this.paths.selectAll('path').filter(l => l.id === line.id).style('opacity', .25);
      this.preview.append('path').attr('class', 'edit-preview-path').attr('d', this.linePath(data)).attr('fill', 'none').attr('stroke', this.colorFor(line)).attr('stroke-width', 2.5).attr('stroke-dasharray', '5 4');
      label(deleting ? (this.tool !== 'delete' && this.autoAlign ? '− Click to delete · Shift-drag to align' : '− Delete point · line reconnects') : this.mode(event) === 'step' ? '+ Add step' : this.mode(event) === 'spike' ? '+ Add spike' : '+ Add point');
    }
    if (deleting) {
      const [x, y] = line.data[hit.index];
      const mark = this.preview.append('g').attr('class', 'delete-preview').attr('transform', 'translate(' + this.x(x) + ',' + this.y(y) + ')');
      mark.append('circle').attr('r', 10).attr('fill', '#fff').attr('fill-opacity', .85).attr('stroke', allowed ? '#be3b42' : '#858585').attr('stroke-width', 2);
      mark.append('path').attr('d', 'M-4,-4L4,4M-4,4L4,-4').attr('stroke', allowed ? '#be3b42' : '#858585').attr('stroke-width', 2);
    } else if (allowed) {
      const proposed = proposal.lines.find(l => l.id === line.id);
      for (const point of proposed.data.filter(pt => !line.data.some(old => old[0] === pt[0]))) this.preview.append('circle').attr('cx', this.x(point[0])).attr('cy', this.y(point[1])).attr('r', 5).attr('fill', this.template.handleFill || 'white').attr('stroke', this.colorFor(line)).attr('stroke-width', 2);
    }
  }

  rangePreview(line,a,b){
    this.preview.selectAll('*').remove();this.paths.selectAll('path').style('opacity',null);
    const proposal=new CurveModel({lines:this.model.lines,domain:this.model.domain,bounds:this.model.bounds,area:this.model.area,snap:this.model.snap,monotonic:this.model.monotonic});
    const allowed=proposal.removeRange(line.id,a,b),lo=Math.min(a,b),hi=Math.max(a,b),points=line.data.filter(p=>p[0]>=lo&&p[0]<=hi);
    this.svg.style('cursor',allowed?'crosshair':'not-allowed');
    for(const [x,y] of points){const g=this.preview.append('g').attr('transform',`translate(${this.x(x)},${this.y(y)})`);g.append('circle').attr('r',9).attr('fill','#fff').attr('stroke',allowed?'#be3b42':'#888');g.append('path').attr('d','M-4,-4L4,4M-4,4L4,-4').attr('stroke','#be3b42');}
    if(allowed){this.paths.selectAll('path').filter(l=>l.id===line.id).style('opacity',.25);this.preview.append('path').attr('d',this.linePath(this.displayData(proposal.lines.find(l=>l.id===line.id)))).attr('fill','none').attr('stroke',this.colorFor(line)).attr('stroke-width',2.5).attr('stroke-dasharray','5 4');}
    if(this.showEditHints)this.editHint.text(allowed?`Delete ${points.length} point(s) · release to apply`:'Range blocked by protected points or constraints').style('display','block').style('left','12px').style('top','12px');
  }
  up(event) {
    const g = this.gesture; if (!g) return; this.gesture = null; this.preview.selectAll('.alignment-guide').remove(); this.svg.style('cursor', 'default');
    if (this.svg.node().hasPointerCapture(event.pointerId)) this.svg.node().releasePointerCapture(event.pointerId);
    if(g.deleting){const success=this.model.removeRange(g.hit.line.id,g.anchor,g.end);if(success&&event.shiftKey)this.deleteAnchor={id:g.hit.line.id,x:g.end};else if(!event.shiftKey)this.deleteAnchor=null;this.clearHover();return;}
    if (g.hit && g.shiftClick && !g.moved) { this.model.cancel(); this.model.remove(g.hit.line.id, g.hit.index); }
    else if (g.hit) this.model.commit();
    else if (!g.moved && !g.shiftClick) { const p = this.point(event); if (this.inside(p)) { const line = this.nearestLine(p); if (line) this.model.add(line.id, p.x, p.y, g.mode); } }
    const p = this.point(event);
    if (this.inside(p)) this.tooltipBehavior.move(p); else this.clearHover();
  }
  clearHover() { this.lastHover = null; this.tooltipBehavior.clear(); this.preview.selectAll('*').remove(); this.paths.selectAll('path').style('opacity', null); this.editHint.style('display', 'none'); this.svg.style('cursor', 'default'); }
  bandValues(x) {
    const vals = this.model.lines.map(l => curveValueAt(l.data, x)), hi = this.model.bounds[1], lo = this.model.bounds[0];
    return [{ name: this.topLabel, color: this.template.topColor || this.topColor, low: vals[0] ?? lo, high: hi }, ...this.model.lines.map((l, i) => ({ name: l.name, color: this.colorFor(l), low: vals[i + 1] ?? lo, high: vals[i] }))];
  }
  showTooltip(p, style, phase) {
    const visible=this.visibleLines();if(!visible.length&&!this.model.area){this.tooltip.style('display','none');return;}
    const x = Math.max(this.viewport[0], Math.min(this.viewport[1], Math.round(p.x)));
    this.crosshair.attr('x1', this.x(x)).attr('x2', this.x(x)).attr('y1', this.margin.top).attr('y2', this.height - this.margin.bottom).style('display', null);
    let rows = this.model.area ? this.bandValues(x).map(b => `${b.name}: ${(b.high - b.low).toFixed(2)}%`) : visible.map(l => `${l.name}: ${this.model.valueAt(l.id, x)?.toFixed(2) ?? 'No value'}`);
    if (style.compact) {
      let index;
      if (this.gesture?.hit) index = this.model.area?this.gesture.hit.li+1:visible.findIndex(l=>l.id===this.gesture.hit.line.id);
      else if (this.model.area) index = this.bandValues(x).findIndex(b => p.y >= b.low && p.y <= b.high);
      else index = visible.reduce((best, l, i, lines) => (this.model.valueAt(l.id, x) == null ? Infinity : Math.abs(this.model.valueAt(l.id, x) - p.y)) < (this.model.valueAt(lines[best].id, x) == null ? Infinity : Math.abs(this.model.valueAt(lines[best].id, x) - p.y)) ? i : best, 0);
      rows = [rows[Math.max(0, index)]].filter(Boolean);
    }
    this.tooltip.attr('data-phase', phase).classed('compact', style.compact).style('opacity', style.opacity).text(`X = ${x}${style.compact ? ' · ' : '\n'}${rows.join('\n')}`).style('display', 'block').style('left', `${Math.max(5, Math.min(this.width - 185, p.px + 16))}px`).style('top', `${Math.max(0, p.py - 95)}px`);
    const box = this.tooltip.node().getBoundingClientRect();
    this.tooltip.style('left', `${Math.max(4, Math.min(this.width - box.width - 4, p.px + 16))}px`).style('top', `${Math.max(4, Math.min(this.height - box.height - 4, p.py - box.height - 14))}px`);
  }
  displayData(line) {
    const data = line.data.map(p => [...p]), first = data[0], last = data.at(-1);
    const rule = line.extrapolation || {};
    if (first[0] > this.model.domain[0] && rule.before !== 'none') {
      if (rule.before === 'zero') data.unshift([first[0], 0]);
      data.unshift([this.model.domain[0], curveValueAt(line.data, this.model.domain[0], rule)]);
    }
    if (last[0] < this.model.domain[1] && rule.after !== 'none') {
      if (rule.after === 'zero') data.push([last[0], 0]);
      data.push([this.model.domain[1], curveValueAt(line.data, this.model.domain[1], rule)]);
    }
    return data;
  }
  render() {
    this.width = Math.max(300, this.container.clientWidth); this.height = 370;
    const m = this.margin;
    this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`).attr('width', this.width).attr('height', this.height);
    this.x = d3.scaleLinear().domain(this.viewport).range([m.left, this.width - m.right]);
    this.y = d3.scaleLinear().domain(this.yDomain).range([this.height - m.bottom, m.top]);
    this.linePath = d3.line().x(p => this.x(p[0])).y(p => this.y(p[1]));
    this.clipRect.attr('x', m.left).attr('y', m.top).attr('width', this.width - m.left - m.right).attr('height', this.height - m.top - m.bottom);
    this.xAxis.attr('transform', `translate(0,${this.height - m.bottom})`).call(d3.axisBottom(this.x).ticks(this.width < 500 ? 5 : 10));
    this.yAxis.attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(this.y).ticks(5));
    this.grid.attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(this.y).ticks(5).tickSize(-(this.width - m.left - m.right)).tickFormat(''));
    const fullData = l => this.displayData(l);
    if (this.model.area) {
      const xs = [...new Set([...this.model.domain, ...this.model.lines.flatMap(l => l.data.map(p => p[0]))])].sort((a, b) => a - b);
      const bands = this.bandValues(0).map((band, i) => ({ ...band, data: xs.map(x => ({ x, ...this.bandValues(x)[i] })) }));
      this.bands.selectAll('path').data(bands, b => b.name).join('path').attr('fill', b => b.color).attr('fill-opacity', this.template.areaOpacity ?? .2).attr('d', b => d3.area().x(p => this.x(p.x)).y0(p => this.y(p.low)).y1(p => this.y(p.high))(b.data));
    }
    this.paths.selectAll('path').data(this.visibleLines(), l => l.id).join('path').attr('fill', 'none').attr('stroke', l => this.colorFor(l)).attr('stroke-width', l => l.lineStyle?.width || 2.5).attr('stroke-opacity', l => l.lineStyle?.opacity ?? 1).attr('stroke-dasharray', l => l.lineStyle?.type === 'dashed' ? '7 5' : l.lineStyle?.type === 'dotted' ? '2 5' : null).attr('d', l => this.linePath(fullData(l)));
    const points = this.visibleLines().flatMap(l => l.data.map((p, index) => ({ line: l, p, index })).filter(v => v.p[0] >= this.viewport[0] && v.p[0] <= this.viewport[1] && v.p[1] >= this.yDomain[0] && v.p[1] <= this.yDomain[1] && (this.model.editable(l, v.p[0]) || this.model.editable(l, v.p[0], 'delete'))));
    this.handles.selectAll('circle').data(this.editMode ? points : [], p => `${p.line.id}:${p.index}`).join('circle').attr('cx', p => this.x(p.p[0])).attr('cy', p => this.y(p.p[1])).attr('r', this.template.handleRadius ?? 5).attr('fill', this.template.handleFill || 'white').attr('stroke', p => this.colorFor(p.line)).attr('stroke-width', 2);
  }
}
D3NapkinChart.nextId = 0;

