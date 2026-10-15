import type { TripDocument, TripStop } from './travel';
import { assetUrl } from './assets';
import { redactTrip } from './cloud';

export type Template='practical'|'journal'|'share';
export const TEMPLATES:{id:Template;name:string;description:string;color:string}[]=[{id:'practical',name:'清晰实用',description:'清楚的时间轴，出门随手看',color:'#365b50'},{id:'journal',name:'旅行手账',description:'暖色纸张与插画，收藏这段旅途',color:'#a15b40'},{id:'share',name:'简洁分享',description:'明快配色，重点一眼就懂',color:'#456bba'}];
export type PosterPage={blob:Blob;url:string;title:string;width:number;height:number};
type Theme={bg:string;ink:string;accent:string;soft:string;muted:string};
const THEMES:Record<Template,Theme>={practical:{bg:'#f5f6f1',ink:'#23392e',accent:'#365b50',soft:'#e6eee7',muted:'#637568'},journal:{bg:'#fbf3e4',ink:'#3e362e',accent:'#a15b40',soft:'#f2e5ce',muted:'#85715d'},share:{bg:'#f3f6ff',ink:'#26344d',accent:'#456bba',soft:'#e5ecfb',muted:'#6b7891'}};
const KIND:Record<TripStop['kind'],string>={travel:'交通',sight:'游玩',meal:'用餐',rest:'休息',lodging:'住宿',return:'返程'};
const SOURCE={sourced:'有来源',estimated:'估算',check:'待核验'};
const WIDTH=1080,PAD=68,CONTENT=WIDTH-PAD*2;
const FONT='"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
type Block={height:number;draw:(ctx:CanvasRenderingContext2D,y:number)=>void};
function imageLoad(url:string):Promise<HTMLImageElement|undefined>{return new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(undefined);image.src=assetUrl(url);});}
export function wrapText(ctx:CanvasRenderingContext2D,text:string,width:number):string[]{const lines:string[]=[];for(const paragraph of String(text).split('\n')){let line='';for(const char of paragraph){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line='';}line+=char;}lines.push(line);}return lines;}
function textBlock(ctx:CanvasRenderingContext2D,text:string,theme:Theme,size=29,weight=400,space=18,indent=0):Block {size=Math.round(size*1.35);ctx.font=`${weight} ${size}px ${FONT}`;const lines=wrapText(ctx,text,CONTENT-indent);const lineHeight=Math.ceil(size*1.65);return {height:lines.length*lineHeight+space,draw:(c,y)=>{c.font=`${weight} ${size}px ${FONT}`;c.fillStyle=theme.ink;lines.forEach((line,i)=>c.fillText(line,PAD+indent,y+i*lineHeight));}};}
function titleBlock(ctx:CanvasRenderingContext2D,text:string,theme:Theme):Block {const textPart=textBlock(ctx,text,theme,37,700,32,22);return {height:textPart.height+27,draw:(c,y)=>{c.fillStyle=theme.accent;c.fillRect(PAD,y+25,6,37);textPart.draw(c,y+22);}};}
function stopBlocks(ctx:CanvasRenderingContext2D,stop:TripStop,index:number,theme:Theme):Block[]{
  const blocks:Block[]=[];
  const heading=`${String(index+1).padStart(2,'0')}  ${stop.startAt.slice(11)}—${stop.endAt.slice(11)}  ${KIND[stop.kind]} · ${stop.title}`;
  blocks.push({height:24,draw:()=>{}});
  const head=textBlock(ctx,heading,{...theme,ink:theme.accent},32,700,12);blocks.push(head);
  blocks.push(textBlock(ctx,`${stop.place}  ·  ${stop.kind==='return'?'固定返程时刻':`停留 ${stop.durationMin} 分钟`}${stop.travelMin?`  ·  移动约 ${stop.travelMin} 分钟`:''}  ·  ${SOURCE[stop.sourceStatus]}${stop.completed?'  ·  已完成':''}`,{...theme,ink:theme.muted},25));
  if(stop.description)blocks.push(textBlock(ctx,stop.description,theme));
  stop.highlights.forEach((value,i)=>blocks.push(textBlock(ctx,`${i+1}. ${value}`,theme,28,400,8,18)));
  if(stop.photoTip)blocks.push(textBlock(ctx,`拍照｜${stop.photoTip}`,theme,27,400,12));
  if(stop.caution)blocks.push(textBlock(ctx,`注意｜${stop.caution}`,{...theme,ink:theme.accent},28,600,16));
  if(stop.sourceUrl)blocks.push(textBlock(ctx,`核对链接：${stop.sourceUrl}`,{...theme,ink:theme.muted},21,400,16));
  blocks.push({height:14,draw:(c,y)=>{c.fillStyle=theme.soft;c.fillRect(PAD,y,CONTENT,2);}});return blocks;
}
function diagramBlock(ctx:CanvasRenderingContext2D,trip:TripDocument,date:string,theme:Theme,map?:HTMLImageElement):Block {
  const day=trip.days.find(d=>d.date===date)!;
  if(map)return {height:Math.round(CONTENT*map.naturalHeight/map.naturalWidth)+60,draw:(c,y)=>{const h=CONTENT*map.naturalHeight/map.naturalWidth;c.drawImage(map,PAD,y,CONTENT,h);c.font=`23px ${FONT}`;c.fillStyle=theme.muted;c.fillText('高德地图 · 编号对应下方安排 · 路线以地图 App 当前结果为准',PAD,y+h+17);}};
  const stops=day.stops;const columns=2,cellW=(CONTENT-36)/columns;let height=64;
  const rows:{height:number;entries:{label:string[];x:number;n:number}[]}[]=[];
  for(let i=0;i<stops.length;i+=columns){const entries=stops.slice(i,i+columns).map((s,j)=>{ctx.font=`26px ${FONT}`;return {label:wrapText(ctx,s.title,cellW-75),x:PAD+24+j*(cellW+12),n:i+j+1};});const h=Math.max(...entries.map(e=>e.label.length))*38+34;rows.push({height:h,entries});height+=h;}
  height+=56;
  return {height,draw:(c,y)=>{c.fillStyle=theme.soft;c.beginPath();c.roundRect(PAD,y,CONTENT,height-20,20);c.fill();let at=y+30;for(const row of rows){for(const entry of row.entries){c.fillStyle=theme.accent;c.beginPath();c.arc(entry.x+18,at+20,19,0,Math.PI*2);c.fill();c.fillStyle='#fff';c.font=`bold 22px ${FONT}`;c.textAlign='center';c.fillText(String(entry.n),entry.x+18,at+3);c.textAlign='left';c.fillStyle=theme.ink;c.font=`26px ${FONT}`;entry.label.forEach((line,i)=>c.fillText(line,entry.x+52,at+i*38));}at+=row.height;}c.font=`24px ${FONT}`;c.fillStyle=theme.muted;c.fillText('游览顺序示意 · 尚未接入真实地图，不表示位置与距离',PAD+24,y+height-66);}};
}

export async function renderPoster(source:TripDocument,template:Template,dayIndex?:number,privacy=false):Promise<PosterPage[]> {
  await document.fonts?.ready;
  const trip=privacy?redactTrip(source):source,theme=THEMES[template];
  const scratch=document.createElement('canvas'),ctx=scratch.getContext('2d');if(!ctx)throw new Error('当前浏览器不支持图片导出。');ctx.textBaseline='top';
  const art=trip.coverUrl?await imageLoad(trip.coverUrl):undefined;
  const selected=dayIndex===undefined?trip.days:[trip.days[dayIndex]];
  const maps=await Promise.all(selected.map(day=>trip.mapDays?.[day.date]?.image?imageLoad(trip.mapDays![day.date].image!):undefined));
  const dayArt=await Promise.all(selected.map(day=>day.imageUrl?imageLoad(day.imageUrl):undefined));
  const blocks:Block[]=[];
  blocks.push(textBlock(ctx,'行旅手账 / TRAVEL NOTEBOOK',{...theme,ink:theme.accent},24,700,30));
  blocks.push(textBlock(ctx,trip.title,theme,58,700,24));
  blocks.push(textBlock(ctx,`${trip.input.departureAt.slice(0,10)} — ${trip.input.returnDepartureAt.slice(0,10)}  ·  ${trip.days.length} 日  ·  ${trip.input.mode==='drive'?'自驾出行':'公共交通'}`,{...theme,ink:theme.muted},27));
  if(art)blocks.push({height:310,draw:(c,y)=>{const h=270;c.save();c.beginPath();c.roundRect(PAD,y,CONTENT,h,20);c.clip();const scale=Math.max(CONTENT/art.naturalWidth,h/art.naturalHeight);c.drawImage(art,PAD+(CONTENT-art.naturalWidth*scale)/2,y+(h-art.naturalHeight*scale)/2,art.naturalWidth*scale,art.naturalHeight*scale);c.restore();c.font=`21px ${FONT}`;c.fillStyle=theme.muted;c.fillText('旅行插画 / AI 示意图或自选封面',PAD,y+h+8);}});
  blocks.push(titleBlock(ctx,'计划总览',theme));
  for(const text of [`出发｜${trip.input.departureAt.replace('T',' ')} · ${trip.input.origin}`,`目的地｜${trip.input.destination}`,`返程｜${trip.input.returnDepartureAt.replace('T',' ')} 开始返回 ${trip.input.returnLocation||trip.input.origin}`,...(trip.input.returnOrigin?[`返程出发地｜${trip.input.returnOrigin}`]:[]),...(trip.input.arriveBy?[`最晚到达｜${trip.input.arriveBy.replace('T',' ')}`]:[])])blocks.push(textBlock(ctx,text,theme));
  trip.days.forEach((day,i)=>blocks.push(textBlock(ctx,`第 ${i+1} 天｜${day.title}：${day.stops.filter(s=>s.kind==='sight'||s.kind==='meal').map(s=>s.title).join(' → ')||'查看当天时间轴'}`,theme,28)));
  selected.forEach((day,i)=>{
    blocks.push(titleBlock(ctx,`第 ${trip.days.indexOf(day)+1} 天 · ${day.date} · ${day.title}`,theme));
    if(dayArt[i])blocks.push({height:265,draw:(c,y)=>{const art=dayArt[i]!;c.save();c.beginPath();c.roundRect(PAD,y,CONTENT,215,16);c.clip();const scale=Math.max(CONTENT/art.naturalWidth,215/art.naturalHeight);c.drawImage(art,PAD+(CONTENT-art.naturalWidth*scale)/2,y+(215-art.naturalHeight*scale)/2,art.naturalWidth*scale,art.naturalHeight*scale);c.restore();c.font=`24px ${FONT}`;c.fillStyle=theme.muted;c.fillText('当天旅行插画 / AI 示意图',PAD,y+225);}});
    blocks.push(diagramBlock(ctx,trip,day.date,theme,maps[i]));
    for(const warning of trip.mapDays?.[day.date]?.warnings||[])blocks.push(textBlock(ctx,`路线提醒｜${warning}`,{...theme,ink:theme.accent},25));
    day.stops.forEach((stop,n)=>blocks.push(...stopBlocks(ctx,stop,n,theme)));
    if(day.lodgingArea)blocks.push(textBlock(ctx,`今晚住宿｜${day.lodgingArea}`,theme,29,600,24));
  });
  blocks.push(titleBlock(ctx,'出行提醒',theme));
  (trip.generalTips.length?trip.generalTips:['出发前核对天气、开放时间、预约和返程交通。']).forEach((tip,i)=>blocks.push(textBlock(ctx,`${String(i+1).padStart(2,'0')}  ${tip}`,theme,29,400,24)));
  if(trip.removedForTime.length){blocks.push(titleBlock(ctx,'时间取舍',theme));trip.removedForTime.forEach(t=>blocks.push(textBlock(ctx,t,theme,27)));}
  blocks.push(textBlock(ctx,`版本时间：${new Date(trip.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}\n交通及未核实信息以出发前核对结果为准。${privacy?'分享版已隐藏私人地点与个人记录。':'私人使用版，请检查住址后再分享。'}`,{...theme,ink:theme.muted},22,400,24));
  // Cap each bitmap to avoid Safari canvas memory limits; all text continues on the next image.
  const maxHeight=14500,groups:Block[][]=[[]];let h=PAD*2;
  for(const block of blocks){if(block.height>maxHeight-PAD*2)throw new Error('单项内容过长，请缩短该项说明后再导出。');if(h+block.height>maxHeight){groups.push([]);h=PAD*2;}groups.at(-1)!.push(block);h+=block.height;}
  const pages:PosterPage[]=[];
  for(let index=0;index<groups.length;index++){
    const group=groups[index],canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=Math.ceil(group.reduce((n,b)=>n+b.height,0)+PAD*2+45);const c=canvas.getContext('2d');if(!c)throw new Error('图片画布初始化失败，请减少天数后重试。');
    c.fillStyle=theme.bg;c.fillRect(0,0,WIDTH,canvas.height);c.textBaseline='top';
    if(template==='journal'){c.globalAlpha=.10;c.strokeStyle=theme.accent;for(let y=30;y<canvas.height;y+=48){c.beginPath();c.moveTo(40,y);c.lineTo(1040,y);c.stroke();}c.globalAlpha=1;}
    let y=PAD;for(const block of group){block.draw(c,y);y+=block.height;}c.fillStyle=theme.muted;c.font=`21px ${FONT}`;c.fillText(`行旅手账 · ${TEMPLATES.find(t=>t.id===template)!.name}${groups.length>1?` · ${index+1}/${groups.length}（长图分段）`:''}`,PAD,canvas.height-PAD);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图片导出失败，请按天保存。')),'image/png'));
    pages.push({blob,url:URL.createObjectURL(blob),title:`${trip.title}${dayIndex!==undefined?`-第${dayIndex+1}天`:''}${groups.length>1?`-${index+1}`:''}`,width:WIDTH,height:canvas.height});canvas.width=1;canvas.height=1;
  }
  return pages;
}
export function releasePosters(pages:PosterPage[]){pages.forEach(p=>URL.revokeObjectURL(p.url));}
export async function downloadPoster(page:PosterPage){const file=new File([page.blob],`${page.title}.png`,{type:'image/png'});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:page.title});return;}const a=document.createElement('a');a.href=page.url;a.download=file.name;a.click();}
