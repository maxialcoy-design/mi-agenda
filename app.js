const KEY='mi_agenda_items_v1';
let items=JSON.parse(localStorage.getItem(KEY)||'[]');
let currentView='today', calendarDate=new Date();

const $=id=>document.getElementById(id);
const iso=d=>{const x=new Date(d);return new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,10)};
const today=iso(new Date());
const PUSH_URL='https://mi-agenda-notificaciones.maxialcoy.workers.dev';
const PUSH_SUB_KEY='mi_agenda_push_subscription_id';
const DEFAULT_REMINDER_MINUTES=120;

function save(){localStorage.setItem(KEY,JSON.stringify(items));render()}

function base64urlToUint8Array(base64url){
  const padded=base64url+'='.repeat((4-(base64url.length%4))%4);
  const binary=atob(padded.replace(/-/g,'+').replace(/_/g,'/'));
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes;
}

async function setupPush(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){
    throw new Error('Este navegador no admite notificaciones push.');
  }
  if(Notification.permission!=='granted'){
    const permission=await Notification.requestPermission();
    if(permission!=='granted') throw new Error('Permiso de notificaciones no concedido.');
  }
  const reg=await navigator.serviceWorker.ready;
  let subscription=await reg.pushManager.getSubscription();
  if(!subscription){
    const r=await fetch(PUSH_URL+'/public-key',{cache:'no-store'});
    if(!r.ok) throw new Error('No se pudo obtener la clave VAPID.');
    const data=await r.json();
    subscription=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:base64urlToUint8Array(data.publicKey)
    });
  }
  const subJson=subscription.toJSON();
  const response=await fetch(PUSH_URL+'/subscribe',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      endpoint:subJson.endpoint,
      expirationTime:subJson.expirationTime||null,
      keys:subJson.keys
    })
  });
  if(!response.ok) throw new Error('No se pudo registrar el móvil en el servidor.');
  const saved=await response.json();
  localStorage.setItem(PUSH_SUB_KEY,String(saved.subscriptionId));
  return saved.subscriptionId;
}

async function scheduleRemoteReminder(x){
  if(!x.reminder||!x.time) return;
  try{
    const subscriptionId=await setupPush();
    const reminderMinutes=Number(x.reminderMinutes ?? DEFAULT_REMINDER_MINUTES);
    const due=new Date(x.date+'T'+x.time+':00').getTime()-reminderMinutes*60000;
    if(!Number.isFinite(due)||due<=Date.now()+5000) return;
    await fetch(PUSH_URL+'/reminder',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        id:x.id,
        subscriptionId:subscriptionId,
        dueAt:due,
        title:x.title,
        itemTime:x.time
      })
    });
  }catch(e){
    console.warn('No se pudo programar el aviso push:',e);
  }
}

async function deleteRemoteReminder(id){
  try{
    await fetch(PUSH_URL+'/reminder?id='+encodeURIComponent(id),{method:'DELETE'});
  }catch(e){}
}

function fmtDate(s){return new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short'}).format(new Date(s+'T12:00:00'))}
function esc(s){return String(s||'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]))}

function render(){
  normalizeFlexibleItems();
  const app=$('app'); $('pageTitle').textContent={today:'Hoy',calendar:'Calendario',tasks:'Agenda',shared:'Ajustes'}[currentView];
  if(currentView==='today') renderToday(app);
  if(currentView==='tasks') renderTasks(app);
  if(currentView==='calendar') renderCalendar(app);
  if(currentView==='shared') renderShared(app);
}
function priorityLabel(p){
  return p==='flexible'?'🟢 Flexible':p==='priority'?'🟠 Prioritaria':p==='urgent'?'🔴 Muy importante':'⚪ Normal';
}
function isFlexible(x){return (x.priority||'normal')==='flexible' && !x.done;}
function getAgendaDate(x){
  if(!isFlexible(x)) return x.date;
  const start=x.flexibleFrom||x.date;
  if(start<today) return today;
  return start;
}
function normalizeFlexibleItems(){
  let changed=false;
  items.forEach(x=>{
    if(isFlexible(x) && x.date!==today){
      if(!x.flexibleFrom) x.flexibleFrom=x.date;
      x.date=today;
      changed=true;
    }
  });
  if(changed) localStorage.setItem(KEY,JSON.stringify(items));
}
normalizeFlexibleItems();
function itemHtml(x, compact=false){
  const time=x.time?` · ${x.time}`:(x.type==='task'&&x.allDay?' · Todo el día':'');
  return `<div class="card ${compact?'upcoming-item ':''}${x.type==='event'?'event ':''}${x.done?'done ':''}priority-${x.priority||'normal'}">
    <div class="item">
      ${x.type==='task'?`<button class="check-btn ${x.done?'done':''}" onclick="toggleItem('${x.id}')" title="${x.done?'Marcar como pendiente':'Marcar como hecha'}">${x.done?'✓':''}</button>`:`<div class="check-btn" style="border-color:#6d5dfc"></div>`}
      <div class="item-main"><div class="item-title">${esc(x.title)}</div><div class="meta">${x.time?'🕐 '+x.time+' · ':''}${x.allDay?'☀️ Todo el día · ':''}${fmtDate(x.date)}${x.priority&&x.priority!=='normal'?` · ${priorityLabel(x.priority)}`:''}${x.done?' · ✓ Hecha':''}</div>${x.notes?`<div class="meta">${esc(x.notes)}</div>`:''}</div>
      <button class="small-btn delete-task" onclick="deleteItem('${x.id}')" title="Eliminar">🗑️</button>
    </div>
  </div>`;
}
function renderToday(app){
  const todays=items.filter(x=>getAgendaDate(x)===today).sort((a,b)=>(a.time||'99').localeCompare(b.time||'99'));
  const upcoming=items.filter(x=>getAgendaDate(x)>today).sort((a,b)=>(a.date+b.time).localeCompare(b.date+a.time)).slice(0,5);
  const dateLabel=new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
  app.innerHTML=`<div class="today-hero">
    <div class="muted">${dateLabel}</div>
    <h2>${todays.length?`Tienes ${todays.length} ${todays.length===1?'cosa':'cosas'} para hoy`:'No tienes nada para hoy 🎉'}</h2>
    <p>${todays.length?'Aquí tienes lo principal de hoy.':'Puedes añadir una tarea o una cita con el botón +.'}</p>
  </div>
  <div class="section-title"><h2>${todays.length?'Lo de hoy':'Tu día'}</h2></div>
  ${todays.length?todays.map(itemHtml).join(''):`<div class="card empty">✨ Día libre. No tienes tareas ni citas.</div>`}
  <div class="section-title"><h2>Próximamente</h2></div>
  ${upcoming.length?upcoming.map(x=>itemHtml(x,true)).join(''):`<div class="card empty">No hay nada programado todavía.</div>`}`;
  setTimeout(()=>showTodayPopup(todays),250);
}
function showTodayPopup(todays){
  if(sessionStorage.getItem('todayPopupShown')===today) return;
  sessionStorage.setItem('todayPopupShown',today);
  const existing=document.getElementById('todayPopup');
  if(existing) existing.remove();
  const box=document.createElement('div');
  box.id='todayPopup';
  box.className='today-popup';
  box.innerHTML=`<div class="popup-card">
    <button class="close popup-close" onclick="document.getElementById('todayPopup').remove()">×</button>
    <div class="popup-icon">${todays.length?'📋':'☀️'}</div>
    <div class="muted">Buenos días</div>
    <h2>${todays.length?`Esto es lo que tienes hoy`:'Hoy no tienes nada pendiente'}</h2>
    ${todays.length?`<div class="popup-list">${todays.map(x=>`<div><b>${x.time?x.time+' · ':''}${esc(x.title)}</b><small>${x.allDay?'Todo el día':(x.time?'Con hora':'Sin hora')}</small></div>`).join('')}</div>`:`<p class="muted">Disfruta del día. Si quieres, puedes añadir algo con el botón +.</p>`}
    <button class="primary" onclick="document.getElementById('todayPopup').remove()">Ver mi día</button>
  </div>`;
  document.body.appendChild(box);
}
function startOfWeek(date){
  const d=new Date(date);
  const day=(d.getDay()+6)%7;
  d.setHours(0,0,0,0);
  d.setDate(d.getDate()-day);
  return d;
}
function endOfWeek(date){
  const d=startOfWeek(date);
  d.setDate(d.getDate()+6);
  return d;
}
function dateKey(d){return iso(d)}
function labelForAgendaDay(date){
  if(date===today) return 'HOY';
  const tomorrow=iso(new Date(Date.now()+86400000));
  if(date===tomorrow) return 'MAÑANA';
  return new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long'}).format(new Date(date+'T12:00:00'));
}
function renderTasks(app){
  const offset=window.agendaWeekOffset||0;
  const base=new Date(); base.setDate(base.getDate()+offset*7);
  const weekStart=startOfWeek(base), weekEnd=endOfWeek(base);
  const startKey=dateKey(weekStart), endKey=dateKey(weekEnd);
  const weekItems=items.filter(x=>getAgendaDate(x)>=startKey&&getAgendaDate(x)<=endKey)
    .sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99')||(a.done-b.done));
  const pending=weekItems.filter(x=>!x.done).length;
  const groups={}; weekItems.forEach(x=>(groups[getAgendaDate(x)] ||= []).push(x));
  const sections=Object.keys(groups).sort().map(date=>`
    <section class="task-day"><div class="task-day-title"><div>${labelForAgendaDay(date)}</div><span>${groups[date].length} ${groups[date].length===1?'elemento':'elementos'}</span></div>
    ${groups[date].map(itemHtml).join('')}</section>`).join('');
  const monthLabel=new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short'}).format(weekStart)+' – '+new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(weekEnd);
  const future=items.filter(x=>getAgendaDate(x)>dateKey(endOfWeek(new Date()))).length;
  app.innerHTML=`<div class="week-switch">
    <button class="small-btn" onclick="changeAgendaWeek(-1)">‹</button>
    <div><h2>${offset===0?'Esta semana':monthLabel}</h2><span class="muted">${monthLabel} · ${pending} pendientes</span></div>
    <button class="small-btn" onclick="changeAgendaWeek(1)">›</button>
  </div>
  ${offset!==0?`<button class="secondary-btn" onclick="agendaWeekOffset=0;render()">↩ Volver a esta semana</button>`:''}
  ${weekItems.length?sections:`<div class="card empty">✨ No tienes nada programado esta semana.</div>`}
  <div class="week-summary card"><b>${future?`Tienes ${future} ${future===1?'elemento':'elementos'} en semanas futuras.`:'No tienes nada programado más adelante.'}</b>${future?`<button class="secondary-btn" onclick="showFutureItems()">Ver futuras →</button>`:''}</div>`;
}
function changeAgendaWeek(n){window.agendaWeekOffset=(window.agendaWeekOffset||0)+n;render()}
function renderCalendar(app){
  const y=calendarDate.getFullYear(),m=calendarDate.getMonth();
  const first=new Date(y,m,1), days=new Date(y,m+1,0).getDate();
  let start=(first.getDay()+6)%7;
  let cells='';
  for(let i=0;i<start;i++) cells+='<div class="day muted-day"></div>';
  for(let d=1;d<=days;d++){
    const ds=iso(new Date(y,m,d)), count=items.filter(x=>getAgendaDate(x)===ds).length;
    cells+=`<div class="day ${ds===today?'today':''}" onclick="calendarDay('${ds}')"><div class="daynum">${d}</div>${count?'<span class="dot"></span>'.repeat(Math.min(count,4)):''}</div>`;
  }
  app.innerHTML=`<div class="calendar-head"><h2>${new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(first)}</h2><div class="month-nav"><button class="small-btn" onclick="changeMonth(-1)">‹</button><button class="small-btn" onclick="changeMonth(1)">›</button></div></div>
  <div class="weekdays">${['L','M','X','J','V','S','D'].map(x=>`<div class="weekday">${x}</div>`).join('')}</div><div class="days">${cells}</div>
  <div id="selectedDay"></div>`;
}
function calendarDay(ds){
  const found=items.filter(x=>getAgendaDate(x)===ds);
  $('selectedDay').innerHTML=`<div class="section-title"><h2>${fmtDate(ds)}</h2></div>${found.length?found.map(itemHtml).join(''):`<div class="card empty">No hay nada para este día.</div>`}`;
}
function changeMonth(n){calendarDate.setMonth(calendarDate.getMonth()+n);render()}
function renderShared(app){
  app.innerHTML=`<div class="share-card"><h2>⚙️ Ajustes</h2>
  <p>Tu agenda es local y tus datos se guardan en este dispositivo.</p>
  <button class="primary" onclick="enableDailyNotifications()">🔔 Activar aviso diario</button>
  <div class="settings-row"><div><b>Hora del aviso</b><div class="muted">Cuándo quieres recibir el resumen</div></div><input class="time-input" id="dailyTime" type="time" value="${localStorage.getItem('dailyTime')||'08:00'}" onchange="saveDailyTime(this.value)"></div>
  <p class="muted" style="margin-top:12px">El aviso diario resume lo que tienes programado para hoy.</p>
  </div>
  <div class="share-card">
    <h3>💾 Copias de seguridad</h3>
    <p class="muted">Guarda una copia completa de tus tareas y citas para poder recuperarlas si cambias de móvil, borras los datos o pasa cualquier cosa.</p>
    <div class="backup-actions">
      <button class="backup-btn" onclick="exportBackup()">⬇️ <b>Guardar copia</b><small>Descargar ahora</small></button>
      <button class="backup-btn" onclick="document.getElementById('backupFile').click()">⬆️ <b>Restablecer copia</b><small>Recuperar calendario</small></button>
    </div>
    <input id="backupFile" type="file" accept=".json,application/json" hidden onchange="importBackup(event)">
    <div class="backup-status" id="backupStatus">Puedes guardar una copia cuando quieras.</div>
  </div>`;
}

function exportBackup(){
  const backup={app:"Mi Agenda",version:2,exportedAt:new Date().toISOString(),items:items};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const stamp=new Intl.DateTimeFormat("es-ES",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()).replace(/\//g,"-");
  a.href=url;
  a.download=`mi-agenda-copia-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const status=document.getElementById("backupStatus");
  if(status) status.textContent="✅ Copia guardada correctamente.";
}
function importBackup(event){
  const file=event.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      if(!data || data.app!=="Mi Agenda" || !Array.isArray(data.items)) throw new Error("Archivo no válido");
      if(!confirm("Esto reemplazará las tareas y citas actuales por las de la copia. ¿Quieres continuar?")) return;
      items=data.items; save(); alert("✅ Copia restaurada correctamente.");
    }catch(e){alert("No se ha podido restaurar la copia. Comprueba que sea un archivo de Mi Agenda.");}
    finally{event.target.value="";}
  };
  reader.readAsText(file);
}


function installReminderControls(){
  const reminder=$('reminder');
  if(!reminder || $('reminderTimeWrap')) return;
  const label=document.createElement('label');
  label.id='reminderTimeWrap';
  label.textContent='Avisarme con antelación';
  const select=document.createElement('select');
  select.id='reminderMinutes';
  [
    ['5','5 minutos antes'],
    ['10','10 minutos antes'],
    ['15','15 minutos antes'],
    ['30','30 minutos antes'],
    ['60','1 hora antes'],
    ['120','2 horas antes'],
    ['1440','1 día antes']
  ].forEach(([value,text])=>{
    const option=document.createElement('option');
    option.value=value;
    option.textContent=text;
    if(value==='120') option.selected=true;
    select.appendChild(option);
  });
  label.appendChild(select);
  reminder.closest('label').insertAdjacentElement('afterend',label);
  const style=document.createElement('style');
  style.textContent=`
    dialog{border:0;outline:0;padding:0;background:transparent;max-width:calc(100vw - 20px);max-height:calc(100dvh - 20px);margin:auto;overflow:hidden}
    #formDialog .dialog-card{width:min(520px,calc(100vw - 20px));max-height:calc(100dvh - 20px);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:18px;border-radius:22px}
    #formDialog .dialog-head{position:sticky;top:-18px;background:white;z-index:3;padding-top:2px;padding-bottom:8px}
    #formDialog #reminderTimeWrap{display:none}
    #formDialog #reminderTimeWrap select{margin-top:6px}
    @media(max-width:480px){
      #formDialog .dialog-card{padding:16px;border-radius:20px}
      #formDialog label{margin:9px 0}
      #formDialog input,#formDialog select,#formDialog textarea{padding:10px}
      #formDialog .primary{margin-top:5px}
    }
  `;
  document.head.appendChild(style);
}


function initTimePicker(){
  const h=$('pickerHour'),m=$('pickerMinute');
  if(!h||!m) return;
  if(!h.options.length){
    for(let i=0;i<24;i++){
      const o=document.createElement('option');
      o.value=String(i).padStart(2,'0'); o.textContent=String(i).padStart(2,'0'); h.appendChild(o);
    }
    for(let i=0;i<60;i++){
      const o=document.createElement('option');
      o.value=String(i).padStart(2,'0'); o.textContent=String(i).padStart(2,'0'); m.appendChild(o);
    }
  }
}
function openTimePicker(){
  initTimePicker();
  const current=$('time').value||'';
  const parts=current.split(':');
  const now=new Date();
  $('pickerHour').value=parts[0]||String(now.getHours()).padStart(2,'0');
  $('pickerMinute').value=parts[1]||String(now.getMinutes()).padStart(2,'0');
  $('timePickerDialog').showModal();
}
function confirmTimePicker(){
  $('time').value=$('pickerHour').value+':'+$('pickerMinute').value;
  $('timePickerDialog').close();
}

function openTaskForm(){addDialog.close();$('formTitle').textContent='Nueva tarea';$('itemType').value='task';openForm();updateFormType()}
function openForm(){
  
const themeStyle=document.createElement('style');
themeStyle.textContent=`
:root{
  --bg:#252923;--surface:#30352d;--surface2:#383d34;--text:#f0f1eb;--muted:#aeb4a7;
  --accent:#65783b;--accent2:#758a45;--border:#4a5144;--danger:#b86a63;--warn:#b28a4a;
}
body{background:var(--bg)!important;color:var(--text)!important}
.topbar{background:rgba(37,41,35,.94)!important}
.eyebrow{color:#aeb4a7}.topbar h1{color:var(--text)}
.icon-btn{background:var(--surface)!important;color:var(--text);box-shadow:0 2px 12px #0005!important;font-size:28px}
.content{color:var(--text)}
.card,.today-hero,.share-card,.popup-card,.dialog-card{background:var(--surface)!important;color:var(--text);box-shadow:0 5px 22px #0005!important}
.card.empty{color:var(--muted)}
.meta,.muted,.popup-list small{color:var(--muted)!important}
.bottom-nav{background:#20241f!important;border-color:#3c4239!important}
.bottom-nav button{color:#9da398}.bottom-nav button.active{color:#9aaa62}
.fab{background:var(--accent)!important;box-shadow:0 8px 24px #0008!important}
.primary{background:var(--accent)!important}
.secondary-btn{background:#3d4734!important;color:#c8d5a9!important}
.small-btn,.close{background:var(--surface2)!important;color:var(--text)}
.day,.weekday{background:var(--surface)!important;color:var(--text)}
.day.today{outline-color:var(--accent)!important}.dot{background:var(--accent)!important}
dialog{background:transparent!important}
input,textarea,select{background:#272c26!important;color:var(--text)!important;border-color:var(--border)!important}
input::placeholder,textarea::placeholder{color:#8f968a}
.choice{background:var(--surface2)!important;color:var(--text)}
#allDayWrap{background:var(--surface2)!important}
.menu-option{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px;margin:7px 0;border-radius:14px;background:var(--surface2);color:var(--text);font-weight:700}
.menu-option span{flex:1}.menu-status{display:flex;align-items:center;gap:12px;padding:12px 0 8px;border-bottom:1px solid var(--border);margin-bottom:8px}
.menu-status>span{font-size:25px}.menu-status small{display:block;color:var(--muted);margin-top:2px}
.menu-btn{line-height:1}.menu-card{max-width:430px}
.priority-flexible{border-left:4px solid #65783b}.priority-priority{border-left:4px solid #b28a4a}.priority-urgent{border-left:4px solid #b86a63}
.katana-cut{position:relative;overflow:hidden}
.katana-blade{position:absolute;top:-25%;left:-22%;font-size:42px;transform:rotate(-18deg);animation:katanaSlash .5s ease-out forwards;pointer-events:none;z-index:20;filter:drop-shadow(0 0 7px #fff)}
@keyframes katanaSlash{0%{left:-25%;opacity:0;transform:rotate(-18deg) scale(.8)}15%{opacity:1}100%{left:105%;opacity:0;transform:rotate(-18deg) scale(1.05)}}
.katana-cut .item-title{text-decoration:line-through;text-decoration-thickness:2px}
@media(max-width:480px){
  dialog{max-width:calc(100vw - 20px)!important;max-height:calc(100dvh - 20px)!important}
  #formDialog .dialog-card,#menuDialog .dialog-card{width:calc(100vw - 20px)!important;max-height:calc(100dvh - 20px)!important;overflow-y:auto}
}
`;
document.head.appendChild(themeStyle);

installReminderControls();
  $('itemForm').reset();
  $('date').value=today;
  $('time').value='';
  $('reminderMinutes').value='120';
  $('formDialog').showModal();
}
function updateFormType(){
  $('endWrap').style.display='none';
  $('allDayWrap').style.display='flex';
  $('repeatWrap').style.display='block';
  $('timeWrap').style.display=$('allDay').checked?'none':'block';
  $('reminderTimeWrap').style.display=$('reminder').checked&&!$('allDay').checked?'block':'none';
}
$('allDay').addEventListener('change',()=>{
  $('timeWrap').style.display=$('allDay').checked?'none':'block';
  if($('allDay').checked)$('time').value='';
  updateFormType();
});
$('reminder').addEventListener('change',()=>updateFormType());
$('itemForm').addEventListener('submit',e=>{
 e.preventDefault();
 const isEvent=false;
 const allDay=$('allDay').checked;
 const x={
   id:crypto.randomUUID(),
   type:'task',
   title:$('title').value.trim(),
   date:$('date').value,
   time:allDay?'':$('time').value,
   endTime:'',
   allDay,
   notes:$('notes').value.trim(),
   reminder:$('reminder').checked,
   reminderMinutes:Number($('reminderMinutes').value||DEFAULT_REMINDER_MINUTES),
   priority:$('priority').value||'normal',
   flexibleFrom:($('priority').value==='flexible'?$('date').value:null),
   done:false
 };
 items.push(x);save();formDialog.close();scheduleRemoteReminder(x);
});
let katanaAudio=null;
function playKatanaSound(){
  try{
    if(!katanaAudio){
      katanaAudio=new Audio('katana.mp3');
      katanaAudio.preload='auto';
    }
    katanaAudio.currentTime=0;
    const promise=katanaAudio.play();
    if(promise&&promise.catch) promise.catch(()=>{});
  }catch(e){}
}
function playKatanaAnimation(id){
  const btn=document.querySelector(`button[onclick="toggleItem('${id}')"]`);
  const card=btn?.closest('.card');
  if(!card) return;
  card.classList.add('katana-cut');
  const blade=document.createElement('div');
  blade.className='katana-blade';
  blade.innerHTML='<span></span>';
  card.appendChild(blade);
  playKatanaSound();
  setTimeout(()=>blade.remove(),560);
  setTimeout(()=>card.classList.remove('katana-cut'),700);
}
function toggleItem(id){
  const x=items.find(i=>i.id===id);
  if(!x) return;
  if(x.done){
    x.done=false;
    save();
    return;
  }
  x.done=true;
  localStorage.setItem(KEY,JSON.stringify(items));
  playKatanaAnimation(id);
  setTimeout(()=>render(),720);
}
function deleteItem(id){
  const x=items.find(i=>i.id===id);
  if(confirm(`¿Eliminar "${x?.title||'este elemento'}"? Esta acción quitará la tarea de tu agenda.`)){
    deleteRemoteReminder(id);
    items=items.filter(x=>x.id!==id);save()
  }
}

function saveDailyTime(value){localStorage.setItem('dailyTime',value)}
function dailyNotificationText(){
  const todayItems=items.filter(x=>getAgendaDate(x)===today).sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));
  if(!todayItems.length) return 'Hoy no tienes nada programado. ☀️';
  const names=todayItems.slice(0,5).map(x=>`${x.time?x.time+' · ':''}${x.title}`).join(' | ');
  return `Hoy tienes ${todayItems.length} ${todayItems.length===1?'cosa':'cosas'}: ${names}`;
}
function checkDailyNotification(){
  if(localStorage.getItem('dailyNotifications')!=='1'||!('Notification' in window)||Notification.permission!=='granted') return;
  const t=localStorage.getItem('dailyTime')||'08:00';
  const now=new Date();
  const key=now.toISOString().slice(0,10);
  if(now.getHours()===Number(t.split(':')[0])&&now.getMinutes()===Number(t.split(':')[1])&&localStorage.getItem('dailySent')!==key){
    new Notification('Mi Agenda', {body:dailyNotificationText()});
    localStorage.setItem('dailySent',key);
  }
}
setInterval(checkDailyNotification,30000);

async function requestNotifications(){
  if(!('Notification' in window)){alert('Este navegador no admite notificaciones.');return}
  try{
    await setupPush();
    localStorage.setItem('dailyNotifications','1');
    localStorage.setItem('dailyTime',localStorage.getItem('dailyTime')||'08:00');
    alert('Notificaciones activadas 🔔');
    updateMenuStatus();
    }catch(e){
    console.error('Error al activar notificaciones:',e);
    alert('Error al activar las notificaciones:\n\n'+(e?.message||String(e))+'\n\nPermiso: '+Notification.permission);
  }
}
function notificationsAreOn(){
  return ('Notification' in window && Notification.permission==='granted' && localStorage.getItem('dailyNotifications')==='1');
}
function updateMenuStatus(){
  const on=notificationsAreOn();
  const icon=$('menuNotificationIcon');
  const text=$('menuNotificationText');
  if(icon) icon.textContent=on?'🔔':'🔕';
  if(text) text.textContent=on?'Activadas':'Desactivadas';
}
async function toggleNotificationsFromMenu(){
  if(notificationsAreOn()){
    if(!confirm('Las notificaciones están activadas. ¿Quieres desactivarlas?')) return;
    localStorage.setItem('dailyNotifications','0');
    alert('Notificaciones desactivadas 🔕');
    updateMenuStatus();
    menuDialog.close();
    return;
  }
  if(!confirm('Las notificaciones están desactivadas. ¿Quieres activarlas?')) return;
  menuDialog.close();
  await requestNotifications();
  updateMenuStatus();
}
function enableDailyNotifications(){addDialog.close();requestNotifications()}
async function checkForUpdates(){
  const button=document.querySelector('#menuDialog .menu-option:last-child');
  if(button) button.disabled=true;
  try{
    if(!('serviceWorker' in navigator)){
      alert('Este navegador no admite actualizaciones automáticas.');
      return;
    }
    const registration=await navigator.serviceWorker.getRegistration();
    if(registration){
      await registration.update();
      if(registration.waiting){
        registration.waiting.postMessage({type:'SKIP_WAITING'});
      }
    }else{
      await navigator.serviceWorker.register('sw.js?update='+Date.now());
    }
    alert('Actualización comprobada. La agenda se recargará ahora.');
    setTimeout(()=>location.reload(),300);
  }catch(e){
    console.error('Error buscando actualizaciones:',e);
    alert('No se ha podido comprobar la actualización. Comprueba tu conexión e inténtalo de nuevo.');
  }finally{
    if(button) button.disabled=false;
  }
}

$('menuBtn').onclick=()=>{updateMenuStatus();menuDialog.showModal()};
$('addBtn').onclick=()=>addDialog.showModal();
document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>{currentView=b.dataset.view;document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');render()});
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?version=5');
installReminderControls();
updateMenuStatus();
render();
