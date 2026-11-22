// Saved expressions retain stable references; the editor displays their values.
export function mountCalculatorExpression(root,{snapshots,inspect,format=String}){
 let caret=null,autoOperator=null,linked=new Set();
 const styleLink=chip=>{const live=linked.has(chip.dataset.snapshot);chip.classList.toggle('calculator-value-live',live);const description=live?'Linked to the current selection. Changing the selection updates this value.':'Frozen value. New selections will not change it.';chip.title=description+' Click to show source.';chip.setAttribute('aria-description',description);};
 const serialize=node=>{
  if(node.nodeType===Node.TEXT_NODE)return node.textContent.replace(/\u200b/g,'');
  if(node.dataset?.snapshot)return node.dataset.snapshot;
  if(node.dataset?.operator)return node.dataset.operator;
  return [...node.childNodes].map(serialize).join('');
 };
 const symbols={'+':'+','-':'−','*':'×','/':'÷','×':'×','÷':'÷','^':'^','%':'%'};
 const makeOperator=symbol=>{const chip=document.createElement('span');chip.className='calculator-operator-chip';chip.contentEditable='false';chip.tabIndex=0;chip.setAttribute('role','button');chip.dataset.operator=symbol;chip.textContent=symbols[symbol];chip.setAttribute('aria-label',`Change operator ${symbols[symbol]}`);chip.setAttribute('aria-haspopup','menu');return chip;};
 const fragment=text=>{
  const result=document.createDocumentFragment();
  for(const part of text.split(/(\$\d+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[+*\/×÷^%−-])/gi)){
   if(Object.hasOwn(symbols,part)){result.append(makeOperator(part),document.createTextNode('\u200b'));continue;}
   const value=snapshots().find(s=>s.id===part);
   if(!value){result.append(document.createTextNode(part));continue;}
   const chip=document.createElement('span');chip.className='calculator-value-chip';chip.contentEditable='false';chip.dataset.snapshot=value.id;chip.tabIndex=0;chip.setAttribute('role','button');chip.setAttribute('aria-label',`Source for ${value.value}`);chip.title='Show source';chip.textContent=format(value.value);styleLink(chip);
   chip.onclick=()=>{caret=document.createRange();caret.setStartAfter(chip);caret.collapse(true);inspect(value);};chip.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();inspect(value);}};result.append(chip,document.createTextNode('\u200b'));
  }
  return result;
 };
 const remember=()=>{
  const s=getSelection(),inside=s?.rangeCount&&root.contains(s.anchorNode)&&root.contains(s.focusNode);
  const chipAt=node=>(node.nodeType===Node.ELEMENT_NODE?node:node.parentElement)?.closest('[data-snapshot],[data-operator]');
  if(inside){caret=s.getRangeAt(0).cloneRange();const first=chipAt(caret.startContainer),last=chipAt(caret.endContainer);
   if(caret.collapsed&&first){caret.setStartAfter(first);caret.collapse(true);}else if(!caret.collapsed){if(first)caret.setStartBefore(first);if(last)caret.setEndAfter(last);}
  }
  for(const chip of root.querySelectorAll('[data-snapshot],[data-operator]'))chip.classList.toggle('is-expression-selected',!!(inside&&!s.isCollapsed&&s.getRangeAt(0).intersectsNode(chip)));
  const highlighted=inside&&!s.isCollapsed;root.classList.toggle('has-expression-selection',!!highlighted);
  const lines=[];
  if(highlighted)for(const rect of s.getRangeAt(0).getClientRects()){
   if(!rect.width||!rect.height)continue;
   const line=lines.find(r=>rect.top<r.bottom&&rect.bottom>r.top);
   if(line){line.left=Math.min(line.left,rect.left);line.right=Math.max(line.right,rect.right);line.top=Math.min(line.top,rect.top);line.bottom=Math.max(line.bottom,rect.bottom);}
   else lines.push({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom});
  }
  const box=root.getBoundingClientRect();root.style.backgroundImage=lines.map(()=> 'linear-gradient(var(--calculator-selection),var(--calculator-selection))').join(',');
  root.style.backgroundPosition=lines.map(r=>`${r.left-box.left-1}px ${r.top-box.top-1}px`).join(',');root.style.backgroundSize=lines.map(r=>`${r.right-r.left}px ${r.bottom-r.top}px`).join(',');root.style.backgroundRepeat='no-repeat';

 };
 document.addEventListener('selectionchange',remember);
 root.addEventListener('pointerdown',()=>{autoOperator=null;});
 const end=()=>{const r=document.createRange();r.selectNodeContents(root);r.collapse(false);return r;};
 const place=range=>{const s=getSelection();s.removeAllRanges();s.addRange(range);caret=range.cloneRange();};
 const insert=(text,{value=false}={})=>{
  root.focus();const range=caret&&root.contains(caret.commonAncestorContainer)?caret:end();
  const prefix=document.createRange();prefix.selectNodeContents(root);prefix.setEnd(range.startContainer,range.startOffset);
  const suffix=document.createRange();suffix.selectNodeContents(root);suffix.setStart(range.endContainer,range.endOffset);
  const before=serialize(prefix.cloneContents()).trimEnd(),after=serialize(suffix.cloneContents()).trimStart();
  const addBefore=value&&/[\d)%]$/.test(before),addAfter=value&&/^(?:\$\d|\d|\()/.test(after);
  range.deleteContents();const nodes=document.createDocumentFragment();autoOperator=null;
  if(addBefore){const op=makeOperator('+');nodes.append(document.createTextNode(' '),op,document.createTextNode(' '));autoOperator=op;}
  nodes.append(fragment(text));if(addAfter)nodes.append(document.createTextNode(' '),makeOperator('+'),document.createTextNode(' '));const last=nodes.lastChild;range.insertNode(nodes);
  if(autoOperator){const op=autoOperator;autoOperator=document.createRange();autoOperator.selectNode(op);}
  if(last){range.setStartAfter(last);range.collapse(true);}place(range);root.dispatchEvent(new Event('input',{bubbles:true}));
 };
 const wrap=()=>{
  root.focus();const range=caret&&root.contains(caret.commonAncestorContainer)?caret:end();
  const empty=range.collapsed,nodes=range.extractContents(),open=document.createTextNode('('),close=document.createTextNode(')');
  nodes.insertBefore(open,nodes.firstChild);nodes.append(close);range.insertNode(nodes);
  range.setStartAfter(empty?open:close);range.collapse(true);place(range);autoOperator=null;root.dispatchEvent(new Event('input',{bubbles:true}));
 };
 const operator=symbol=>{
  remember();
  if(symbol==='wrap'||symbol==='('&&caret&&!caret.collapsed){wrap();return;}
  if(caret?.collapsed&&autoOperator&&root.contains(autoOperator.commonAncestorContainer)&&['+','-','×','÷','^'].includes(symbol)){
   const resume=caret.cloneRange(),range=autoOperator.cloneRange();autoOperator=null;caret=range;insert(symbol);place(resume);return;
  }
  insert(symbol);
 };
 let menu=null,menuChip=null;
 const closeMenu=(focus=false)=>{menu?.remove();menu=null;if(menuChip?.isConnected){menuChip.setAttribute('aria-expanded','false');if(focus){root.focus();place(end());}}menuChip=null;};
 const openMenu=(chip,gap=null)=>{
  closeMenu();menuChip=chip;chip?.setAttribute('aria-expanded','true');autoOperator=null;
  menu=document.createElement('div');menu.className='calculator-operator-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',gap?'Insert operator':'Change operator');
  for(const [symbol,name] of [['+','Add'],['-','Subtract'],['×','Multiply'],['÷','Divide'],['^','Power'],['%','Percent']]){
   if(gap&&symbol==='%')continue;
   const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.textContent=symbols[symbol];b.title=name;b.setAttribute('aria-label',`${symbols[symbol]} ${name}`);
   b.onclick=()=>{if(gap){if(root.contains(gap.commonAncestorContainer)){caret=gap.cloneRange();insert(' '+symbol+' ');}closeMenu();return;}if(root.contains(chip)){chip.dataset.operator=symbol;chip.textContent=symbols[symbol];chip.setAttribute('aria-label',`Change operator ${symbols[symbol]}`);root.dispatchEvent(new Event('input',{bubbles:true}));}closeMenu(true);};menu.append(b);
  }
  document.body.append(menu);const box=(gap||chip).getBoundingClientRect(),size=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-size.width-8,box.left))+'px';menu.style.top=(box.bottom+size.height+6<innerHeight?box.bottom+4:Math.max(8,box.top-size.height-4))+'px';menu.firstElementChild.focus();
  menu.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMenu(true);}else if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...menu.children],i=buttons.indexOf(document.activeElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(['ArrowDown','ArrowRight'].includes(e.key)?1:-1)+buttons.length)%buttons.length].focus();}};
 };
 const gapAt=(x,y)=>{
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){
   if(node.parentElement.closest('[data-snapshot],[data-operator]'))continue;
   for(const match of node.textContent.matchAll(/[ \t]+/g)){
    const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
    if(![...range.getClientRects()].some(r=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom))continue;
    const before=document.createRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);
    const after=document.createRange();after.selectNodeContents(root);after.setStart(range.endContainer,range.endOffset);
    if(/(?:\$\d+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*$/i.test(serialize(before.cloneContents()))&&/^\s*(?:\$\d+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i.test(serialize(after.cloneContents())))return range;
   }
  }
  return null;
 };
 root.addEventListener('click',e=>{const chip=e.target.closest('[data-operator]');if(chip){e.preventDefault();openMenu(chip);return;}if(e.detail!==1||!getSelection()?.isCollapsed)return;const gap=gapAt(e.clientX,e.clientY);if(gap){e.preventDefault();openMenu(null,gap);}});
 const deleteChip=backward=>{
  remember();if(!caret||!root.contains(caret.commonAncestorContainer))return false;
  let range=caret.cloneRange();
  if(range.collapsed){
   const chips=[...root.querySelectorAll('[data-snapshot],[data-operator]')];if(backward)chips.reverse();
   const chip=chips.find(node=>{
    const edge=document.createRange();edge.selectNode(node);
    if(backward?edge.compareBoundaryPoints(Range.END_TO_END,range)>0:edge.compareBoundaryPoints(Range.START_TO_START,range)<0)return false;
    const gap=range.cloneRange();if(backward)gap.setStartAfter(node);else gap.setEndBefore(node);
    return serialize(gap.cloneContents())==='';
   });
   if(!chip)return false;
   if(backward)range.setStartBefore(chip);else range.setEndAfter(chip);
  }
  range.deleteContents();range.collapse(true);autoOperator=null;closeMenu();
  if(!serialize(root)){root.replaceChildren();range=end();}
  root.focus();place(range);root.dispatchEvent(new Event('input',{bubbles:true}));return true;
 };
 root.addEventListener('keydown',e=>{if(!e.isComposing&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&['Backspace','Delete'].includes(e.key)&&deleteChip(e.key==='Backspace')){e.preventDefault();e.stopImmediatePropagation();return;}if(e.key==='('&&!e.isComposing){remember();if(caret&&!caret.collapsed){e.preventDefault();e.stopImmediatePropagation();wrap();return;}}const chip=e.target.closest('[data-operator]');if(chip&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopImmediatePropagation();openMenu(chip);}},true);
 document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target)&&e.target!==menuChip)closeMenu();},true);
 document.addEventListener('scroll',()=>closeMenu(),true);
 window.addEventListener('resize',()=>closeMenu());
 root.addEventListener('paste',e=>{e.preventDefault();insert(e.clipboardData.getData('text/plain').replace(/[\r\n]+/g,' '));});
 root.addEventListener('beforeinput',e=>{
  if(['deleteContentBackward','deleteContentForward'].includes(e.inputType)&&deleteChip(e.inputType==='deleteContentBackward')){e.preventDefault();return;}
  if(e.inputType==='insertParagraph'||e.inputType==='insertLineBreak')e.preventDefault();
  else if(e.inputType==='insertText'&&!e.isComposing&&e.data!=null){e.preventDefault();remember();if(e.data==='('&&caret&&!caret.collapsed)wrap();else insert(e.data);}
 });
 return {
  get value(){return serialize(root);},set value(text){closeMenu();root.replaceChildren(fragment(text));caret=null;autoOperator=null;},
  setLinkedRefs(refs){linked=new Set((refs||'').match(/\$\d+/g)||[]);for(const chip of root.querySelectorAll('[data-snapshot]'))styleLink(chip);},
  refreshValues(){for(const chip of root.querySelectorAll('[data-snapshot]')){const value=snapshots().find(s=>s.id===chip.dataset.snapshot);if(value)chip.textContent=format(value.value);}},
  focus(){root.focus();place(caret&&root.contains(caret.commonAncestorContainer)?caret:end());},insert,insertValue:text=>insert(text,{value:true}),operator,
  set oninput(fn){root.oninput=fn;},set onkeydown(fn){root.onkeydown=fn;}
 };
}
