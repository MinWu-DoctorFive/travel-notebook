import {useEffect,useRef,useState} from 'react';
import {Compass,Plus,BookOpen,History,UserRound,Cloud,Search,Download,ArrowUpRight,Trash2} from 'lucide-react';
import Planner from './components/Planner';
import Guide from './components/Guide';
import Profile,{Join,type Me} from './components/Profile';
import {ImportPage,Proposal,downloadJson} from './Legacy';
import {listTrips,getTrip,saveTrip,deleteTrip,exportBackup,importBackup,cacheRecord,setStorageScope,type TripRecord} from './lib/store';
import {HEBEI_SEED,type TripDocument} from './lib/travel';
import {parseTripDocument} from './lib/validation';
import {api,cloudClient,currentSession,cloudList,cloudSave,cloudDelete} from './lib/cloud';
import {assetUrl} from './lib/assets';
type Route={page:string;id?:string};
const routeNow=():Route=>{const [page,id]=location.hash.replace(/^#\/?/,'').split('/');return {page:page||'new',id:id?decodeURIComponent(id):undefined};};
const navigate=(page:string,id?:string)=>{location.hash=`/${page}${id?`/${encodeURIComponent(id)}`:''}`;};
export default function App(){
  const [route,setRoute]=useState(routeNow),[trips,setTrips]=useState<TripDocument[]>([]),[record,setRecord]=useState<TripRecord>(),[me,setMe]=useState<Me>(),[userId,setUserId]=useState<string>();
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[toast,setToast]=useState(''),[search,setSearch]=useState(''),[proposal,setProposal]=useState<TripDocument>(),[previous,setPrevious]=useState<TripDocument>(),[artId,setArtId]=useState(''),[shared,setShared]=useState<TripDocument>();
  const epoch=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  function notify(value:string){setToast(value);clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(''),6500);}
  async function reload(){
    const ticket=++epoch.current;setLoading(true);setError('');setRecord(undefined);setTrips([]);setProposal(undefined);setPrevious(undefined);setMe(undefined);
    try{const session=await currentSession();if(ticket!==epoch.current)return;const uid=session?.user.id;setUserId(uid);setStorageScope(uid);
      if(uid&&navigator.onLine){try{const profile=await api<Me>('me',{},crypto.randomUUID(),20000);if(ticket!==epoch.current)return;setMe(profile);const result=await cloudList();if(ticket!==epoch.current)return;for(const item of result.records){if(ticket!==epoch.current)return;await cacheRecord(item);}setTrips(result.records.map(r=>r.trip));return;}catch(e){if(ticket!==epoch.current)return;notify(e instanceof Error?`${e.message} 可读取此账号已缓存的攻略。`:'云端暂不可用。');}}
      if(ticket===epoch.current)setTrips(await listTrips());
    }catch(e){if(ticket===epoch.current)setError(e instanceof Error?e.message:'无法读取攻略。');}finally{if(ticket===epoch.current)setLoading(false);}
  }
  useEffect(()=>{void reload();const listener=()=>{setRoute(routeNow());setError('');setProposal(undefined);setShared(undefined);window.scrollTo(0,0);};window.addEventListener('hashchange',listener);const online=()=>void reload();window.addEventListener('online',online);const subscription=cloudClient()?.auth.onAuthStateChange((event)=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(()=>void reload(),0);});if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});return()=>{epoch.current++;window.removeEventListener('hashchange',listener);window.removeEventListener('online',online);subscription?.data.subscription.unsubscribe();clearTimeout(timer.current);};},[]);
  useEffect(()=>{let active=true;if(route.page==='trip'&&route.id&&!loading){void getTrip(route.id).then(next=>{if(!active)return;setRecord(next);if(!next)setError('当前空间没有这份攻略，请到历史页面选择。');});}return()=>{active=false;};},[route.page,route.id,loading,trips]);
  useEffect(()=>{let active=true;if(route.page==='share'&&route.id){void api<{trip:TripDocument}>('readShare',{token:route.id}).then(data=>active&&setShared(parseTripDocument(data.trip))).catch(e=>active&&setError(e.message));}return()=>{active=false;};},[route.page,route.id]);
  async function persist(document:TripDocument,kind:string){
    const ticket=epoch.current;const next=parseTripDocument(document);const existing=await getTrip(next.id);
    if(existing&&JSON.stringify(existing.trip.days.map(d=>d.stops.map(s=>s.place)))!==JSON.stringify(next.days.map(d=>d.stops.map(s=>s.place))))delete next.mapDays;
    let saved:TripRecord;
    if(userId){if(!navigator.onLine||!me)throw new Error('私人云端保存需要联网并登录。编辑尚未同步，请保留页面后重试。');saved=await cloudSave(next,kind,existing?document.updatedAt:undefined);if(ticket!==epoch.current)throw new Error('账号已切换，请重新打开攻略。');await cacheRecord(saved);}else saved=await saveTrip(next,kind);
    if(ticket!==epoch.current)return;setRecord(saved);setTrips(await listTrips());notify(userId?'已保存到私人云端，并保留历史版本。':'已保存在本机。登录后可导入私人云端。');
  }
  async function accept(){if(!proposal)return;try{const isNew=!previous;await persist(previous?{...proposal,updatedAt:previous.updatedAt}:proposal,isNew?'AI 生成攻略':'确认调整方案');if(isNew)setArtId(proposal.id);const id=proposal.id;setProposal(undefined);setPrevious(undefined);navigate('trip',id);}catch(e){notify(e instanceof Error?e.message:'保存未完成');}}
  async function backup(){const data=JSON.parse(await exportBackup());downloadJson(data,`行旅手账-${new Date().toISOString().slice(0,10)}.json`);notify('当前空间的攻略与版本已导出。');}
  async function restore(text:string){if(!userId){const result=await importBackup(text);setTrips(await listTrips());notify(`已导入 ${result.imported} 篇攻略。`);}else{const data=JSON.parse(text);if(data.schemaVersion===2){const pool=data.imagePool;const expand=(v:any):any=>typeof v==='string'&&/^@travel-image:\d+$/.test(v)?pool[Number(v.split(':')[1])]:Array.isArray(v)?v.map(expand):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expand(x)])):v;data.trips=data.trips.map(expand);}
      const docs=(data.trips||[{trip:data.trip||data}]).map((item:any)=>parseTripDocument(item.trip));if(!docs.length||docs.length>100)throw new Error('导入数量须为1—100篇。');for(const doc of docs){doc.id=crypto.randomUUID();await persist(doc,'导入私人攻略');}notify(`已导入 ${docs.length} 篇攻略，原文件保持不变。`);}navigate('trips');}
  const openProposal=(next:TripDocument,current?:TripDocument)=>{setPrevious(current);setProposal(next);};
  const active=trips.find(t=>t.status==='traveling')||trips.find(t=>t.status==='planned')||trips[0];
  useEffect(()=>{if(route.page==='guide'&&!loading&&active)navigate('trip',active.id);},[route.page,loading,active?.id]);
  const filtered=trips.filter(t=>`${t.title} ${t.input.destination} ${t.input.departureAt}`.includes(search));
  return <main className="site-shell v2-shell"><header className="topbar"><a href="#/new" className="brand"><span className="brand-mark"><Compass size={22}/></span>行旅手账</a><div className="topbar-actions"><a href="#/settings" className="local-badge"><Cloud size={14}/>{me?'私人云端':userId?'账号缓存':'本机模式'}</a><button className="icon-button" aria-label="导出完整备份" title="导出完整备份" onClick={()=>void backup().catch(e=>notify(e.message))}><Download size={18}/></button></div></header>
    {error&&<p className="error-box" role="alert">{error}</p>}
    {loading?<div className="loading-state" role="status">正在打开你的旅行空间…</div>:<>
      {['new','home'].includes(route.page)&&<Planner key={`planner-${userId||'local'}`} authenticated={!!me} config={me?.config||undefined} notify={notify} onPreview={trip=>openProposal(trip)} onCreate={async trip=>{await persist(trip,'手动新建');navigate('trip',trip.id);}}/>}
      {route.page==='guide'&&(active?<Guide key={active.id} record={{trip:active,revisions:record?.trip.id===active.id?record.revisions:[]}} onSave={persist} onProposal={next=>openProposal(next,active)} config={me?.config||undefined} authenticated={!!me} notify={notify}/>:<div className="empty-card"><BookOpen size={36}/><h1>下一段旅程</h1><p>生成一份攻略后，就能在这里翻看完整长图。</p><a className="button-primary" href="#/new">新建攻略</a></div>)}
      {route.page==='trip'&&record&&<Guide key={record.trip.id} record={record} onSave={persist} onProposal={next=>openProposal(next,record.trip)} config={me?.config||undefined} authenticated={!!me} notify={notify} autoArt={artId===record.trip.id}/>}
      {['trips','history'].includes(route.page)&&<section className="history-page"><header className="page-head"><span className="eyebrow">PLACES, PLANS & LITTLE MEMORIES</span><h1>旅程收藏</h1><p>去过的、想去的，都值得留一页。</p></header><label className="search-field"><Search size={18}/><input aria-label="搜索攻略" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索目的地、日期或标题"/></label><div className="history-grid">{filtered.map(t=><article className="history-card" key={t.id}><a className="history-cover" href={`#/trip/${encodeURIComponent(t.id)}`}>{t.coverUrl?<img src={assetUrl(t.coverUrl)} alt={`${t.title}旅行插画`}/>:<div className="history-placeholder"><Compass size={48} strokeWidth={1}/><span>{t.input.destination}</span></div>}<span>{t.status==='completed'?'已完成':t.status==='traveling'?'旅行中':'计划中'}</span></a><div className="history-copy"><small>{t.input.departureAt.slice(0,10)} · {t.days.length} 日 · {t.input.mode==='drive'?'自驾':'公共交通'}</small><h2><a href={`#/trip/${encodeURIComponent(t.id)}`}>{t.title}</a></h2><div className="history-bottom"><a href={`#/trip/${encodeURIComponent(t.id)}`}>查看长图与版本 <ArrowUpRight size={16}/></a><button className="icon-button" aria-label={`删除${t.title}`} onClick={()=>{if(!window.confirm('删除这份攻略及其版本？建议先导出备份。'))return;void(async()=>{try{if(userId)await cloudDelete(t.id);await deleteTrip(t.id);setTrips(await listTrips());notify('攻略已删除，云端分享已撤销。');}catch(e){notify(e instanceof Error?e.message:'删除失败');}})();}}><Trash2 size={16}/></button></div></div></article>)}</div>{!filtered.length&&<div className="empty-card"><Compass size={38}/><h2>收藏下一次出发</h2><p>新建攻略，或在“我的”导入旧攻略。</p><a href="#/new" className="button-primary">开始规划</a></div>}</section>}
      {route.page==='settings'&&<Profile key={`${userId||'local'}-${me?.config?.text.hasKey||false}`} me={me} onRefresh={reload} notify={notify} onBackup={backup} onImport={()=>navigate('import')} onSeed={async()=>{const trip=structuredClone(HEBEI_SEED);trip.id=crypto.randomUUID();trip.template='journal';await persist(trip,'导入历史示例');navigate('trip',trip.id);}}/>}
      {route.page==='join'&&route.id&&<Join token={route.id} onDone={async()=>{await reload();navigate('new');}}/>}
      {route.page==='share'&&shared&&<Guide record={{trip:shared,revisions:[]}} onSave={async()=>{}} onProposal={()=>{}} authenticated={false} readOnly notify={notify}/>}
      {route.page==='import'&&<ImportPage onPreview={next=>openProposal(next)} onRestore={restore} notify={notify}/>}
    </>}
    <nav className="bottom-nav" aria-label="主导航"><a href="#/new" className={['new','home'].includes(route.page)?'active':''}><Plus size={21}/><span>新建</span></a><a href={active?`#/trip/${encodeURIComponent(active.id)}`:'#/guide'} className={['trip','guide'].includes(route.page)?'active':''}><BookOpen size={20}/><span>攻略</span></a><a href="#/trips" className={['trips','history'].includes(route.page)?'active':''}><History size={21}/><span>历史</span></a><a href="#/settings" className={route.page==='settings'?'active':''}><UserRound size={20}/><span>我的</span></a></nav>
    {toast&&<p className="floating-message" role="status">{toast}</p>}
    {proposal&&<Proposal trip={proposal} previous={previous} onCancel={()=>setProposal(undefined)} onAccept={()=>void accept()}/>}
  </main>;
}
