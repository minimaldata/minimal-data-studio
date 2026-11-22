import {setLoading} from './loading.mjs';

// Tests the exact draft that Save would submit; never writes the registry.
export function mountConnectionReviewTest({dialog,form,panel,save,collect,request,onBusy}) {
 const button=document.createElement('button');
 button.type='button';button.textContent='Test connection';
 const status=document.createElement('p');
 status.className='remote-status';status.setAttribute('role','status');
 status.textContent='Not tested';status.dataset.phase='idle';
 panel.append(button,status);

 let currentRun=null,closed=false,tested=null;
 const phases={
  working:'Connecting…',
  credentials:'Check the Mac app for credential approval or an MFA code.',
  mfa_push:'Check your authenticator for a push if prompted. Cached approval may skip it.',
  signing_in:'Complete sign-in in your browser or the Mac app.'
 };
 const show=(phase,text)=>{
  status.dataset.phase=phase;status.textContent=text;
  setLoading(status,!['idle','connected','error'].includes(phase));
 };
 const sync=()=>{button.disabled=closed||Boolean(currentRun)||save.disabled;};
 const observer=new MutationObserver(sync);
 observer.observe(save,{attributes:true,attributeFilter:['disabled']});sync();
 const snapshot=()=>{try{return JSON.stringify(collect());}catch{return null;}};
 const changed=()=>{
  if(tested&&snapshot()!==tested&&!currentRun){
   tested=null;show('idle','Settings changed — test again.');
  }
 };
 const events=['input','change','connection-setup-change'];
 for(const event of events)form.addEventListener(event,changed);

 button.onclick=async()=>{
  if(closed||currentRun||save.disabled)return;
  let connection;
  try{connection=collect();}catch(error){show('error',error.message);return;}
  const original=JSON.stringify(connection);
  const testId=crypto.randomUUID().replaceAll('-','');
  const run={timer:null,polling:false};
  currentRun=run;onBusy(true);sync();show('working',phases.working);
  const active=()=>!closed&&dialog.open&&currentRun===run;
  const finish=(phase,message)=>{
   if(!active())return;
   tested=original;
   if(snapshot()!==original){
    tested=null;show('idle','Settings changed during the test — test again.');
   }else show(phase,message);
  };
  run.timer=setInterval(async()=>{
   if(run.polling||!active())return;
   run.polling=true;
   try{
    const result=await request('connection-draft-test-status',{testId});
    if(active()&&phases[result.phase])show(result.phase,phases[result.phase]);
   }catch{/* The main request reports connection failures. */}
   finally{run.polling=false;}
  },500);
  try{
   const result=await request('connection-draft-test',{testId,connection});
   finish('connected',result.message);
  }catch(error){finish('error',error.message);}
  finally{
   clearInterval(run.timer);
   if(currentRun===run){currentRun=null;if(!closed&&dialog.open){onBusy(false);sync();}}
  }
 };
 dialog.addEventListener('close',()=>{
  closed=true;clearInterval(currentRun?.timer);currentRun=null;observer.disconnect();
  for(const event of events)form.removeEventListener(event,changed);
 },{once:true});
}
