/* DOM-free curve model. All edits pass through the same transaction and constraints. */
(function (root) {
  const clone = value => JSON.parse(JSON.stringify(value));
  function valueAt(points, x, extrapolation = {}) {
    if (!points.length) return 0;
    const first = points[0], last = points.at(-1);
    if (x < first[0] || x > last[0]) {
      const before = x < first[0], mode = extrapolation[before ? 'before' : 'after'] || 'hold';
      const edge = before ? first : last;
      if (mode === 'none') return null;
      if (mode === 'zero') return 0;
      if (mode === 'extend' && points.length > 1) {
        const a = before ? first : points.at(-2), b = before ? points[1] : last;
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
      return edge[1];
    }
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (x <= b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
    return points.at(-1)[1];
  }
  class CurveModel {
    constructor({ lines, domain = [0, 100], bounds = [0, 100], area = false, snap = 1, monotonic = 'none' }) {
      this.lines = clone(lines); this.domain = domain; this.bounds = bounds;
      this.area = area; this.snap = snap; this.monotonic = monotonic;
      this.listeners = new Set(); this.history = [clone(this.lines)]; this.cursor = 0;
      this.transaction = null;
    }
    on(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    emit(type, details = {}) { for (const fn of this.listeners) fn({ type, ...details }); }
    valueAt(id, x) { const line = this.lines.find(l => l.id === id); return valueAt(line.data, x, line.extrapolation); }
    setExtrapolation(id, before, after) {
      if (this.area || !['hold','extend','zero','none'].includes(before) || !['hold','extend','zero','none'].includes(after)) return false;
      const line = this.lines.find(l => l.id === id); if (!line) return false;
      this.begin('extrapolation', id); line.extrapolation = { before, after }; this.commit(); return true;
    }
    sample() { return Array.from({ length: this.domain[1] - this.domain[0] + 1 }, (_, i) => {
      const x = this.domain[0] + i; return { x, values: this.lines.map(l => valueAt(l.data, x, l.extrapolation)) };
    }); }
    editable(line, x, operation = 'move') {
      if (line.editable === false) return false;
      const ranges = line.editDomain?.[operation + 'X'] ?? line.editDomain?.x;
      return !ranges || ranges.some(([a, b]) => x >= a && x <= b);
    }
    begin(operation, lineId) {
      if (this.transaction) this.cancel();
      this.transaction = { operation, lineId, before: clone(this.lines) };
      this.emit('editStart', { operation, lineId });
    }
    valid(next) {
      for (let li = 0; li < next.length; li++) {
        const line = next[li], old = this.lines[li];
        if (line.data.length < 2) return false;
        for (let i = 0; i < line.data.length; i++) {
          const [x, y] = line.data[i];
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < this.domain[0] || x > this.domain[1] || y < this.bounds[0] - 1e-8 || y > this.bounds[1] + 1e-8) return false;
          if (i && x <= line.data[i - 1][0]) return false;
          if (line.editable !== false && i && this.monotonic === 'ascending' && y < line.data[i - 1][1]) return false;
          if (line.editable !== false && i && this.monotonic === 'descending' && y > line.data[i - 1][1]) return false;
        }
        // Locked periods must retain their interpolated values, not only their handles.
        for (let x = this.domain[0]; x <= this.domain[1]; x++) {
          if (!this.editable(old, x) && Math.abs(valueAt(old.data, x) - valueAt(line.data, x)) > 1e-8) return false;
        }
      }
      if (this.area) {
        const xs = new Set(next.flatMap(l => l.data.map(p => p[0])));
        for (const x of xs) for (let i = 1; i < next.length; i++) {
          if (valueAt(next[i - 1].data, x) < valueAt(next[i].data, x) - 1e-8) return false;
        }
      }
      return true;
    }
    apply(next) {
      if (!this.valid(next)) { this.emit('editRejected', { reason: 'Edit would violate a locked period, monotonic constraint, or area boundary.' }); return false; }
      this.lines = next;
      this.emit('editPreview', { ...this.transaction, after: clone(next) }); return true;
    }
    move(id, index, x, y, { snapY = true } = {}) {
      const next = clone(this.lines), li = next.findIndex(l => l.id === id), line = next[li];
      if (!line || !this.editable(line, line.data[index][0])) return false;
      const left = line.data[index - 1], right = line.data[index + 1];
      const pinned = this.area && (index === 0 || index === line.data.length - 1);
      x = pinned ? line.data[index][0] : Math.max(left ? left[0] + 1 : this.domain[0], Math.min(right ? right[0] - 1 : this.domain[1], Math.round(x)));
      if (!this.editable(line, x)) return false;
      if (snapY) y = Math.round(y / this.snap) * this.snap;
      let low = this.bounds[0], high = this.bounds[1];
      if (this.monotonic === 'ascending') { low = Math.max(low, left?.[1] ?? low); high = Math.min(high, right?.[1] ?? high); }
      if (this.monotonic === 'descending') { high = Math.min(high, left?.[1] ?? high); low = Math.max(low, right?.[1] ?? low); }
      if (this.area) { if (li) high = Math.min(high, valueAt(next[li - 1].data, x)); if (li < next.length - 1) low = Math.max(low, valueAt(next[li + 1].data, x)); }
      line.data[index] = [x, Math.max(low, Math.min(high, y))];
      return this.apply(next);
    }
    add(id, x, y, mode = 'point') {
      const next = clone(this.lines), line = next.find(l => l.id === id);
      x = Math.round(x); y = Math.max(this.bounds[0], Math.min(this.bounds[1], Math.round(y / this.snap) * this.snap));
      if (!line || !this.editable(line, x, 'add') || line.data.some(p => p[0] === x)) return false;
      const before = clone(line.data);
      const insert = (px, py) => {
        if (px < this.domain[0] || px > this.domain[1] || line.data.some(p => p[0] === px)) return;
        if (Number.isFinite(py) && this.editable(line, px, 'add')) line.data.push([px, py]);
      };
      if (mode !== 'point') insert(x - 1, valueAt(before, x - 1, line.extrapolation));
      insert(x, y);
      if (mode === 'spike') insert(x + 1, valueAt(before, x + 1, line.extrapolation));
      if (mode === 'step') {
        const p = before.find(p => p[0] > x);
        if (p && this.editable(line, p[0])) line.data.find(v => v[0] === p[0])[1] = y;
      }
      line.data.sort((a, b) => a[0] - b[0]);
      this.begin(mode === 'point' ? 'add' : mode, id); const result = this.apply(next); this.commit(); return result;
    }
    remove(id, index) {
      const next = clone(this.lines), line = next.find(l => l.id === id);
      if (!line || line.data.length <= 2 || !this.editable(line, line.data[index][0], 'delete')) return false;
      if (this.area && (index === 0 || index === line.data.length - 1)) return false;
      this.begin('delete', id); line.data.splice(index, 1); const result = this.apply(next); this.commit(); return result;
    }
    removeRange(id, a, b) {
      const next=clone(this.lines),line=next.find(l=>l.id===id);if(!line)return false;
      const lo=Math.min(a,b),hi=Math.max(a,b),selected=line.data.filter(p=>p[0]>=lo&&p[0]<=hi);
      if(!selected.length||selected.some(p=>!this.editable(line,p[0],'delete')))return false;
      if(this.area&&selected.some(p=>p===line.data[0]||p===line.data.at(-1)))return false;
      line.data=line.data.filter(p=>p[0]<lo||p[0]>hi);if(line.data.length<2||!this.valid(next))return false;
      this.begin('delete range',id);const result=this.apply(next);this.commit();return result;
    }
    commit() {
      if (!this.transaction) return;
      const tx = this.transaction; this.transaction = null;
      if (JSON.stringify(tx.before) === JSON.stringify(this.lines)) { this.emit('editCancel'); return; }
      this.history = this.history.slice(0, this.cursor + 1); this.history.push(clone(this.lines)); this.cursor++;
      this.emit('editCommit', { ...tx, after: clone(this.lines) });
    }
    cancel() { if (!this.transaction) return; this.lines = this.transaction.before; this.transaction = null; this.emit('editCancel'); }
    undo() { this.cancel(); if (this.cursor) { this.lines = clone(this.history[--this.cursor]); this.emit('history', { operation: 'undo' }); } }
    redo() { this.cancel(); if (this.cursor < this.history.length - 1) { this.lines = clone(this.history[++this.cursor]); this.emit('history', { operation: 'redo' }); } }
    simplify() {
      this.begin('simplify', null);
      const next = clone(this.lines);
      for (const line of next) for (let i = line.data.length - 2; i > 0; i--) {
        if (this.editable(line, line.data[i][0], 'delete') && Math.abs(valueAt([line.data[i - 1], line.data[i + 1]], line.data[i][0]) - line.data[i][1]) < 1e-9) line.data.splice(i, 1);
      }
      this.apply(next); this.commit();
    }
  }
  root.CurveModel = CurveModel; root.curveValueAt = valueAt;
  if (typeof module !== 'undefined') module.exports = { CurveModel, valueAt };
})(globalThis);

