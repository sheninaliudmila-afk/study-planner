'use strict';
(() => {
const KEY='studyPlanner:v1', TYPES={direction:'directions',subject:'subjects',course:'courses',topic:'topics',session:'sessions',homework:'homeworks'}, TITLES={direction:'Направление',subject:'Предмет',course:'Курс преподавателя',topic:'Тема',session:'Занятие',homework:'Задание'}, NAV=[['learning','Обучение'],['calendar','Календарь'],['homework','Задания'],['archive','Архив'],['settings','Настройки'],['dashboard','Главная'],['goals','Цели'],['analytics','Аналитика']];
const $=s=>document.querySelector(s), el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n}, add=(p,...nodes)=>{nodes.forEach(n=>p.append(n));return p}, uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(36).slice(2)}`, now=()=>new Date().toISOString(), day=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, local=d=>`${day(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`, dateOf=s=>new Date(s), escapeDate=s=>s?.replace('T',' ')||'—';
const initial=()=>{let stamp=now();return {schemaVersion:2,createdAt:stamp,revision:0,directions:['Вайбкодинг','Финансовое моделирование'].map((name,i)=>({id:uid(),name,description:'',color:['#3278b8','#8b65ba'][i],order:i,createdAt:stamp,updatedAt:stamp,archivedAt:null})),subjects:[],courses:[],topics:[],sessions:[],homeworks:[],goals:[],timeEntries:[],recurrences:[],settings:{dashboardOrder:[],calendarView:'week',lastActiveSection:'dashboard',theme:'light',lastExportDate:null},timerState:{status:'idle'}}};
let loadedRaw=null,pendingMigration=false,returnFocus=null;const tabId=uid();let state=null,blocked=false,section='learning',calView='week',anchor=new Date(),draft=null,saveTimer=null,dirty=false,readOnly=false;
const allIds=s=>Object.values(TYPES).flatMap(k=>s[k].map(x=>x.id)).concat((s.goals||[]).map(x=>x.id),(s.timeEntries||[]).map(x=>x.id),(s.recurrences||[]).map(x=>x.id));
// Reject inconsistent input before any write; unknown fields are preserved.
function validDate(value,time=false){
 if(typeof value!=='string'||!(time?/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/:/^\d{4}-\d{2}-\d{2}$/).test(value))return false;
 const d=new Date(value+(time?'':'T12:00'));return Number.isFinite(+d)&&(time?local(d):day(d))===value;
}
function validURL(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)}catch{return false}}
function validateState(s){
 const fail=t=>{throw Error(t)},text=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
 if(!s||s.schemaVersion!==2)fail('Неподдерживаемая версия данных');
 for(const key of [...Object.values(TYPES),'goals','timeEntries','recurrences'])if(!Array.isArray(s[key]))fail('Некорректный список '+key);
 if(!s.settings||typeof s.settings!=='object'||Array.isArray(s.settings)||!Number.isSafeInteger(s.revision)||s.revision<0)fail('Некорректные настройки или ревизия');
 if(!['today','week','month','list'].includes(s.settings.calendarView)||!['light','dark','system'].includes(s.settings.theme))fail('Некорректный вид или тема');
 if(s.settings.expandedNodes!==undefined&&(!s.settings.expandedNodes||typeof s.settings.expandedNodes!=='object'||Array.isArray(s.settings.expandedNodes)||Object.values(s.settings.expandedNodes).some(v=>typeof v!=='boolean')))fail('Некорректное состояние дерева');
 const ids=new Set(),checkId=x=>{if(!x||!text(x.id,1,200)||ids.has(x.id))fail('Некорректный или повторяющийся идентификатор');ids.add(x.id)};
 for(const key of [...Object.values(TYPES),'goals','timeEntries','recurrences'])for(const x of s[key])checkId(x);
 for(const [kind,key] of Object.entries(TYPES))for(const x of s[key]){
  if(!text(x.name??x.title,1,kind==='direction'?100:['subject','course','topic'].includes(kind)?120:160))fail('Некорректное название: '+key);
  for(const field of ['createdAt','updatedAt'])if(typeof x[field]!=='string'||!Number.isFinite(Date.parse(x[field])))fail('Некорректная дата '+field);
  if(x.archivedAt!=null&&!Number.isFinite(Date.parse(x.archivedAt)))fail('Некорректная дата архива');
  for(const [field,max] of [['description',kind==='homework'?10000:2000],['notes',20000],['answer',20000],['teacher',160]])if(x[field]!==undefined&&!text(x[field],0,max))fail('Некорректное поле '+field);
  if(['direction','subject','course','topic'].includes(kind)&&(!Number.isInteger(x.order)||x.order<0))fail('Некорректный порядок');
  if(kind==='direction'&&!['#3278b8','#8b65ba','#238777','#ba7b32'].includes(x.color))fail('Некорректный цвет');
 }
 for(const [key,parent,field] of [['subjects','directions','directionId'],['courses','subjects','subjectId'],['topics','courses','courseId'],['sessions','topics','topicId'],['homeworks','topics','topicId']])for(const x of s[key])if(!s[parent].some(y=>y.id===x[field]))fail('Нарушена связь '+key);
 for(const x of [...s.sessions,...s.homeworks]){
  if(!Array.isArray(x.links))fail('Некорректные ссылки');
  for(const l of x.links){checkId(l);if(!text(l.label,1,160)||!text(l.url,1,2048)||!validURL(l.url))fail('Ссылка должна содержать название и абсолютный URL http(s)')}
 }
 for(const x of s.sessions){
  if(!Number.isFinite(x.actualMinutes)||x.actualMinutes<0)fail('Некорректные фактические минуты.');
  if(!validCivil(x.startLocal)||!Number.isInteger(x.durationMinutes)||x.durationMinutes<5||x.durationMinutes>720||x.durationMinutes%5)fail('Некорректные дата или длительность занятия');
  if(!['lecture','practice','self','webinar'].includes(x.type)||!['planned','completed'].includes(x.status))fail('Некорректный тип или статус занятия');
  if((x.status==='completed')!==!!x.completedAt||(x.completedAt&&!Number.isFinite(Date.parse(x.completedAt))))fail('Статус занятия не соответствует completedAt');
 }
 for(const h of s.homeworks){
  if(h.sessionId&&!s.sessions.some(x=>x.id===h.sessionId&&x.topicId===h.topicId))fail('Некорректная связь задания с занятием');
  if(h.deadlineLocal&&!validDate(h.deadlineLocal))fail('Некорректный дедлайн');
  if(!['low','medium','high'].includes(h.priority)||!Array.isArray(h.steps))fail('Некорректное задание');
  for(const st of h.steps){checkId(st);if(!text(st.title,1,300)||typeof st.done!=='boolean'||!Number.isInteger(st.order)||st.order<0)fail('Некорректный шаг')}
  if(h.progress!==progress(h)||(progress(h)===100)!==!!h.completedAt||(h.completedAt&&!Number.isFinite(Date.parse(h.completedAt))))fail('Прогресс задания не соответствует шагам');
 }
 for(const t of s.timeEntries)if(!s.topics.some(x=>x.id===t.topicId)||(t.sessionId&&!s.sessions.some(x=>x.id===t.sessionId&&x.topicId===t.topicId)))fail('Нарушена связь записи времени');
 for(const r of s.recurrences)if(!s.sessions.some(x=>x.id===r.templateSessionId))fail('Нарушена связь серии');
 for(const g of s.goals)if(g.scopeType!=='all'&&!s[g.scopeType==='direction'?'directions':'courses'].some(x=>x.id===g.scopeId))fail('Нарушена связь цели');
 validateStage2(s);return true;
}
function migrate(input){
 const s=structuredClone(input);
 if(s?.schemaVersion===1){
  if(!Array.isArray(s.directions)||!Array.isArray(s.courses))throw Error('Неверная структура версии 1');
  // Deterministic IDs make the migration pure and repeatable, including retries.
  const occupied=new Set(allIds({...s,subjects:[]}));s.subjects=[];
  for(const d of s.directions){const courses=s.courses.filter(c=>c.directionId===d.id);if(!courses.length)continue;
   let id='migrated-subject-'+d.id;while(occupied.has(id))id+='-';occupied.add(id);
   s.subjects.push({id,directionId:d.id,name:'Без предмета',description:'Курсы из версии 1. Укажите название предмета.',order:0,createdAt:d.createdAt,updatedAt:d.updatedAt,archivedAt:null});
   courses.forEach(c=>{c.subjectId=id;if(c.teacher===undefined)c.teacher=''})
  }
  s.schemaVersion=2;
 }
 validateState(s);return s;
}
function snapshot(raw,reason){if(raw!==null)localStorage.setItem(KEY+':backup:'+reason+':'+uid(),raw)}
function status(t){$('#saveStatus').textContent=t}
function notify(t){$('#notice').replaceChildren(el('div','notice',t));}
function commit(mut){if(blocked||readOnly){notify('Изменения заблокированы: данные изменились в другой вкладке или хранилище недоступно.');return false}try{const current=localStorage.getItem(KEY);if(current!==loadedRaw){blocked=true;notify('Данные изменились в другой вкладке. Перезагрузите страницу.');return false}const next=structuredClone(state);mut(next);next.revision=(state.revision||0)+1;next.lastWriterId=tabId;validateState(next);localStorage.setItem(KEY,JSON.stringify(next));loadedRaw=JSON.stringify(next);state=next;status('Сохранено');return true}catch(e){status('Не удалось сохранить');notify('Не удалось сохранить данные: '+e.message+'. Сохраните резервную копию или освободите место.');return false}}
function load(){
 try{
  loadedRaw=localStorage.getItem(KEY);
  if(loadedRaw!==null){const parsed=JSON.parse(loadedRaw);state=migrate(parsed);if(parsed.schemaVersion===1){pendingMigration=true;readOnly=true;status('Требуется перенос')}}
  else{const next=initial(),raw=JSON.stringify(next);localStorage.setItem(KEY,raw);state=next;loadedRaw=raw;status('Сохранено')}
 }catch(e){readOnly=true;state=initial();status('Не удалось загрузить');notify('Данные не перезаписаны: '+e.message+'. Скачайте исходный JSON или импортируйте корректную копию. Для постоянного хранения откройте приложение в обычном браузере на постоянном адресе.');}
 section=NAV.some(([id])=>id===state.settings?.lastActiveSection)?state.settings.lastActiveSection:'dashboard';calView=state.settings?.calendarView||'week';
}
function finishMigration(){
 try{if(localStorage.getItem(KEY)!==loadedRaw)throw Error('Данные изменились в другой вкладке. Перезагрузите страницу.');
  const next=migrate(JSON.parse(loadedRaw));next.revision++;next.lastWriterId=tabId;validateState(next);snapshot(loadedRaw,'migration');
  if(localStorage.getItem(KEY)!==loadedRaw)throw Error('Данные изменились в другой вкладке.');const raw=JSON.stringify(next);localStorage.setItem(KEY,raw);
  loadedRaw=raw;state=next;pendingMigration=false;readOnly=false;status('Сохранено');notify('Перенос завершён. Старые задания без занятия доступны в списке «Требуют привязки».');render();
 }catch(e){status('Не удалось сохранить');notify('Перенос не выполнен: '+e.message+'. Исходные данные сохранены.');}
}
function renderRecovery(p){
 toolbar(p,pendingMigration?'Перенос данных в новую структуру':'Восстановление данных');
 const card=el('div','card');add(card,el('p','',pendingMigration?'Перед переносом скачайте исходный JSON. Курсы, темы, занятия и задания сохранят свои идентификаторы. Задания без занятия останутся доступны для привязки.':'Редактирование заблокировано. Исходные данные не заменены стартовым набором.'));
 action(card,'Скачать исходный JSON',()=>downloadJSON(loadedRaw??'', 'study-planner-original.json'));
 if(pendingMigration)action(card,'Перенести данные',finishMigration);
 action(card,'Импорт JSON (заменить всё)',()=>$('#importFile').click());p.append(card);
}
const NEXT={direction:'subject',subject:'course',course:'topic',topic:'session',session:'homework'};
const arr=k=>state[TYPES[k]],by=(k,id)=>k==='session'?resolveSession(id):arr(k).find(x=>x.id===id);
function parentType(k,x){return {subject:'direction',course:'subject',topic:'course',session:'topic',homework:x.sessionId?'session':'topic'}[k]}
function parent(k,x){const pk=parentType(k,x),field={subject:'directionId',course:'subjectId',topic:'courseId',session:'topicId',homework:x.sessionId?'sessionId':'topicId'}[k];return pk?by(pk,x[field]):null}
function children(k,id){const nk=NEXT[k],field={direction:'directionId',subject:'subjectId',course:'courseId',topic:'topicId',session:'sessionId'}[k];return nk?arr(nk).filter(x=>x[field]===id&&!(k==='topic'&&x.recurrenceId&&state.recurrences.find(r=>r.id===x.recurrenceId)?.disabled)):[]}
function archived(k,x){return !!x.archivedAt||!!parent(k,x)&&archived(parentType(k,x),parent(k,x))}
function expanded(k,x,content,summary){
 const detail=el('details','tree-node');detail.dataset.kind=k;detail.dataset.id=x.id;
 detail.open=!!state.settings.expandedNodes?.[x.id];const head=el('summary');head.append(summary);detail.append(head,content);
 detail.addEventListener('toggle',()=>{if(readOnly||blocked||detail.open===!!state.settings.expandedNodes?.[x.id])return;const value=detail.open;if(!commit(s=>{s.settings.expandedNodes={...s.settings.expandedNodes,[x.id]:value}}))detail.open=!value});return detail;
}
function revealParents(s,k,x){let pk=parentType(k,x),p=parent(k,x);s.settings.expandedNodes={...s.settings.expandedNodes};while(p){s.settings.expandedNodes[p.id]=true;const next=parent(pk,p);pk=parentType(pk,p);p=next}}
function button(label,cb,cls=''){const b=el('button',cls,label);b.type='button';b.addEventListener('click',cb);return b}
function setSection(v){if(draft?.dirty){confirmAction('Несохранённые изменения','Отменить изменения и перейти в другой раздел?',()=>{closeEditor(true);setSection(v)});return}closeEditor(true);section=v;$('#editor').hidden=true;$('#scrim').hidden=true;document.querySelector('.sidebar').classList.remove('open');render();if(!readOnly)commit(s=>{s.settings.lastActiveSection=v})}
function renderNav(){const n=$('#nav');n.replaceChildren();NAV.forEach(([id,title])=>n.append(button(title,()=>setSection(id),section===id?'active':'')))}
function render(){
 renderNav();$('#pageTitle').textContent=NAV.find(([id])=>id===section)?.[1]||'Обучение';
 const main=$('#main');main.replaceChildren();if(readOnly){renderRecovery(main);return}
 renderTimer();checkReminders();const renderer={dashboard:renderDashboard,learning:renderLearning,calendar:renderCalendar,homework:renderHomeworks,archive:renderArchive,settings:renderSettings}[section];
 if(renderer)renderer(main);else main.append(el('div','empty',section==='dashboard'?'Главная с планированием и таймером появится на шаге 2.':section==='goals'?'Цели появятся на шаге 3.':'Аналитика появится на шаге 3.'));
}
function toolbar(p,title,actions=[]){const t=el('div','toolbar');add(t,el('h2','',title),...actions);p.append(t)}
function action(p,name,fn){p.append(button(name,fn))}
function textDetails(p,x){if(x.description)add(p,el('p','muted prewrap',x.description));if(x.notes)add(p,el('p','prewrap',x.notes));if(x.answer)add(p,el('p','prewrap','Ответ: '+x.answer));if(x.links?.length){const list=el('div','link-list');x.links.forEach(l=>{const a=el('a','',l.label);a.href=l.url;a.target='_blank';a.rel='noopener noreferrer';list.append(a)});p.append(list)}}
function makeTree(k,x){
 const card=el('div','card'),content=el('div'),actions=el('div','tree-actions');textDetails(content,x);if(x.teacher)content.append(el('p','', 'Преподаватель: '+x.teacher));
 action(actions,'Изменить',()=>openEditor(k,x.id));action(actions,'+ '+TITLES[NEXT[k]],()=>openEditor(NEXT[k],null,x.id));
 action(actions,'Выше',()=>move(k,x.id,-1));action(actions,'Ниже',()=>move(k,x.id,1));action(actions,'Архив',()=>archive(k,x.id,true));action(actions,'Удалить',()=>remove(k,x.id));content.append(actions);
 const nested=el('div','nested'),list=children(k,x.id).filter(y=>!archived(NEXT[k],y)).sort((a,b)=>(a.order||0)-(b.order||0));
 list.forEach(y=>nested.append(k==='topic'?(y.recurrenceId?seriesCard(y):entryCard(y,'session')):makeTree(NEXT[k],y)));
 if(!list.length)nested.append(el('p','muted','Пока нет записей.'));content.append(nested);
 card.append(expanded(k,x,content,el('span','node-title',x.name+' · '+list.length)));return card;
}
function renderLearning(p){
 toolbar(p,'Обучение',[button('+ Направление',()=>openEditor('direction'))]);
 const unbound=state.homeworks.filter(x=>!x.sessionId);if(unbound.length)p.append(button('Требуют привязки: '+unbound.length,()=>setSection('homework'),'notice'));
 const active=state.directions.filter(x=>!archived('direction',x)).sort((a,b)=>a.order-b.order);
 if(!active.length)p.append(el('div','empty','Нет активных направлений. Создайте первое.'));active.forEach(x=>p.append(makeTree('direction',x)));
}
function progress(h){return h.steps.length?Math.round(100*h.steps.filter(s=>s.done).length/h.steps.length):0}
function overdue(x){return !!x.deadlineLocal&&x.deadlineLocal<day(new Date())&&progress(x)<100}
function entryCard(x,k){
 const d=el('div','entry'+(k==='homework'&&overdue(x)?' overdue':''));d.dataset.kind=k;d.dataset.id=x.id;
 const info=el('div','entry-info'),actions=el('div','action-strip');
 info.append(el('p','muted tiny',k==='session'?`${{lecture:'Лекция',practice:'Практика',self:'Самостоятельно',webinar:'Вебинар'}[x.type]} · ${escapeDate(x.startLocal)} · ${x.durationMinutes} мин · ${x.status==='completed'?'Пройдено':'Запланировано'}`:`Срок: ${x.deadlineLocal||'без срока'} · ${progress(x)}% · ${{low:'Низкий',medium:'Средний',high:'Высокий'}[x.priority]}${overdue(x)?' · Просрочено':''}`));
 if(k==='homework'&&!x.sessionId)info.append(el('p','notice','Требует привязки к занятию. Исходное задание сохранено.'));
 textDetails(info,x);action(actions,'Открыть',()=>openEditor(k,x.id));
 if(k==='session'){
  action(actions,x.status==='completed'?'Вернуть в план':'Завершить',()=>toggleSession(x.id));action(actions,'Старт таймера',()=>startTimer(x));if((x._civil||civilInfo(x.startLocal)).label)info.append(el('p','notice',(x._civil||civilInfo(x.startLocal)).label));
  action(actions,'+ Задание',()=>addHomeworkForSession(x.id));
  const tasks=el('div','session-homeworks');children('session',x.id).forEach(h=>tasks.append(entryCard(h,'homework')));
  if(!tasks.childNodes.length)tasks.append(el('p','muted','У этого занятия пока нет заданий.'));info.append(tasks);
 }else if(x.steps.length){
  const list=el('div','step-list');x.steps.forEach(st=>{const label=el('label','stepline'),cb=el('input');cb.type='checkbox';cb.checked=st.done;cb.addEventListener('change',()=>{if(!toggleStep(x.id,st.id))cb.checked=st.done});add(label,cb,el('span','',st.title));list.append(label)});info.append(list);
 }else action(actions,'Добавить первый шаг',()=>openEditor(k,x.id));
 action(actions,'Удалить',()=>remove(k,x.id));info.append(actions);
 if(k==='session')d.append(expanded(k,x,info,el('strong','',x.title+' · заданий: '+children(k,x.id).length)));
 else add(d,el('strong','',x.title),info);return d;
}
function renderHomeworks(p){
 toolbar(p,'Домашние задания',[button('+ Задание',()=>openEditor('homework'))]);
 const unbound=state.homeworks.filter(x=>!x.sessionId),list=state.homeworks.filter(x=>x.sessionId&&!archived('homework',x)).sort((a,b)=>(a.deadlineLocal||'9999').localeCompare(b.deadlineLocal||'9999'));
 function show(x,target){const c=el('div','card');c.append(el('p','muted tiny',breadcrumb(x.topicId)+(x.sessionId?' / '+by('session',x.sessionId).title:'')),entryCard(x,'homework'));target.append(c)}
 if(unbound.length){const box=el('section','unbound');box.append(el('h2','','Требуют привязки'),el('p','','Старые задания сохранены без случайного выбора занятия. Их можно редактировать и экспортировать.'));unbound.forEach(x=>show(x,box));p.append(box)}
 if(!list.length)p.append(el('div','empty','Нет активных заданий с привязкой к занятию.'));list.forEach(x=>show(x,p));
}
function breadcrumb(topicId){const t=by('topic',topicId),c=t&&by('course',t.courseId),sub=c&&by('subject',c.subjectId),d=sub&&by('direction',sub.directionId);return [d?.name,sub?.name,c?.name,t?.name].filter(Boolean).join(' / ')}
function renderArchive(p){
 toolbar(p,'Архив');let count=0;for(const k of ['direction','subject','course','topic'])arr(k).filter(x=>x.archivedAt).forEach(x=>{
  count++;const c=el('div','card');c.dataset.id=x.id;c.dataset.kind=k;
  add(c,el('strong','',TITLES[k]+': '+x.name),button('Восстановить',()=>archive(k,x.id,false)),button('Удалить',()=>remove(k,x.id)));const pr=parent(k,x);if(pr&&archived(parentType(k,x),pr))c.append(el('p','muted','Родитель тоже в архиве. Для появления в обучении восстановите его.'));p.append(c)
 });if(!count)p.append(el('div','empty','Архив пуст.'));
}
function move(k,id,delta){const x=by(k,id),p=parent(k,x),siblings=arr(k).filter(y=>(p?parent(k,y)?.id===p.id:!parent(k,y))&&!archived(k,y)).sort((a,b)=>(a.order||0)-(b.order||0));const i=siblings.findIndex(y=>y.id===id),j=i+delta;if(j<0||j>=siblings.length)return;const ids=siblings.map(y=>y.id);[ids[i],ids[j]]=[ids[j],ids[i]];if(commit(s=>ids.forEach((id,index)=>{s[TYPES[k]].find(y=>y.id===id).order=index})))render()}
function archive(k,id,value){if(commit(s=>{const x=s[TYPES[k]].find(y=>y.id===id);x.archivedAt=value?now():null;x.updatedAt=now()}))render()}
function descendants(s,k,id,acc){
 if(!s[TYPES[k]].some(x=>x.id===id))return;acc.add(id);
 const next=NEXT[k],field={direction:'directionId',subject:'subjectId',course:'courseId',topic:'topicId',session:'sessionId'}[k];
 if(next)s[TYPES[next]].filter(x=>x[field]===id).forEach(x=>descendants(s,next,x.id,acc));
 if(k==='topic')s.homeworks.filter(x=>x.topicId===id&&!x.sessionId).forEach(x=>acc.add(x.id));
}
function confirmAction(title,msg,fn){const dlg=$('#confirmDialog');$('#confirmTitle').textContent=title;$('#confirmText').textContent=msg;dlg.oncancel=e=>{e.preventDefault();cancel()};dlg.showModal();const yes=$('#confirmYes'),no=$('#confirmCancel');const clean=()=>{yes.removeEventListener('click',accept);no.removeEventListener('click',cancel);dlg.close()},accept=()=>{clean();fn()},cancel=()=>clean();yes.addEventListener('click',accept);no.addEventListener('click',cancel)}
function remove(k,id){
 if(k==='session'&&resolveSession(id)?._virtual){removeOccurrence(id);return}
 const ids=new Set();descendants(state,k,id,ids);
 const dependencies=state.timeEntries.filter(x=>ids.has(x.topicId)||ids.has(x.sessionId)).length;
 confirmAction('Удаление',`Удалить записей: ${ids.size}, включая вложенные задания; записей времени: ${dependencies}? Перед удалением будет сохранена копия JSON в этом браузере.`,()=>{
  if(commit(s=>{snapshot(loadedRaw,'delete');Object.values(TYPES).forEach(key=>{s[key]=s[key].filter(x=>!ids.has(x.id))});s.timeEntries=s.timeEntries.filter(x=>!ids.has(x.topicId)&&!ids.has(x.sessionId));s.recurrences=s.recurrences.filter(x=>!ids.has(x.templateSessionId));s.goals=s.goals.filter(x=>!ids.has(x.scopeId));if(ids.has(s.timerState?.sessionId)||ids.has(s.timerState?.topicId))s.timerState={status:'idle'};}))render();
 });
}
function toggleStep(id,stepId){const ok=commit(s=>{const h=s.homeworks.find(x=>x.id===id),before=progress(h),st=h.steps.find(x=>x.id===stepId);st.done=!st.done;const after=progress(h);if(after===100&&before<100)h.completedAt=now();if(after<100)h.completedAt=null;h.progress=after;h.updatedAt=now()});if(ok)render();return ok}
function options(select,items,selected){items.forEach(([v,label])=>{const o=el('option','',label);o.value=v;if(v===selected)o.selected=true;select.append(o)})}
function field(container,key,label,type='text',value='',max=0){const wrap=el('label','field');wrap.append(el('span','',label));const inp=el(type==='textarea'?'textarea':type==='select'?'select':'input');if(type!=='textarea'&&type!=='select')inp.type=type;if(max)inp.maxLength=max;if(label.includes('*'))inp.required=true;if(type!=='select')inp.value=value??'';inp.name=key;wrap.append(inp);container.append(wrap);return inp}
function choice(container,key,label,values,selected){const input=field(container,key,label,'select');options(input,values,selected);return input}
function linksEditor(container,links){const box=el('div','field'),title=el('span','','Ссылки на материалы');box.append(title);const list=el('div');box.append(list);const appendLink=(l={label:'',url:''})=>{const line=el('div','linkline'),label=el('input'),url=el('input');line.dataset.linkId=l.id||uid();label.setAttribute('aria-label','Название ссылки');url.setAttribute('aria-label','URL ссылки');label.placeholder='Название';label.value=l.label;label.maxLength=160;url.placeholder='https://...';url.value=l.url;url.maxLength=2048;label.className='link-label';url.className='link-url';add(line,label,url,button('✕',()=>{line.remove();changed()}));list.append(line);line.querySelectorAll('input').forEach(i=>i.addEventListener('input',changed))};links.forEach(appendLink);box.append(button('+ Ссылка',()=>{appendLink();changed()}));container.append(box);return()=>[...list.children].map(line=>({id:line.dataset.linkId||uid(),label:line.querySelector('.link-label').value.trim(),url:line.querySelector('.link-url').value.trim()})).filter(x=>x.label||x.url)}
function stepsEditor(container,steps){const box=el('div','field');box.append(el('span','','Шаги задания'));const list=el('div');box.append(list);const appendStep=(s={title:'',done:false})=>{const line=el('div','stepline'),check=el('input'),name=el('input');line.dataset.stepId=s.id||uid();check.type='checkbox';check.checked=s.done;name.type='text';name.value=s.title;name.setAttribute('aria-label','Название шага');check.setAttribute('aria-label','Шаг выполнен');name.placeholder='Описание шага';name.maxLength=300;name.className='step-title';check.className='step-done';add(line,check,name,button('✕',()=>{line.remove();changed()}));list.append(line);[check,name].forEach(i=>i.addEventListener('input',changed))};steps.forEach(appendStep);box.append(button('+ Шаг',()=>{appendStep();changed()}));container.append(box);return()=>[...list.children].map((line,i)=>({id:steps[i]?.id||uid(),title:line.querySelector('.step-title').value.trim(),done:line.querySelector('.step-done').checked,order:i}))}
function openEditor(k,id=null,parentId=null,slot=null,sessionId=null){clearTimeout(saveTimer);if(draft?.dirty){confirmAction('Несохранённые изменения','Отменить изменения и открыть другую запись?',()=>{draft=null;openEditor(k,id,parentId,slot,sessionId)});return}if(readOnly||blocked){notify('Редактирование недоступно.');return}const existing=id?by(k,id):null;if(existing&&archived(k,existing)&&k!=='homework'){notify('Сначала восстановите запись и её родителей из архива.');return}draft={k,id,original:existing?JSON.stringify(existing):null,dirty:false};const root=$('#editorFields');root.replaceChildren();$('#editorTitle').textContent=(id?'Изменить: ':'Создать: ')+TITLES[k];$('#editorErrors').textContent='';const x=existing||{};let controls={};const f=(key,label,type='text',v='',max=0)=>controls[key]=field(root,key,label,type,x[key]??v,max);const c=(key,label,vals,defaultValue)=>controls[key]=choice(root,key,label,vals,x[key]??defaultValue);
if(k==='direction'){f('name','Название *', 'text','',100);f('description','Описание','textarea','',2000);c('color','Цвет',[['#3278b8','Синий'],['#8b65ba','Фиолетовый'],['#238777','Бирюзовый'],['#ba7b32','Оранжевый']], '#3278b8')}
if(k==='subject'||k==='course'||k==='topic'){const parentKey=k==='subject'?'direction':k==='course'?'subject':'course',parentField=k==='subject'?'directionId':k==='course'?'subjectId':'courseId';const opts=arr(parentKey).filter(y=>!archived(parentKey,y)).map(y=>[y.id,y.name]);c(parentField,TITLES[parentKey]+' *',opts,x[parentField]||parentId||opts[0]?.[0]);f('name','Название *','text','',120);f('description','Описание','textarea','',2000)}
if(k==='session'||k==='homework'){
 if(k==='session'){
  const opts=state.topics.filter(y=>!archived('topic',y)).map(y=>[y.id,breadcrumb(y.id)]);c('topicId','Тема *',opts,x.topicId||parentId||opts[0]?.[0]);
 }else{
  const sessions=state.sessions.filter(y=>!y.recurrenceId&&(!archived('session',y)||y.id===x.sessionId));
  c('sessionId','Занятие *',[['','Выберите занятие']].concat(sessions.map(y=>[y.id,breadcrumb(y.topicId)+' / '+y.title])),x.sessionId||sessionId||'');
  if(id&&!x.sessionId)root.append(el('p','notice','Это старое задание без занятия. Можно сохранить изменения без привязки или выбрать занятие.'));
 }
 f('title','Название *','text','',160);
 if(k==='session'){
  c('type','Тип занятия',[['lecture','Лекция'],['practice','Практика'],['self','Самостоятельно'],['webinar','Вебинар']],'lecture');
  f('startLocal','Начало *','datetime-local',slot||local(new Date()));f('durationMinutes','Длительность (минуты) *','number',60);controls.durationMinutes.min=5;controls.durationMinutes.max=720;controls.durationMinutes.step=5;
  c('status','Статус',[['planned','Запланировано'],['completed','Пройдено']],'planned');f('notes','Конспект','textarea','',20000);
 }else{
  f('description','Задание','textarea','',10000);f('deadlineLocal','Дедлайн','date','');c('priority','Приоритет',[['low','Низкий'],['medium','Средний'],['high','Высокий']],'medium');f('answer','Ответ','textarea','',20000);f('notes','Заметки','textarea','',20000);
 }
}
if(k==='session'){addRecurrenceFields(root,x);if(x.startLocal&&civilInfo(x.startLocal).label)root.append(el('p','notice',civilInfo(x.startLocal).label))}if(k==='session'&&x._virtual){root.append(button('Изменить всю серию',()=>openEditor('session',state.recurrences.find(r=>r.id===x.recurrenceId).templateSessionId)),button('Отменить это вхождение',()=>removeOccurrence(id)))}if(k==='session'&&id){const tasks=state.homeworks.filter(h=>h.sessionId===id);root.append(el('h3','','Задания занятия'));tasks.forEach(h=>root.append(button(h.title+' · '+progress(h)+'%',()=>openEditor('homework',h.id))));root.append(button('+ Задание',()=>addHomeworkForSession(id)))}if(k==='course')f('teacher','Преподаватель','text','',160);if(k==='session'||k==='homework')controls.links=linksEditor(root,x.links||[]);if(k==='homework')controls.steps=stepsEditor(root,x.steps||[]);
const missing=root.querySelector('select[name=directionId],select[name=subjectId],select[name=courseId],select[name=topicId],select[name=sessionId]');if(missing&&!missing.value){const pk={directionId:'direction',subjectId:'subject',courseId:'course',topicId:'topic',sessionId:'session'}[missing.name];if(![...missing.options].some(o=>o.value)){root.append(el('p','notice','Сначала создайте родительскую запись: '+TITLES[pk]),button('Создать: '+TITLES[pk],()=>openEditor(pk)))}}draft.savedValues=JSON.stringify(getValues());$('#editor').hidden=false;$('#scrim').hidden=false;returnFocus=document.activeElement;document.querySelector('.workspace').inert=true;document.querySelector('.sidebar').inert=true;root.querySelector('input,select,textarea')?.focus();root.querySelectorAll('input,textarea,select').forEach(n=>{n.addEventListener('input',changed);n.addEventListener('change',changed)});}
function changed(){if(!draft)return;if(JSON.stringify(getValues())===draft.savedValues){draft.dirty=false;dirty=false;clearTimeout(saveTimer);status(draft.id?'Сохранено':'Новая запись');return}draft.dirty=true;dirty=true;status('Изменения');clearTimeout(saveTimer);if(draft.id)saveTimer=setTimeout(()=>saveEditor(true),550)}
function getValues(){const values={};for(const [k,v] of Object.entries(Object.fromEntries([...$('#editorFields').querySelectorAll('[name]')].map(n=>[n.name,n]))))values[k]=v.value.trim();if(draft.k==='session'||draft.k==='homework'){values.links=[...$('#editorFields').querySelectorAll('.linkline')].map(line=>({id:line.dataset.linkId||uid(),label:line.querySelector('.link-label').value.trim(),url:line.querySelector('.link-url').value.trim()})).filter(l=>l.label||l.url)}if(draft.k==='homework'){values.steps=[...$('#editorFields').querySelectorAll('.stepline')].map((line,i)=>({id:line.dataset.stepId||uid(),title:line.querySelector('.step-title').value.trim(),done:line.querySelector('.step-done').checked,order:i}))}if(draft.k==='session'){values.repeatMode=values.repeatMode||'none';values.repeatWeekdays=[...$('#editorFields').querySelectorAll('.weekday-choice:checked')].map(x=>Number(x.value))}return values}
function validateForm(k,v){const errors=[];const name=v.name??v.title,max={direction:100,subject:120,course:120,topic:120,session:160,homework:160}[k];if(!name||name.length>max)errors.push('Название: от 1 до '+max+' символов.');for(const [field,maxLen] of [['description',k==='homework'?10000:2000],['notes',20000],['answer',20000]])if(v[field]?.length>maxLen)errors.push(field+': превышена допустимая длина.');if(k==='session'){const m=Number(v.durationMinutes);if(!Number.isInteger(m)||m<5||m>720||m%5)errors.push('Длительность: от 5 до 720 минут, кратно 5.');if(!validDate(v.startLocal,true))errors.push('Укажите корректные дату и время.')}if(k==='homework'){if(!v.sessionId&&!(draft.id&&!by('homework',draft.id)?.sessionId))errors.push('Выберите занятие для задания.');if(v.sessionId&&!state.sessions.some(z=>z.id===v.sessionId))errors.push('Выбранное занятие не найдено.');if(v.deadlineLocal&&!validDate(v.deadlineLocal))errors.push('Неверный дедлайн.');if(v.steps.some(s=>!s.title||s.title.length>300))errors.push('Каждый шаг должен иметь название до 300 символов.')}const field={subject:'directionId',course:'subjectId',topic:'courseId',session:'topicId'}[k],pk={subject:'direction',course:'subject',topic:'course',session:'topic'}[k];if(field&&(!by(pk,v[field])||archived(pk,by(pk,v[field]))))errors.push('Выберите активную родительскую запись.');if(k==='homework'&&v.sessionId&&by('session',v.sessionId)&&archived('session',by('session',v.sessionId))&&v.sessionId!==by('homework',draft.id)?.sessionId)errors.push('Нельзя создать задание в архивном занятии.');for(const l of v.links||[]){try{const u=new URL(l.url);if(!['http:','https:'].includes(u.protocol)||!l.label||l.label.length>160||l.url.length>2048)throw Error()}catch{errors.push('Ссылка: укажите название и абсолютный URL http(s).')}}if(k==='session'){const error=recurrenceFormError(v);if(error)errors.push(error)}return errors}
function saveEditor(auto=false){
 if(!draft)return false;const {k,id}=draft,rawValues=getValues(),errors=validateForm(k,rawValues);
 if(errors.length){$('#editorErrors').textContent=errors.join('\n');status('Изменения');return false}
 $('#editorErrors').textContent='';const oldRecord=id?by(k,id):null;if(id&&!oldRecord){notify('Запись больше недоступна. Закройте редактор.');return false}
 if(k==='session'&&oldRecord?._virtual)return saveVirtualEditor(rawValues,auto);
 const seriesAction=k==='session'&&(oldRecord?.recurrenceId||rawValues.repeatMode!=='none');
 if(seriesAction&&auto){status('Изменения серии — нажмите Сохранить');return false}
 if(seriesAction&&oldRecord&&!draft.seriesConfirmed){confirmAction('Изменить серию','Будущие виртуальные изменения будут сброшены. Прошедшие занятия, задания и время сохранятся. Текущее разовое занятие при создании серии останется отдельной записью. Продолжить?',()=>{if(draft){draft.seriesConfirmed=true;saveEditor(false)}});return false}
 status('Сохранение…');let resultingId=id;const v=stripRepeatFields(rawValues);
 const ok=commit(s=>{
  const list=s[TYPES[k]],old=id?list.find(x=>x.id===id):null,stamp=now();
  if(k==='homework'){const linked=s.sessions.find(x=>x.id===v.sessionId);v.topicId=linked?.topicId||old?.topicId}
  if(k==='session'&&old?.recurrenceId){snapshot(loadedRaw,'series-edit');applySeriesChange(s,old,rawValues);if(rawValues.repeatMode==='none'){resultingId=old.id;return}}
  const converting=k==='session'&&old&&!old.recurrenceId&&rawValues.repeatMode!=='none';
  const obj={...old,...v,id:converting?uid():id||uid(),createdAt:converting?stamp:old?.createdAt||stamp,updatedAt:stamp,archivedAt:old?.archivedAt||null};resultingId=obj.id;
  if(['direction','subject','course','topic'].includes(k))obj.order=old?.order??list.filter(y=>k==='direction'||(k==='subject'?y.directionId===v.directionId:k==='course'?y.subjectId===v.subjectId:y.courseId===v.courseId)).length;
  if(k==='session'){
   obj.durationMinutes=Number(v.durationMinutes);obj.completedAt=v.status==='completed'?(old?.completedAt||stamp):null;obj.actualMinutes=converting?0:old?.actualMinutes||0;obj.recurrenceId=old?.recurrenceId||null;obj.occurrenceKey=converting?null:old?.occurrenceKey||null;obj.exceptionOf=converting?null:old?.exceptionOf||null;
   if(rawValues.repeatMode!=='none'){
    obj.status='planned';obj.completedAt=null;
    if(!old?.recurrenceId){const rid=uid(),rule=recurrenceFromValues(rawValues,rid,obj.id);obj.recurrenceId=rid;s.recurrences.push(rule);
     if(converting){obj.links=obj.links.map(l=>({...l,id:uid()}));if(old.startLocal.slice(10)===obj.startLocal.slice(10)&&ruleDates(obj,rule,old.startLocal.slice(0,10),old.startLocal.slice(0,10)).length){old.occurrenceKey=rid+'|'+old.startLocal;old.exceptionOf=rid;rule.excludedKeys.push(old.occurrenceKey)}}
    }
   }
  }
  if(k==='homework'){obj.sessionId=v.sessionId||null;obj.progress=progress(obj);obj.completedAt=obj.progress===100?(old?.completedAt||stamp):null}
  if(old&&!converting)Object.assign(old,obj);else list.push(obj);
  if(k==='session'&&!converting){s.homeworks.filter(h=>h.sessionId===obj.id).forEach(h=>{h.topicId=obj.topicId});s.timeEntries.filter(t=>t.sessionId===obj.id).forEach(t=>{t.topicId=obj.topicId});if(s.timerState.sessionId===obj.id)s.timerState.topicId=obj.topicId}
  if(!old||converting)revealParents(s,k,obj);
 });
 if(ok){draft.id=resultingId;draft.dirty=false;draft.savedValues=JSON.stringify(getValues());dirty=false;render();if(!auto)closeEditor(true)}return ok;
}
function closeEditor(force=false){if(!force&&draft?.dirty){confirmAction('Несохранённые изменения','Закрыть редактор и отменить несохранённые изменения?',()=>closeEditor(true));return}clearTimeout(saveTimer);draft=null;dirty=false;$('#editor').hidden=true;$('#scrim').hidden=true;document.querySelector('.workspace').inert=false;document.querySelector('.sidebar').inert=false;if(returnFocus?.isConnected)returnFocus.focus();else $('#addGlobal').focus()}
function datesInView(){const base=new Date(anchor);base.setHours(0,0,0,0);if(calView==='today')return [base];if(calView==='week'){const monday=new Date(base);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);return Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return d})}if(calView==='month'){const first=new Date(base.getFullYear(),base.getMonth(),1),start=new Date(first);start.setDate(1-(first.getDay()+6)%7);const count=Math.ceil(((new Date(base.getFullYear(),base.getMonth()+1,0).getDate())+(first.getDay()+6)%7)/7)*7;return Array.from({length:count},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d})}return Array.from({length:30},(_,i)=>{const d=new Date(base);d.setDate(d.getDate()+i);return d})}
function eventsFor(d){const start=new Date(d);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);return sessionsInRange(start,end).sort((a,b)=>a.startLocal.localeCompare(b.startLocal))}
function deadlineNodes(d){const box=el('div','deadlines');state.homeworks.filter(x=>!archived('homework',x)&&x.deadlineLocal===day(d)).forEach(x=>box.append(button('Срок: '+x.title,()=>openEditor('homework',x.id),'cal-event'+(overdue(x)?' overdue':''))));return box}
function calendarDay(d){const cell=el('div','cal-day'+(day(d)===day(new Date())?' today':''));cell.dataset.date=day(d);cell.append(button(d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'})+' +',()=>openEditor('session',null,null,day(d)+'T09:00'),'slot'));const events=eventsFor(d),list=el('div');const show=(items)=>items.forEach(x=>list.append(button((!civilInfo(x.startLocal).valid?'⚠ ':civilInfo(x.startLocal).ambiguous?'↺ ':'')+(day(dateOf(x.startLocal))<day(d)?'Продолжение':x.startLocal.slice(11))+' '+x.title,()=>openEditor('session',x.id),'cal-event')));show(calView==='month'?events.slice(0,3):events);if(calView==='month'&&events.length>3){const more=button('Ещё '+(events.length-3),()=>{show(events.slice(3));more.remove()});list.append(more)}cell.append(list,deadlineNodes(d));return cell}
function renderCalendar(p){const t=el('div','calendar-head');for(const v of [['today','Сегодня'],['week','Неделя'],['month','Месяц'],['list','Список']])t.append(button(v[1],()=>{calView=v[0];commit(s=>{s.settings.calendarView=calView});render()},v[0]===calView?'primary':''));t.append(button('←',()=>shift(-1)));t.append(button('К текущей дате',()=>{anchor=new Date();render()}));t.append(button('→',()=>shift(1)));t.append(button('+ Занятие',()=>openEditor('session')));p.append(t);const dates=datesInView();p.append(el('p','section-caption',dates[0].toLocaleDateString('ru-RU')+' — '+dates.at(-1).toLocaleDateString('ru-RU')));if(calView==='list'){dates.forEach(d=>{const ev=eventsFor(d),deadlines=deadlineNodes(d);if(!ev.length&&!deadlines.childNodes.length)return;p.append(el('h3','cal-list-date',d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'long'})));ev.forEach(x=>p.append(entryCard(x,'session')));p.append(deadlines)});return}if(calView==='today'){const card=el('div','card');card.append(el('h3','',dates[0].toLocaleDateString('ru-RU')),deadlineNodes(dates[0]));for(let hour=0;hour<24;hour++){const row=el('div','hour-grid');row.append(el('div','hour-label',String(hour).padStart(2,'0')+':00'));const content=el('div','hour-cell');const slot=day(dates[0])+'T'+String(hour).padStart(2,'0')+':00';content.append(button('+',()=>openEditor('session',null,null,slot),'slot'));eventsFor(dates[0]).filter(x=>Math.max(0,day(dateOf(x.startLocal))<day(dates[0])?0:dateOf(x.startLocal).getHours())===hour).forEach(x=>content.append(button(x.title,()=>openEditor('session',x.id),'cal-event')));row.append(content);card.append(row)}p.append(card);return}const wrap=el('div','cal-wrap'),grid=el('div','cal-grid');dates.forEach(d=>grid.append(calendarDay(d)));wrap.append(grid);p.append(wrap)}
function shift(n){if(calView==='today')anchor.setDate(anchor.getDate()+n);else if(calView==='week')anchor.setDate(anchor.getDate()+7*n);else if(calView==='month'){const wanted=anchor.getDate();anchor.setDate(1);anchor.setMonth(anchor.getMonth()+n);anchor.setDate(Math.min(wanted,new Date(anchor.getFullYear(),anchor.getMonth()+1,0).getDate()))}else anchor.setDate(anchor.getDate()+30*n);render()}
function downloadJSON(json,filename){const blob=new Blob([json],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportData(){try{
 if(readOnly){downloadJSON(loadedRaw??'','study-planner-original.json');return}
 const copy=structuredClone(state);copy.exportedAt=now();copy.timerState={status:'idle'};downloadJSON(JSON.stringify(copy,null,2),'study-planner-'+day(new Date())+'.json');
 commit(s=>{s.settings.lastExportDate=copy.exportedAt});notify('Скачивание резервной копии запущено. Проверьте сохранение файла в браузере.');
 }catch(e){notify('Ошибка экспорта: '+e.message)}
}
async function importData(file){if(!file)return;if(file.size>5*1024*1024){notify('Файл импорта превышает 5 МБ.');return}try{if(draft?.dirty)throw Error('Сначала сохраните или отмените изменения в редакторе');if(state.timerState?.status&&state.timerState.status!=='idle')throw Error('Сначала завершите или отмените таймер');const parsed=JSON.parse(await file.text()),imported=migrate({...parsed,timerState:{status:'idle'}});confirmAction('Восстановить данные',Object.entries(TYPES).map(([k,key])=>TITLES[k]+': '+imported[key].length).join('; ')+'. '+(parsed.schemaVersion===1?'Версия 1 будет перенесена в версию 2. ':'')+'Текущие данные будут заменены. Продолжить?',()=>{try{const next=structuredClone(imported);next.revision=(state.revision||0)+1;next.timerState={status:'idle'};next.lastWriterId=tabId;validateState(next);const currentRaw=localStorage.getItem(KEY);if(currentRaw!==loadedRaw)throw Error('Данные изменились в другой вкладке. Перезагрузите страницу.');if(currentRaw!==null){snapshot(currentRaw,'import')}const latestRaw=localStorage.getItem(KEY);if(latestRaw!==currentRaw)throw Error('Данные изменились в другой вкладке. Импорт остановлен.');localStorage.setItem(KEY,JSON.stringify(next));loadedRaw=JSON.stringify(next);state=next;blocked=false;readOnly=false;pendingMigration=false;status('Сохранено');notify('Импорт выполнен. Предыдущие данные сохранены в резервной копии этого браузера.');render()}catch(e){status('Не удалось сохранить');notify('Импорт не выполнен: '+e.message)}})}catch(e){notify('Файл повреждён или несовместим: '+e.message)}}
function renderSettings(p){toolbar(p,'Резервные копии');const c=el('div','card');add(c,el('h3','','Данные в браузере'),el('p','muted','Версия схемы: '+state.schemaVersion+'. Данные относятся к этому браузеру и адресу. Экспортируйте резервную копию перед очисткой данных браузера. Файлы прикрепляются только внешними ссылками.'));action(c,'Экспорт JSON',exportData);action(c,'Импорт JSON (заменить всё)',()=>$('#importFile').click());const backups=el('div','card');backups.append(el('h3','','Сохранённые копии перед изменениями'));try{Object.keys(localStorage).filter(k=>k.startsWith(KEY+':backup:')||k===KEY+':beforeImport').forEach(k=>action(backups,k,()=>{const blob=new Blob([localStorage.getItem(k)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=k.replaceAll(':','-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}))}catch{}p.append(c,backups)}
// Stage 2: civil-date recurrence rules, lazy occurrences, timer and dashboard.
const WIDGETS=[['today','Сегодня'],['deadlines','Дедлайны'],['progress','Прогресс'],['week','Неделя'],['goals','Цели'],['quick','Быстро добавить']];
let scheduleCache=new Map(),cacheRevision=-1,lastReminderCheck=0,reminderDay='',reminders=[],seenReminders=new Set();
const civilDayIndex=value=>{const [y,m,d]=value.slice(0,10).split('-').map(Number);return Date.UTC(y,m-1,d)/86400000};
function addCivilDays(value,count){const d=new Date(value.slice(0,10)+'T12:00');d.setDate(d.getDate()+count);return day(d)}
function civilInfo(value){
 const date=new Date(value),valid=Number.isFinite(+date)&&local(date)===value;
 // ECMAScript chooses the earlier instant in a repeated local hour.
 const ambiguous=valid&&[15,30,60,90,120,180].some(minutes=>local(new Date(+date+minutes*60000))===value);
 return {date,valid,ambiguous,label:!valid?'Время недоступно из-за перевода часов — перенесите занятие.':ambiguous?'Повторяющийся час: выбрано более раннее мгновение.':''};
}
function validCivil(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)&&validDate(value.slice(0,10))&&Number(value.slice(11,13))<24&&Number(value.slice(14))<60}
function ruleDates(template,rule,fromDate,toDate){
 const first=template.startLocal.slice(0,10),start=fromDate>first?fromDate:first,end=toDate<rule.untilDate?toDate:rule.untilDate,result=[];
 const firstOrdinal=civilDayIndex(first),firstWeek=firstOrdinal-((new Date(first+'T12:00').getDay()+6)%7);
 for(let date=start;date<=end;date=addCivilDays(date,1)){
  const ordinal=civilDayIndex(date),isoDay=(new Date(date+'T12:00').getDay()+6)%7+1;
  if(rule.frequency==='daily'?(ordinal-firstOrdinal)%rule.interval===0:Math.floor((ordinal-firstWeek)/7)%rule.interval===0&&rule.weekdays.includes(isoDay))result.push(date);
 }
 return result;
}
function validateRule(template,rule){
 if(!['daily','weekly'].includes(rule.frequency)||!Number.isInteger(rule.interval)||rule.interval<1||rule.interval>52)throw Error('Интервал повторения: целое число от 1 до 52.');
 if(!validDate(rule.untilDate)||rule.untilDate<template.startLocal.slice(0,10)||civilDayIndex(rule.untilDate)-civilDayIndex(template.startLocal)>730)throw Error('Укажите окончание серии: от даты начала до 730 дней включительно.');
 if(!Array.isArray(rule.weekdays)||new Set(rule.weekdays).size!==rule.weekdays.length||rule.weekdays.some(x=>!Number.isInteger(x)||x<1||x>7)||rule.frequency==='weekly'&&!rule.weekdays.length||rule.frequency==='daily'&&rule.weekdays.length)throw Error('Выберите дни недели (понедельник — 1, воскресенье — 7).');
 if(ruleDates(template,rule,template.startLocal.slice(0,10),rule.untilDate).length>1000)throw Error('В серии допускается не более 1000 вхождений.');
 if(rule.excludedKeys!==undefined&&(!Array.isArray(rule.excludedKeys)||rule.excludedKeys.some(k=>typeof k!=='string')||new Set(rule.excludedKeys).size!==rule.excludedKeys.length))throw Error('Некорректные исключения серии.');
 if(rule.overrides!==undefined&&(!rule.overrides||typeof rule.overrides!=='object'||Array.isArray(rule.overrides)||Object.keys(rule.overrides).length>1000))throw Error('Некорректные изменения серии.');
 if(rule.effectiveFromLocal!==undefined&&!validCivil(rule.effectiveFromLocal))throw Error('Некорректная граница изменения серии.');
}
function virtualOccurrence(s,rule,original){
 const template=s.sessions.find(x=>x.id===rule.templateSessionId);if(!template||rule.disabled)return null;
 const key=rule.id+'|'+original;
 if((rule.excludedKeys||[]).includes(key)||s.sessions.some(x=>x.occurrenceKey===key))return null;
 const override=rule.overrides?.[original]||{};
 if(override.cancelled)return null;
 const item={...template,startLocal:original,...override,id:'occurrence:'+key,recurrenceId:rule.id,occurrenceKey:key,originalStartLocal:original,_virtual:true};
 if(rule.effectiveFromLocal&&item.startLocal<rule.effectiveFromLocal)return null;
 return {...item,_civil: civilInfo(item.startLocal)};
}
function generateOccurrences(s,fromDate,toDate){
 const result=[];
 for(const rule of s.recurrences){
  const template=s.sessions.find(x=>x.id===rule.templateSessionId);if(!template||rule.disabled)continue;
  const starts=new Set(ruleDates(template,rule,fromDate,toDate).map(date=>date+template.startLocal.slice(10)));
  // Moved occurrences can enter this range from an entirely different week.
  Object.keys(rule.overrides||{}).forEach(start=>starts.add(start));
  for(const original of starts){const item=virtualOccurrence(s,rule,original);if(item&&item.startLocal.slice(0,10)>=fromDate&&item.startLocal.slice(0,10)<=toDate)result.push(item)}
 }
 return result.sort((a,b)=>a.startLocal.localeCompare(b.startLocal)||a.id.localeCompare(b.id));
}
function resolveSession(id){
 const stored=state.sessions.find(x=>x.id===id);if(stored)return stored;
 if(typeof id!=='string'||!id.startsWith('occurrence:'))return null;
 const key=id.slice(11),split=key.indexOf('|'),rule=state.recurrences.find(x=>x.id===key.slice(0,split));if(!rule)return null;
 const original=key.slice(split+1),template=state.sessions.find(x=>x.id===rule.templateSessionId);
 if(!validCivil(original)||!ruleDates(template,rule,original.slice(0,10),original.slice(0,10)).includes(original.slice(0,10))||original.slice(10)!==template.startLocal.slice(10))return null;
 return virtualOccurrence(state,rule,original);
}
function sessionsInRange(from,to){
 if(cacheRevision!==state.revision){scheduleCache.clear();cacheRevision=state.revision}
 const fromDate=addCivilDays(day(from),-1),toDate=day(to),key=fromDate+'|'+toDate;
 if(!scheduleCache.has(key)){
  const result=state.sessions.filter(x=>!x.recurrenceId).concat(generateOccurrences(state,fromDate,toDate));
  scheduleCache.set(key,result);if(scheduleCache.size>40)scheduleCache.delete(scheduleCache.keys().next().value);
 }
 return scheduleCache.get(key).filter(x=>!archived('session',x)&&intersectsSession(x,from,to));
}
function intersectsSession(x,from,to){const info=x._civil||civilInfo(x.startLocal);if(!info.valid)return x.startLocal.slice(0,10)>=day(from)&&x.startLocal.slice(0,10)<day(to);return +info.date<+to&&+info.date+x.durationMinutes*60000>+from}
function materialize(s,item){
 const existing=s.sessions.find(x=>x.id===item.id||item.occurrenceKey&&x.occurrenceKey===item.occurrenceKey);if(existing&&!existing.recurrenceId)return existing;
 if(!item._virtual)throw Error('Выберите отдельное занятие серии.');
 const rule=s.recurrences.find(x=>x.id===item.recurrenceId);if(!rule)throw Error('Серия не найдена.');
 const copy={...structuredClone(item),id:uid(),recurrenceId:null,exceptionOf:rule.id,links:(item.links||[]).map(l=>({...l,id:uid()})),createdAt:now(),updatedAt:now()};
 delete copy._virtual;delete copy._civil;delete copy.originalStartLocal;
 rule.excludedKeys=[...new Set([...(rule.excludedKeys||[]),item.occurrenceKey])];
 if(rule.overrides)delete rule.overrides[item.originalStartLocal];s.sessions.push(copy);return copy;
}
function validateStage2(s){
 const keys=new Set();for(const x of s.sessions){if(x.occurrenceKey){if(keys.has(x.occurrenceKey))throw Error('Повторяющийся ключ вхождения.');keys.add(x.occurrenceKey)}if(x.recurrenceId&&!s.recurrences.some(r=>r.id===x.recurrenceId&&r.templateSessionId===x.id))throw Error('Нарушена связь шаблона серии.');}
 for(const rule of s.recurrences){
  const template=s.sessions.find(x=>x.id===rule.templateSessionId);if(!template||template.recurrenceId!==rule.id||template.status!=='planned'||template.completedAt||template.occurrenceKey)throw Error('Некорректный шаблон серии.');if(rule.disabled!==undefined&&typeof rule.disabled!=='boolean')throw Error('Некорректное состояние серии.');if(!Number.isFinite(Date.parse(rule.createdAt)))throw Error('Некорректная дата создания серии.');validateRule(template,rule);
  for(const [original,override] of Object.entries(rule.overrides||{})){
   if(!validCivil(original)||!ruleDates(template,rule,original.slice(0,10),original.slice(0,10)).length||original.slice(10)!==template.startLocal.slice(10)||!override||typeof override!=='object'||Array.isArray(override))throw Error('Некорректный ключ изменения серии.');
   const allowed=['title','topicId','type','startLocal','durationMinutes','notes','links','status','completedAt','cancelled'];if(Object.keys(override).some(k=>!allowed.includes(k)))throw Error('Недопустимое поле изменения серии.');
   const item={...template,...override};if(!validCivil(item.startLocal)||!Number.isInteger(item.durationMinutes)||item.durationMinutes<5||item.durationMinutes>720||item.durationMinutes%5||typeof item.title!=='string'||!item.title.trim()||item.title.length>160||!s.topics.some(t=>t.id===item.topicId)||!['lecture','practice','self','webinar'].includes(item.type)||!['planned','completed'].includes(item.status))throw Error('Некорректные поля изменения серии.');
   if(typeof item.notes!=='string'||item.notes.length>20000||!Array.isArray(item.links)||item.links.some(l=>!l||typeof l.label!=='string'||!l.label.trim()||l.label.length>160||typeof l.url!=='string'||l.url.length>2048||!validURL(l.url)))throw Error('Некорректные материалы изменения серии.');
   if((item.status==='completed')!==!!item.completedAt||item.completedAt&&!Number.isFinite(Date.parse(item.completedAt))||override.cancelled!==undefined&&typeof override.cancelled!=='boolean')throw Error('Некорректный статус изменения серии.');
  }
 }
 for(const h of s.homeworks)if(h.sessionId&&s.sessions.find(x=>x.id===h.sessionId)?.recurrenceId)throw Error('Задание должно относиться к отдельному занятию, не шаблону.');
 for(const entry of s.timeEntries){
  if(entry.sessionId&&s.sessions.find(x=>x.id===entry.sessionId)?.recurrenceId)throw Error('Время должно относиться к отдельному занятию.');
  if(!Number.isInteger(entry.durationSeconds)||entry.durationSeconds<1||entry.durationSeconds>Math.round((Date.parse(entry.endedAt)-Date.parse(entry.startedAt))/1000)||!Number.isFinite(Date.parse(entry.startedAt))||!Number.isFinite(Date.parse(entry.endedAt))||Date.parse(entry.endedAt)<Date.parse(entry.startedAt)||entry.source!=='timer')throw Error('Некорректная запись фактического времени.');
  if(entry.segments!==undefined){validateSegments(entry.segments);if(Math.round(segmentSeconds(entry.segments))!==entry.durationSeconds)throw Error('Сегменты не соответствуют длительности.');if(entry.segments.some(seg=>Date.parse(seg.startAt)<Date.parse(entry.startedAt)||Date.parse(seg.endAt)>Date.parse(entry.endedAt)))throw Error('Сегмент вне интервала записи.');}
 }
 const timer=s.timerState;if(!timer||!['idle','running','paused'].includes(timer.status))throw Error('Некорректное состояние таймера.');
 if(timer.status!=='idle'){
  if(!s.topics.some(t=>t.id===timer.topicId)||timer.sessionId&&!s.sessions.some(x=>x.id===timer.sessionId&&x.topicId===timer.topicId&&!x.recurrenceId))throw Error('Некорректная привязка таймера.');
  if(!Number.isFinite(Date.parse(timer.startedAt))||!Number.isFinite(timer.accumulatedSeconds)||timer.accumulatedSeconds<0||timer.status==='running'&&!Number.isFinite(Date.parse(timer.segmentStartedAt))||timer.status==='paused'&&timer.segmentStartedAt!==null)throw Error('Некорректные временные метки таймера.');
  validateSegments(timer.segments||[]);if((timer.segments||[]).some(seg=>Date.parse(seg.startAt)<Date.parse(timer.startedAt))||timer.status==='running'&&Date.parse(timer.segmentStartedAt)<Date.parse(timer.startedAt))throw Error('Сегмент начинается раньше таймера.');if(Math.abs(segmentSeconds(timer.segments||[])-timer.accumulatedSeconds)>0.001)throw Error('Накопленное время не соответствует сегментам.');
  if(timer.status==='running'&&timer.segments?.length&&Date.parse(timer.segmentStartedAt)<Date.parse(timer.segments.at(-1).endAt))throw Error('Активный сегмент пересекается с сохранённым.');
 }
 if(s.settings.dashboardOrder!==undefined&&(!Array.isArray(s.settings.dashboardOrder)||s.settings.dashboardOrder.some(id=>!WIDGETS.some(([key])=>key===id))||new Set(s.settings.dashboardOrder).size!==s.settings.dashboardOrder.length))throw Error('Некорректный порядок блоков главной.');
}
function validateSegments(segments){if(!Array.isArray(segments))throw Error('Некорректные сегменты времени.');let previous=-Infinity;for(const seg of segments){const start=Date.parse(seg.startAt),end=Date.parse(seg.endAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||start<previous)throw Error('Некорректные или пересекающиеся сегменты времени.');previous=end}}
function segmentSeconds(segments){return segments.reduce((total,x)=>total+(Date.parse(x.endAt)-Date.parse(x.startAt))/1000,0)}
function addRecurrenceFields(root,x){
 const rule=x.recurrenceId?state.recurrences.find(r=>r.id===x.recurrenceId):null;
 if(x._virtual){root.append(el('p','notice','Изменения относятся только к этому занятию серии.'));return}
 const mode=choice(root,'repeatMode','Повторять',[['none','Не повторять'],['daily','Каждый день'],['weekly','По дням недели'],['days','Каждые N дней'],['weeks','Каждые N недель']],rule?(rule.interval===1?rule.frequency:rule.frequency==='daily'?'days':'weeks'):'none');
 const extra=el('div','recurrence-fields'),interval=field(extra,'repeatInterval','Интервал *','number',rule?.interval||1);interval.min=1;interval.max=52;interval.step=1;
 const until=field(extra,'repeatUntil','До даты включительно *','date',rule?.untilDate||'');
 const weekdays=el('fieldset','weekdays');weekdays.append(el('legend','','Дни недели *'));
 ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach((label,index)=>{const lab=el('label'),check=el('input');check.type='checkbox';check.value=String(index+1);check.className='weekday-choice';check.checked=!!rule?.weekdays.includes(index+1);add(lab,check,el('span','',label));weekdays.append(lab)});extra.append(weekdays);root.append(extra);
 const sync=()=>{extra.hidden=mode.value==='none';interval.closest('label').hidden=!['days','weeks'].includes(mode.value);weekdays.hidden=!['weekly','weeks'].includes(mode.value);until.required=mode.value!=='none';if(['daily','weekly'].includes(mode.value))interval.value='1'};mode.addEventListener('change',sync);sync();
 if(rule)root.append(el('p','notice','Изменение серии требует подтверждения. Прошедшие занятия и отдельные записи с заданиями/временем сохранятся; будущие изменения виртуальных вхождений будут сброшены.'));
}
function recurrenceFromValues(v,id,templateId){return {id,templateSessionId:templateId,frequency:['weekly','weeks'].includes(v.repeatMode)?'weekly':'daily',interval:['daily','weekly'].includes(v.repeatMode)?1:Number(v.repeatInterval),weekdays:['weekly','weeks'].includes(v.repeatMode)?(v.repeatWeekdays||[]):[],untilDate:v.repeatUntil,overrides:{},excludedKeys:[],createdAt:now()}}
function recurrenceFormError(v){if(v.repeatMode&&v.repeatMode!=='none'){try{validateRule({startLocal:v.startLocal},recurrenceFromValues(v,'check','check'))}catch(e){return e.message}}return null}
function stripRepeatFields(values){const v={...values};delete v.repeatMode;delete v.repeatInterval;delete v.repeatUntil;delete v.repeatWeekdays;return v}
function saveVirtualEditor(v,auto){
 const item=resolveSession(draft.id);if(!item){notify('Вхождение больше недоступно.');return false}
 const values=stripRepeatFields(v);values.durationMinutes=Number(v.durationMinutes);values.completedAt=v.status==='completed'?(item.completedAt||now()):null;
 const ok=commit(s=>{const rule=s.recurrences.find(r=>r.id===item.recurrenceId);const override={};for(const key of ['title','topicId','type','startLocal','durationMinutes','notes','links','status','completedAt'])override[key]=values[key];rule.overrides={...rule.overrides,[item.originalStartLocal]:override};if(v.status==='completed'){const completed=virtualOccurrence(s,rule,item.originalStartLocal);materialize(s,completed)}});
 if(ok){if(v.status==='completed')draft.id=state.sessions.find(x=>x.occurrenceKey===item.occurrenceKey).id;draft.dirty=false;draft.savedValues=JSON.stringify(getValues());dirty=false;render();if(!auto)closeEditor(true);else if(v.status==='completed')openEditor('session',draft.id)}return ok;
}
function preserveSeriesHistory(s,rule){
 const today=day(new Date()),past=generateOccurrences({...s,recurrences:[rule]},s.sessions.find(x=>x.id===rule.templateSessionId).startLocal.slice(0,10),today).filter(x=>x.recurrenceId===rule.id&&(x.startLocal<local(new Date())||x.status==='completed'));
 for(const item of past)materialize(s,item)
 // A completed override outside the current date range also remains history.
 for(const original of Object.keys(rule.overrides||{})){const item=virtualOccurrence(s,rule,original);if(item?.status==='completed')materialize(s,item)}
}
function applySeriesChange(s,old,v){
 const rule=s.recurrences.find(r=>r.id===old.recurrenceId);preserveSeriesHistory(s,rule);
 if(v.repeatMode==='none'){rule.disabled=true;old.recurrenceId=rule.id;return}
 const next=recurrenceFromValues(v,rule.id,old.id);next.createdAt=rule.createdAt;next.excludedKeys=(rule.excludedKeys||[]).filter(key=>s.sessions.some(x=>x.occurrenceKey===key)||key.split('|')[1]<local(new Date()));next.effectiveFromLocal=local(new Date());Object.assign(rule,next);
}
function toggleSession(id){
 const item=resolveSession(id);if(!item)return;
 if(!civilInfo(item.startLocal).valid){notify('Сначала перенесите занятие на доступное локальное время.');return}
 if(commit(s=>{const target=item._virtual?materialize(s,item):s.sessions.find(x=>x.id===id);target.status=target.status==='completed'?'planned':'completed';target.completedAt=target.status==='completed'?now():null;target.updatedAt=now()}))render();
}
function addHomeworkForSession(id){if(draft?.dirty){notify('Сначала сохраните черновик.');return}const item=resolveSession(id);if(!item)return;let selected=id;if(item._virtual){if(!commit(s=>{selected=materialize(s,item).id}))return}openEditor('homework',null,null,null,selected)}
function removeOccurrence(id){const item=resolveSession(id);if(!item)return;confirmAction('Отменить одно занятие','Отменить только это вхождение? Остальные занятия серии не изменятся.',()=>{if(commit(s=>{snapshot(loadedRaw,'occurrence');const rule=s.recurrences.find(r=>r.id===item.recurrenceId);rule.excludedKeys=[...new Set([...(rule.excludedKeys||[]),item.occurrenceKey])]})){if(draft?.id===id)closeEditor(true);render()}})}
function stopSeries(id){const rule=state.recurrences.find(r=>r.id===id);if(!rule)return;confirmAction('Удалить будущие занятия серии','Будущие виртуальные занятия будут отменены. Прошедшие занятия, отдельные задания и записи времени сохранятся.',()=>{if(commit(s=>{snapshot(loadedRaw,'series');const r=s.recurrences.find(x=>x.id===id);preserveSeriesHistory(s,r);r.disabled=true;}))render()})}
function seriesCard(template){
 const rule=state.recurrences.find(r=>r.id===template.recurrenceId),card=el('div','card series-card');card.dataset.seriesId=rule.id;
 add(card,el('strong','',template.title),el('p','muted',`${rule.frequency==='daily'?'Каждые '+rule.interval+' дн.':'Каждые '+rule.interval+' нед.'} · до ${rule.untilDate}`),button('Изменить серию',()=>openEditor('session',template.id)),button('Удалить серию',()=>stopSeries(rule.id)));
 const from=new Date();from.setHours(0,0,0,0);const to=new Date(from);to.setDate(to.getDate()+6);
 const instances=generateOccurrences(state,day(from),day(to)).filter(x=>x.recurrenceId===rule.id).slice(0,7);
 instances.forEach(x=>card.append(entryCard(x,'session')));if(!instances.length)card.append(el('p','muted','Нет вхождений в ближайшие 7 дней. Другие даты доступны в календаре.'));return card;
}
function timerElapsed(t,at=Date.now()){return (t.accumulatedSeconds||0)+(t.status==='running'?Math.max(0,(at-Date.parse(t.segmentStartedAt))/1000):0)}
function timerNeedsConfirmation(t){return !!t.requiresConfirmation||t.status==='running'&&Date.now()-Math.max(Date.parse(t.segmentStartedAt),Date.parse(t.confirmedAt)||0)>12*3600000}
function closeTimerSegment(t){if(t.status==='running'){const end=now();if(Date.parse(end)<Date.parse(t.segmentStartedAt))throw Error('Часы устройства переведены назад. Проверьте время и отмените интервал.');t.segments=[...(t.segments||[]),{startAt:t.segmentStartedAt,endAt:end}];t.accumulatedSeconds=segmentSeconds(t.segments);t.segmentStartedAt=null}}
async function timerMutation(mut){
 const operation=()=>{if(blocked||readOnly){let external;try{external=JSON.parse(localStorage.getItem(KEY))}catch{}notify(external?.timerState?.status!=='idle'?'Таймер уже работает в другой вкладке. Перезагрузите страницу.':'Изменения заблокированы. Перезагрузите страницу.');return false}const ok=commit(mut);if(ok){renderTimer();if(section==='dashboard')render();}return ok};
 return navigator.locks?.request?navigator.locks.request('studyPlanner:timer',operation):operation();
}
async function startTimer(item=null,topicId=null){
 if(draft?.dirty){notify('Сначала сохраните или отмените черновик.');return}
 if(item?.recurrenceId&&!item._virtual){notify('Выберите отдельное вхождение серии.');return}
 if(item&&!civilInfo(item.startLocal).valid){notify('Сначала перенесите занятие на доступное время.');return}
 return timerMutation(s=>{if(s.timerState.status!=='idle')throw Error('Таймер уже работает. Завершите или отмените его.');let session=item;if(item?._virtual)session=materialize(s,item);const topic=session?.topicId||topicId;if(!s.topics.some(x=>x.id===topic)||archived('topic',by('topic',topic)))throw Error('Выберите активную тему.');s.timerState={id:uid(),status:'running',ownerTabId:tabId,topicId:topic,sessionId:session?.id||null,startedAt:now(),segmentStartedAt:now(),accumulatedSeconds:0,segments:[],lastObservedAt:now()};});
}
async function timerAction(action){
 if(action==='cancel'){confirmAction('Отменить таймер','Сбросить таймер без записи фактического времени?',()=>timerMutation(s=>{s.timerState={status:'idle'}}));return}
 if(['finish','resume'].includes(action)&&timerNeedsConfirmation(state.timerState)){renderTimer();notify('Интервал свыше 12 часов: сначала подтвердите время либо отмените интервал.');return}
 let saved=false;const ok=await timerMutation(s=>{
  const t=s.timerState;if(t.status==='idle')throw Error('Активного таймера нет.');
  if(action==='confirm'){t.requiresConfirmation=false;t.confirmedAt=now();return}
  if(action==='pause'){if(t.status!=='running')throw Error('Таймер уже на паузе.');const warning=timerNeedsConfirmation(t);closeTimerSegment(t);t.status='paused';t.requiresConfirmation=warning}
  if(action==='resume'){if(t.status!=='paused')throw Error('Таймер уже работает.');t.status='running';t.segmentStartedAt=now()}
  if(action==='finish'){
   closeTimerSegment(t);const elapsed=segmentSeconds(t.segments||[]),seconds=elapsed>=1?Math.round(elapsed):0;
   if(seconds>=1){s.timeEntries.push({id:uid(),topicId:t.topicId,sessionId:t.sessionId,startedAt:t.startedAt,endedAt:now(),durationSeconds:seconds,source:'timer',segments:t.segments});saved=true;const session=s.sessions.find(x=>x.id===t.sessionId);if(session)session.actualMinutes=s.timeEntries.filter(x=>x.sessionId===session.id).reduce((total,x)=>total+x.durationSeconds,0)/60}
   s.timerState={status:'idle'};
  }else t.lastObservedAt=now();
 });if(ok&&action==='finish')notify(saved?'Фактическое время сохранено.':'Менее 1 секунды: запись времени не создана.');
}
function formatElapsed(seconds){const total=Math.max(0,Math.floor(seconds));return String(Math.floor(total/3600)).padStart(2,'0')+':'+String(Math.floor(total/60)%60).padStart(2,'0')+':'+String(total%60).padStart(2,'0')}
function renderTimer(){
 const root=$('#timerPanel');if(!root)return;root.replaceChildren();if(readOnly){root.hidden=true;return}root.hidden=false;
 const t=state.timerState,details=el('details','timer-panel');details.open=t.status!=='idle';const summary=el('summary');summary.append(el('strong','',t.status==='idle'?'Таймер':'Таймер · '+(t.status==='paused'?'Пауза':'Работает')));details.append(summary);
 const content=el('div','timer-content');
 if(t.status==='idle'){
  const topics=state.topics.filter(x=>!archived('topic',x)),topic=choice(content,'timerTopic','Тема *',topics.map(x=>[x.id,breadcrumb(x.id)]),topics[0]?.id),session=choice(content,'timerSession','Занятие (необязательно)',[],'');
  const fill=()=>{session.replaceChildren();options(session,[['','Без занятия']].concat(state.sessions.filter(x=>x.topicId===topic.value&&!x.recurrenceId&&!archived('session',x)).map(x=>[x.id,x.title])),'')};topic.addEventListener('change',fill);fill();const start=button('Старт',()=>startTimer(session.value?by('session',session.value):null,topic.value),'primary');start.disabled=!topics.length;content.append(start);if(!topics.length)content.append(el('p','muted','Создайте тему в разделе «Обучение».'));
 }else{
  content.append(el('p','',breadcrumb(t.topicId)+(t.sessionId?' / '+by('session',t.sessionId)?.title:'')),el('output','timer-elapsed',formatElapsed(timerElapsed(t))));content.querySelector('output').id='timerElapsed';
  if(timerNeedsConfirmation(t)){const warning=el('div','notice','Интервал свыше 12 часов. Проверьте время до сохранения.');warning.id='timerWarning';warning.append(button('Подтвердить время',()=>timerAction('confirm')));content.append(warning)}
  content.append(button(t.status==='running'?'Пауза':'Продолжить',()=>timerAction(t.status==='running'?'pause':'resume')),button('Завершить таймер',()=>timerAction('finish'),'primary'),button('Отменить таймер',()=>timerAction('cancel')));
  if(blocked)content.append(el('p','notice','Данные изменены в другой вкладке. Перезагрузите страницу.'));
 }
 details.append(content);root.append(details);updateTimerTick();
}
function persistTimerVisibility(){if(!readOnly&&!blocked&&state.timerState.status!=='idle')commit(s=>{s.timerState.lastObservedAt=now()});if(document.visibilityState==='visible'){renderTimer();checkReminders(true)}}
function updateTimerTick(){if(!state||readOnly)return;const dateChanged=!!reminderDay&&day(new Date())!==reminderDay;const t=state.timerState,out=$('#timerElapsed');if(out)out.textContent=formatElapsed(timerElapsed(t));const indicator=$('#timerIndicator');if(indicator)indicator.textContent=t.status==='idle'?'':(t.status==='paused'?'Пауза ':'Таймер ')+formatElapsed(timerElapsed(t));if(t.status!=='idle'&&timerNeedsConfirmation(t)&&!$('#timerWarning'))renderTimer();if(document.visibilityState==='visible'&&(Date.now()-lastReminderCheck>=60000||day(new Date())!==reminderDay))checkReminders();if(dateChanged&&section==='dashboard')render()}
function widgetOrder(){const order=state.settings.dashboardOrder||[];return [...new Set(order.concat(WIDGETS.map(([id])=>id)))]}
function reorderWidget(id,delta){const order=widgetOrder(),i=order.indexOf(id),j=i+delta;if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];if(commit(s=>{s.settings.dashboardOrder=order}))render()}
function directionForTopic(topicId){const topic=by('topic',topicId),course=topic&&by('course',topic.courseId),subject=course&&by('subject',course.subjectId);return subject?.directionId}
function computeDirectionProgress(id){
 const end=day(new Date()),rules=state.recurrences.filter(r=>!r.disabled),first=rules.reduce((date,r)=>{const t=by('session',r.templateSessionId);return t.startLocal.slice(0,10)<date?t.startLocal.slice(0,10):date},end);
 const sessions=state.sessions.filter(x=>!x.recurrenceId).concat(generateOccurrences(state,first,end)).filter(x=>directionForTopic(x.topicId)===id&&!archived('session',x));
 const tasks=state.homeworks.filter(x=>directionForTopic(x.topicId)===id&&!archived('homework',x));const values=sessions.map(x=>x.status==='completed'?100:0).concat(tasks.map(progress));return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null;
}
function overlapMilliseconds(start,end,from,to){return Math.max(0,Math.min(end,to)-Math.max(start,from))}
function getPeriodStats(from,to){
 const sessions=sessionsInRange(from,to);let plannedMinutes=0,actualSeconds=0;
 for(const x of sessions){const info=x._civil||civilInfo(x.startLocal);if(info.valid)plannedMinutes+=overlapMilliseconds(+info.date,+info.date+x.durationMinutes*60000,+from,+to)/60000}
 for(const t of state.timeEntries){const topic=by('topic',t.topicId);if(!topic||archived('topic',topic))continue;if(t.segments){const total=segmentSeconds(t.segments),scale=total>0?t.durationSeconds/total:0;for(const seg of t.segments)actualSeconds+=overlapMilliseconds(Date.parse(seg.startAt),Date.parse(seg.endAt),+from,+to)/1000*scale}else{const start=Date.parse(t.startedAt),end=Date.parse(t.endedAt);if(end>start)actualSeconds+=t.durationSeconds*overlapMilliseconds(start,end,+from,+to)/(end-start)}}
 return {plannedMinutes,actualMinutes:actualSeconds/60,differenceMinutes:actualSeconds/60-plannedMinutes};
}
function dashboardEvent(x){const box=el('div','dashboard-event');box.append(button(x.startLocal.slice(11)+' · '+x.title,()=>openEditor('session',x.id)),el('span','muted',breadcrumb(x.topicId)));const info=x._civil||civilInfo(x.startLocal);if(info.label)box.append(el('p','notice',info.label));return box}
function renderQuickAdd(p){
 const form=el('form','quick-add');form.id='dashboardQuick';const title=field(form,'quickTitle','Название *','text','',160),type=choice(form,'quickType','Тип',[['session','Занятие'],['homework','Задание']],'session');
 const topic=choice(form,'quickTopic','Тема',state.topics.filter(x=>!archived('topic',x)).map(x=>[x.id,breadcrumb(x.id)]),'');const sessions=choice(form,'quickSession','Занятие',[],'');
 const start=field(form,'quickStart','Начало занятия','datetime-local',local(new Date()));const sync=()=>{topic.closest('label').hidden=type.value!=='session';start.closest('label').hidden=type.value!=='session';sessions.closest('label').hidden=type.value!=='homework';sessions.replaceChildren();options(sessions,[['','Выберите занятие']].concat(state.sessions.filter(x=>!x.recurrenceId&&!archived('session',x)).map(x=>[x.id,breadcrumb(x.topicId)+' / '+x.title])),'')};type.addEventListener('change',sync);sync();
 const submit=el('button','primary','Открыть редактор');submit.type='submit';form.append(submit);form.addEventListener('submit',e=>{e.preventDefault();openEditor(type.value,null,type.value==='session'?topic.value:null,start.value||null,type.value==='homework'?sessions.value:null);if(!draft)return;const input=$('#editorFields [name=title]');input.value=title.value.trim();input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()});p.append(form);
}
function renderDashboard(p){
 toolbar(p,'Мой учебный день');const grid=el('div','dashboard-grid');
 for(const id of widgetOrder()){
  const card=el('section','card dashboard-widget');card.dataset.widget=id;const head=el('div','card-row');head.append(el('h2','',WIDGETS.find(([key])=>key===id)[1]));const controls=el('div','action-strip');controls.append(button('Вверх',()=>reorderWidget(id,-1)),button('Вниз',()=>reorderWidget(id,1)));head.append(controls);card.append(head);
  const today=new Date();today.setHours(0,0,0,0);const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);
  if(id==='today'){const events=sessionsInRange(today,tomorrow).sort((a,b)=>a.startLocal.localeCompare(b.startLocal));events.forEach(x=>card.append(dashboardEvent(x)));if(!events.length)card.append(el('p','muted','На сегодня занятий нет.'));card.append(button('Открыть календарь',()=>setSection('calendar')))}
  if(id==='deadlines'){const until=addCivilDays(day(today),6),tasks=state.homeworks.filter(h=>!archived('homework',h)&&progress(h)<100&&h.deadlineLocal&&h.deadlineLocal<=until).sort((a,b)=>a.deadlineLocal.localeCompare(b.deadlineLocal));tasks.forEach(h=>card.append(button((overdue(h)?'Просрочено · ':'')+h.deadlineLocal+' · '+h.title,()=>openEditor('homework',h.id),overdue(h)?'overdue':'')));if(!tasks.length)card.append(el('p','muted','Нет невыполненных заданий со сроком в ближайшие 7 дней.'));card.append(button('Все задания',()=>setSection('homework')))}
  if(id==='progress'){const directions=state.directions.filter(x=>!archived('direction',x));directions.forEach(d=>{const value=computeDirectionProgress(d.id);card.append(el('p','',d.name+': '+(value===null?'Нет данных':value+'%')))});if(!directions.length)card.append(el('p','muted','Нет активных направлений.'));card.append(button('Открыть обучение',()=>setSection('learning')))}
  if(id==='week'){const monday=new Date(today);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);const end=new Date(monday);end.setDate(end.getDate()+7);const stats=getPeriodStats(monday,end),minutes=n=>Math.round(n*10)/10;card.append(el('p','',`План: ${minutes(stats.plannedMinutes)} мин`),el('p','',`Факт: ${minutes(stats.actualMinutes)} мин`),el('p','',`Отклонение: ${minutes(stats.differenceMinutes)} мин`),el('p','muted','Фактическое время учитывает только завершённые записи таймера.'))}
  if(id==='goals')card.append(el('p','muted','Расчёт целей появится на шаге 3.'),button('О разделе целей',()=>setSection('goals')));
  if(id==='quick')renderQuickAdd(card);grid.append(card);
 }
 p.append(grid);
}
function checkReminders(force=false){
 if(!state||readOnly||blocked||document.visibilityState!=='visible')return;if(!force&&Date.now()-lastReminderCheck<60000&&reminderDay===day(new Date()))return;lastReminderCheck=Date.now();const current=new Date(),today=day(current);if(reminderDay!==today){reminders=[];reminderDay=today}
 const from=new Date(+current-1),to=new Date(+current+15*60000+1);
 for(const item of sessionsInRange(from,to)){const info=item._civil||civilInfo(item.startLocal),key='session:'+(item.occurrenceKey||item.id);if(info.valid&&+info.date>=+current&&+info.date<=+to&&item.status!=='completed'&&!seenReminders.has(key)){seenReminders.add(key);reminders.push({kind:'session',id:item.id,text:'Скоро занятие: '+item.startLocal.slice(11)+' · '+item.title})}}
 for(const task of state.homeworks){const key='homework:'+task.id+':'+today;if(task.deadlineLocal===today&&progress(task)<100&&!archived('homework',task)&&!seenReminders.has(key)){seenReminders.add(key);reminders.push({kind:'homework',id:task.id,text:'Срок сегодня: '+task.title})}}
 reminders=reminders.filter(item=>{const record=item.kind==='session'?resolveSession(item.id):by('homework',item.id);return !!record&&!archived(item.kind,record)&&(item.kind==='session'?record.status!=='completed'&&+civilInfo(record.startLocal).date>=Date.now():record.deadlineLocal===today&&progress(record)<100)});renderReminders();
}
function renderReminders(){const root=$('#reminders');if(!root)return;root.replaceChildren();if(!reminders.length)return;const box=el('div','notice');box.append(el('strong','','Напоминания в открытой странице'));reminders.forEach(item=>box.append(el('p','',item.text)));box.append(button('Скрыть напоминания',()=>{reminders=[];renderReminders()}));root.append(box)}

$('#editorForm').addEventListener('submit',e=>{e.preventDefault();saveEditor()});$('#closeEditor').addEventListener('click',()=>closeEditor());$('#cancelEditor').addEventListener('click',()=>closeEditor());$('#scrim').addEventListener('click',()=>closeEditor());document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#editor').hidden&&!$('#confirmDialog').open){e.preventDefault();closeEditor()}});$('#addGlobal').addEventListener('click',()=>{const c=el('div','card'),p=$('#main');c.append(el('h3','','Что добавить?'));for(const k of ['direction','subject','course','topic','session','homework'])c.append(button(TITLES[k],()=>{c.remove();openEditor(k)}));p.prepend(c)});$('#menuToggle').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));$('#importFile').addEventListener('change',e=>{importData(e.target.files[0]);e.target.value=''});window.addEventListener('storage',e=>{if(e.key===KEY||e.key===null){blocked=true;status('Конфликт вкладок');let external;try{external=JSON.parse(e.newValue)}catch{}notify((external?.timerState?.status&&external.timerState.status!=='idle'?'Таймер уже работает в другой вкладке. ':'')+'Данные обновлены в другой вкладке. Перезагрузите страницу, чтобы продолжить.');renderTimer()}});
window.addEventListener('beforeunload',e=>{if(draft?.dirty){e.preventDefault();e.returnValue=''}});
$('#editor').addEventListener('keydown',e=>{if(e.key!=='Tab')return;const fields=[...$('#editor').querySelectorAll('button,input,select,textarea,a')].filter(x=>!x.disabled&&x.getClientRects().length);const first=fields[0],last=fields.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
load();render();document.addEventListener('visibilitychange',persistTimerVisibility);window.addEventListener('pagehide',persistTimerVisibility);setInterval(updateTimerTick,1000);
})();
