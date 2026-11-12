/* Alignment proposals are screen-distance based; the curve model still enforces
   edit bounds, ordering, snapping, and non-crossing after this helper runs. */
(function(root) {
  function alignDrag({ x, y, origin, points, scaleX, scaleY, mode = 'axis', axis = null, tolerance = 9 }) {
    if (mode === 'axis') {
      axis ||= Math.abs(scaleX(x) - scaleX(origin[0])) >= Math.abs(scaleY(y) - scaleY(origin[1])) ? 'horizontal' : 'vertical';
      return { x: axis === 'vertical' ? origin[0] : x, y: axis === 'horizontal' ? origin[1] : y, axis,
        guides: axis === 'horizontal' ? { y: origin[1] } : { x: origin[0] } };
    }
    let dx = tolerance, dy = tolerance; const guides = {};
    for (const point of points) {
      const px = Math.abs(scaleX(point[0]) - scaleX(x)), py = Math.abs(scaleY(point[1]) - scaleY(y));
      if (px < dx) { dx = px; guides.x = point[0]; }
      if (py < dy) { dy = py; guides.y = point[1]; }
    }
    return { x: guides.x ?? x, y: guides.y ?? y, axis: null, guides };
  }
  root.alignNapkinDrag = alignDrag;
  if (typeof module !== 'undefined') module.exports = alignDrag;
})(globalThis);

