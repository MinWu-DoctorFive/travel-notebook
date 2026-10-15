import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { TripDocument, TripInput } from './travel';
import type { TripRecord } from './store';
import project from '../cloud-project.json';

export type Connection = { url: string; key: string };
export type ModelEndpoint = { provider: string; protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'; baseUrl: string; model: string; apiKey?: string; hasKey?: boolean };
export type ModelConfig = { text: ModelEndpoint; image: ModelEndpoint; monthlyBudgetYuan: number; requestReserveYuan: number; imageReserveYuan: number; amapKey?: string; hasAmapKey?: boolean; searchKey?: string; hasSearchKey?: boolean };
export const DEFAULT_CONFIG: ModelConfig = {
  text:{provider:'兼容接口',protocol:'openai-completions',baseUrl:'',model:''},
  image:{provider:'兼容接口',protocol:'openai-completions',baseUrl:'',model:''},
  monthlyBudgetYuan:20,requestReserveYuan:1,imageReserveYuan:2,
};
const CONNECTION_KEY='travel-cloud-connection-v1';
let client:SupabaseClient|undefined, clientKey='';
export function connection():Connection|undefined {
  try { const value=JSON.parse(localStorage.getItem(CONNECTION_KEY)||'null'); if(value?.url&&value?.key)return value; } catch { /* no connection */ }
  const url=import.meta.env?.VITE_SUPABASE_URL,key=import.meta.env?.VITE_SUPABASE_ANON_KEY;
  return url&&key?{url,key}:project.url&&project.key?project:undefined;
}
export function saveConnection(value:Connection) {
  const url=new URL(value.url);
  if(url.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(url.hostname)||url.port||url.username||url.password)throw new Error('请填写 Supabase 项目 URL，格式为 https://项目编号.supabase.co');
  if(!value.key||value.key.startsWith('sb_secret_'))throw new Error('这里只能填写 publishable / anon 公开密钥，不能填写 secret / service_role 密钥。');
  if(value.key.split('.').length===3) {try{const payload=JSON.parse(atob(value.key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role!=='anon')throw new Error('private');}catch{throw new Error('请使用项目的 anon 公开密钥。');}}
  localStorage.setItem(CONNECTION_KEY,JSON.stringify({url:url.origin,key:value.key.trim()}));client=undefined;clientKey='';
}
export function cloudClient():SupabaseClient|undefined {
  const value=connection();if(!value)return;
  const id=`${value.url}|${value.key}`;
  if(!client||clientKey!==id){client=createClient(value.url,value.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});clientKey=id;}
  return client;
}
export async function api<T>(action:string,payload:object={},requestId=crypto.randomUUID(),timeout=135000):Promise<T> {
  const conn=connection(),supabase=cloudClient();if(!conn||!supabase)throw new Error('请先在“我的”连接免费云后台。');
  if(!navigator.onLine)throw new Error('当前离线。已有攻略可以阅读，联网后再调用 AI 或同步。');
  const {data:{session}}=await supabase.auth.getSession();
  const response=await fetch(`${conn.url}/functions/v1/travel-api`,{method:'POST',headers:{'Content-Type':'application/json',apikey:conn.key,...(session?{Authorization:`Bearer ${session.access_token}`}:{})},body:JSON.stringify({action,requestId,...payload}),signal:AbortSignal.timeout(timeout)});
  let value:any;try{value=await response.json();}catch{throw new Error('云接口未正确返回，请检查后台部署或稍后重试。');}
  if(!response.ok)throw new Error(value.error||`云接口返回 ${response.status}`);
  return value as T;
}
export async function currentSession():Promise<Session|null>{return (await cloudClient()?.auth.getSession())?.data.session||null;}
export async function generateApi(input:TripInput,current?:TripDocument,change?:string){return api<{plan:unknown;notices:string[]}>('generate',{input,current:current?{...current,actual:{visitNotes:'',photoKeys:[]},coverUrl:undefined,mapDays:undefined,days:current.days.map(d=>({...d,imageUrl:undefined}))}:undefined,change});}
export const cloudList=()=>api<{records:TripRecord[]}>('list');
export const cloudSave=(trip:TripDocument,kind:string,expectedUpdatedAt?:string)=>api<TripRecord>('save',{trip,kind,expectedUpdatedAt});
export const cloudDelete=(id:string)=>api('delete',{id});

export function redactTrip(trip:TripDocument):TripDocument {
  const copy=structuredClone(trip),secrets=[copy.input.origin,copy.input.returnLocation||''].filter(Boolean);
  const hide=(text:string)=>secrets.reduce((v,s)=>v.split(s).join('私人地点'),text);
  const safeSource=(url:string)=>secrets.some(s=>url.includes(s)||url.includes(encodeURIComponent(s)))?'':url;
  copy.input.origin='出发地点已隐藏';copy.input.returnLocation='返回地点已隐藏';copy.input.budgetYuan=undefined;copy.input.constraints='';copy.input.interests='';copy.actual={visitNotes:'',photoKeys:[]};copy.mapDays=undefined;
  copy.title=hide(copy.title);copy.generalTips=copy.generalTips.map(hide);copy.removedForTime=copy.removedForTime.map(hide);
  copy.input.returnOrigin=copy.input.returnOrigin?hide(copy.input.returnOrigin):undefined;
  copy.days=copy.days.map(day=>({...day,title:hide(day.title),lodgingArea:day.lodgingArea?hide(day.lodgingArea):undefined,stops:day.stops.map(s=>({...s,title:hide(s.title),place:hide(s.place),description:hide(s.description),highlights:s.highlights.map(hide),photoTip:hide(s.photoTip),caution:hide(s.caution),sourceUrl:s.kind==='travel'||s.kind==='return'?'':safeSource(s.sourceUrl),sourceStatus:s.kind==='travel'||s.kind==='return'?'estimated':!safeSource(s.sourceUrl)?'check':s.sourceStatus}))}));return copy;
}
