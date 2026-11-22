import {test,expect,open,edit} from './fixtures.mjs';
test('Option arrows move lines and selections with undo and boundary protection',async({page,studio})=>{
  await open(page,studio.url);await edit(page,'first\nsecond\nthird\nfourth');
  const cm=page.locator('#editorWrap .CodeMirror');
  await cm.evaluate(el=>el.CodeMirror.setCursor({line:1,ch:3}));
  await page.keyboard.press('Alt+ArrowUp');
  expect(await cm.evaluate(el=>el.CodeMirror.getValue())).toBe('second\nfirst\nthird\nfourth');
  expect(await cm.evaluate(el=>el.CodeMirror.getCursor())).toMatchObject({line:0,ch:3});
  await page.keyboard.press('ControlOrMeta+z');
  expect(await cm.evaluate(el=>el.CodeMirror.getValue())).toBe('first\nsecond\nthird\nfourth');
  // A selection ending at column zero excludes that final line.
  await cm.evaluate(el=>el.CodeMirror.setSelection({line:1,ch:0},{line:3,ch:0}));
  await page.keyboard.press('Alt+ArrowUp');
  expect(await cm.evaluate(el=>el.CodeMirror.getValue())).toBe('second\nthird\nfirst\nfourth');
  await page.keyboard.press('Alt+ArrowDown');
  expect(await cm.evaluate(el=>el.CodeMirror.getValue())).toBe('first\nsecond\nthird\nfourth');
  await cm.evaluate(el=>el.CodeMirror.setCursor({line:3,ch:2}));await page.keyboard.press('Alt+ArrowDown');
  expect(await cm.evaluate(el=>el.CodeMirror.getValue())).toBe('first\nsecond\nthird\nfourth');
  await cm.evaluate(el=>el.CodeMirror.setOption('readOnly',true));await page.keyboard.press('Alt+ArrowUp');
  expect(await cm.evaluate(el=>el.CodeMirror.getValue())).toBe('first\nsecond\nthird\nfourth');
});

test('task and notebook editors receive the same line shortcuts',async({page,studio})=>{
  await open(page,studio.url);await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();
  const task=page.locator('.task-pane:visible .CodeMirror');await task.click();await page.keyboard.insertText('first\nsecond');
  await task.evaluate(el=>el.CodeMirror.setCursor({line:1,ch:0}));await page.keyboard.press('Alt+ArrowUp');
  expect(await task.evaluate(el=>el.CodeMirror.getValue())).toBe('second\nfirst');
  await page.getByRole('tab',{name:'Analyses',exact:true}).click();page.once('dialog',d=>d.accept('Line test'));await page.locator('#newNotebook').click();
  const cell=page.locator('#nbCells .CodeMirror').first();await cell.click();await page.keyboard.insertText('first\nsecond');
  await cell.evaluate(el=>el.CodeMirror.setCursor({line:1,ch:0}));await page.keyboard.press('Alt+ArrowUp');
  expect(await cell.evaluate(el=>el.CodeMirror.getValue())).toBe('second\nfirst');
});
