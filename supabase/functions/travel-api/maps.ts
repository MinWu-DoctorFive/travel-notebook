import { checkedJson, HttpError, bytesToBase64 } from './security.ts';
export async function makeMap(key:string,day:any,mode:string,overrides:Record<string,string>={}){
  const warnings:string[]=[],points:{id:string;name:string;location:string}[]=[],ambiguous:any[]=[];
  const stops=day.stops.slice(0,10);
  for(const [index,stop] of stops.entries()){
    if(stop.kind==='return'){warnings.push('返程终点通过地图 App 核对，本图显示当天游览地点。');continue;}
    const query=new URL('https://restapi.amap.com/v3/place/text');query.search=new URLSearchParams({key,keywords:stop.place||stop.title,offset:'5',extensions:'base'}).toString();
    const data=await checkedJson(await fetch(query,{signal:AbortSignal.timeout(10000)}));if(data.status!=='1')throw new HttpError(502,'高德地图查询失败，请核对 Key 和服务权限。');
    const choices=(data.pois||[]).filter((p:any)=>/^\d+(\.\d+)?,\d+(\.\d+)?$/.test(p.location));
    let selected=overrides[stop.id]?choices.find((p:any)=>p.id===overrides[stop.id]):undefined;
    const exact=choices.filter((p:any)=>p.name===stop.place||p.name===stop.title);if(!selected&&exact.length===1)selected=exact[0];
    if(!selected){ambiguous.push({id:stop.id,name:stop.place||stop.title,choices:choices.map((p:any)=>({id:p.id,name:p.name,address:`${p.cityname||''}${p.adname||''}${typeof p.address==='string'?p.address:''}`}))});continue;}
    points.push({id:stop.id,name:`${index+1}. ${selected.name}`,location:selected.location});
  }
  if(ambiguous.length)return {ambiguous};
  if(!points.length)throw new HttpError(400,'没有可绘制的地点，请先补全地点名称。');
  if(day.stops.length>10)warnings.push('小地图仅标注前 10 个节点，完整顺序见时间轴。');
  const paths:string[]=[];
  for(let i=1;i<points.length&&paths.length<4;i++){
    const url=new URL(mode==='drive'?'https://restapi.amap.com/v3/direction/driving':'https://restapi.amap.com/v3/direction/walking');url.search=new URLSearchParams({key,origin:points[i-1].location,destination:points[i].location,extensions:'base'}).toString();
    try{const data=await checkedJson(await fetch(url,{signal:AbortSignal.timeout(9000)}));const route=data.route?.paths?.[0];const line=route?.steps?.flatMap((s:any)=>(s.polyline||'').split(';')).filter(Boolean);if(line?.length)paths.push(`4,0x365b50,0.85,,:${line.filter((_:string,n:number)=>n%Math.max(1,Math.ceil(line.length/100))===0||n===line.length-1).join(';')}`);
      const stop=stops.find((s:any)=>s.id===points[i].id);const min=Math.ceil(Number(route?.duration||0)/60);if(stop&&min>stop.travelMin+10)warnings.push(`${points[i].name}：地图${mode==='drive'?'驾车':'步行'}约 ${min} 分钟，请核对时间轴中的移动余量。`);
    }catch{warnings.push(`${points[i].name}：道路路线暂不可用，仅显示地点位置。`);}
  }
  if(mode!=='drive')warnings.push('地图连线为步行路线；公交、地铁与跨城换乘请查看时间轴并在地图 App 核对。');
  const imageUrl=new URL('https://restapi.amap.com/v3/staticmap');imageUrl.search=new URLSearchParams({key,size:'750*400',scale:'2',labels:points.map(p=>`${p.name.split('.')[0]},0,1,18,0xffffff,0x365b50:${p.location}`).join('|'),paths:paths.join('|')}).toString();
  const response=await fetch(imageUrl,{signal:AbortSignal.timeout(15000)});if(!response.ok||!response.headers.get('content-type')?.startsWith('image/'))throw new HttpError(502,'地图图片未生成，请检查静态地图权限。');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>3*1024*1024)throw new HttpError(502,'地图图片过大。');
  return {image:`data:image/png;base64,${bytesToBase64(bytes)}`,points,warnings,checkedAt:new Date().toISOString()};
}
