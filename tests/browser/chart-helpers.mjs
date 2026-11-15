// Browser mechanics shared by chart tests. Assertions stay with each scenario.
export async function settleChartLayout(page,{canvas=false}={}){
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 // Canvas intentionally waits 250 ms after layout changes before repainting.
 if(canvas)await page.waitForTimeout(400);
}
export async function dragInPlot(page,surface,from,to,{steps=5}={}){
 const box=await surface.boundingBox();if(!box)throw new Error('Chart drag surface is not visible');
 await page.mouse.move(box.x+box.width*from[0],box.y+box.height*from[1]);
 await page.mouse.down();
 await page.mouse.move(box.x+box.width*to[0],box.y+box.height*to[1],{steps});
 await page.mouse.up();
}
export async function resizeCellSection(page,cell,name,delta){
 const handle=cell.getByRole('separator',{name});await handle.scrollIntoViewIfNeeded();
 const box=await handle.boundingBox();if(!box)throw new Error(`Resize handle is not visible: ${name}`);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2+delta,{steps:5});await page.mouse.up();
}
export async function readSavedWork(page,studio){
 const response=await page.request.get(studio.url+'/saved_queries.json');
 if(!response.ok())throw new Error(`Could not read saved work: HTTP ${response.status()}`);
 return response.json();
}
