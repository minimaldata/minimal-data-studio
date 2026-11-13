/** Shared loading treatment; status text remains readable without the animation. */
export function setLoading(node,active){
  if(!node)return;
  node.classList.toggle('studio-loading',Boolean(active));
  node.setAttribute('aria-busy',String(Boolean(active)));
}
