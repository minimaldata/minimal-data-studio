// Follow the public step controls before interacting with a connection field.
export async function connectionField(dialog,label,value){
 const field=dialog.getByLabel(label,{exact:true});
 if(label==='Local Postgres service profile'&&!await field.isVisible()){
  await dialog.getByText('Advanced · service profile',{exact:true}).click();await dialog.getByLabel('Use a local service profile').check();
 }
 const index=await field.evaluate(el=>{const panel=el.closest('.connection-setup > section');return panel?[...panel.parentElement.querySelectorAll(':scope > section')].indexOf(panel):-1;});
 if(index>=0)await dialog.locator('.setup-progress button').nth(index).click();
 await field.fill(value);
}
export async function reviewConnection(dialog){
 const review=dialog.getByRole('button',{name:/^Step \d+: Review$/});if(await review.count())await review.click();
}
