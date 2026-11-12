import {jsonRequest} from './api.mjs';

export function setupTaskSchedule(tab,{getState,refresh,run}) {
  const root=document.createElement('details');root.className='task-settings task-schedule';
  root.innerHTML=`<summary>Schedule <span data-summary></span></summary>
    <p class="task-note">Runs while this project is running in Studio and your Mac is awake. Missed runs are not replayed. Saved code only; run it successfully once before enabling.</p>
    <div class="task-fields"><label>Repeat<select data-kind><option value="interval">Every N minutes</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
    <label data-interval>Minutes<input data-minutes type="number" min="1" max="10080" value="60"></label>
    <label data-calendar>Time<input data-time type="time" value="08:00"></label>
    <label data-weekly>Day<select data-day><option value="0">Monday</option><option value="1">Tuesday</option><option value="2">Wednesday</option><option value="3">Thursday</option><option value="4">Friday</option><option value="5">Saturday</option><option value="6">Sunday</option></select></label>
    <label data-zone>Time zone<input data-timezone placeholder="America/New_York"></label></div>
    <div class="task-actions"><button data-enable>Enable schedule</button><button data-pause>Pause schedule</button><button data-resume>Resume schedule</button><button data-now>Run now</button></div>
    <p data-next role="status"></p><p data-notice role="status"></p><p data-schedule-error role="alert"></p>`;
  tab.pane.querySelector('.task-code').before(root);
  const el=name=>root.querySelector(`[data-${name}]`);let edited=false,busy=false,version=null;
  el('timezone').value=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  function layout(){const kind=el('kind').value;el('interval').hidden=kind!=='interval';el('calendar').hidden=el('zone').hidden=kind==='interval';el('weekly').hidden=kind!=='weekly';}
  for(const input of root.querySelectorAll('input,select'))input.onchange=()=>{edited=true;layout();};
  async function action(action){busy=true;el('schedule-error').textContent='';render();
    try{await jsonRequest('/tasks/schedule',{id:tab.task.id,revision:getState().schedules.revision,action,schedule:{kind:el('kind').value,minutes:Number(el('minutes').value),time:el('time').value,timezone:el('timezone').value,weekday:Number(el('day').value)}});edited=false;await refresh();}
    catch(e){el('schedule-error').textContent=e.message;}finally{busy=false;render();}
  }
  for(const name of ['enable','pause','resume'])el(name).onclick=()=>action(name);
  el('now').onclick=run;
  function render(){
    const item=getState().schedules?.items?.[tab.task?.id];
    if(item&&!edited&&version!==JSON.stringify(item.config)){version=JSON.stringify(item.config);const c=item.config;el('kind').value=c.kind;el('minutes').value=c.minutes||60;el('time').value=c.time||'08:00';el('day').value=c.weekday||0;el('timezone').value=c.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;layout();}
    el('summary').textContent=item?(item.enabled?' · Active':' · Paused'):' · Off';
    el('enable').textContent=item?'Update schedule':'Enable schedule';
    const blocked=busy||tab.busy||tab.loading||!tab.task||tab.dirty;
    el('enable').disabled=el('resume').disabled=blocked;
    el('pause').disabled=busy||!item?.enabled;el('pause').hidden=!item?.enabled;el('resume').hidden=!item||item.enabled;
    el('now').disabled=tab.el('run').disabled;
    el('next').textContent=item?.enabled?`Next run: ${new Date(item.nextRun*1000).toLocaleString(undefined,{timeZone:item.config.timezone})} · ${item.config.timezone||'local time'}`:item?'Schedule paused.':'No schedule set.';
    el('notice').textContent=(item?.notice||'')+(item?.missed?` (${item.missed} missed or skipped events recorded)`:'');
    if(tab.dirty)el('next').textContent+=' Save script changes before configuring a schedule.';
  }
  layout();return {render,get unsaved(){return edited||busy;}};
}
