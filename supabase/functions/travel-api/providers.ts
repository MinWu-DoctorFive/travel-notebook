import { createModels,createProvider } from 'npm:@earendil-works/pi-ai@1.2.0/models';
import { openAICompletionsApi } from 'npm:@earendil-works/pi-ai@1.2.0/api/openai-completions.lazy';
import { openAIResponsesApi } from 'npm:@earendil-works/pi-ai@1.2.0/api/openai-responses.lazy';
import { anthropicMessagesApi } from 'npm:@earendil-works/pi-ai@1.2.0/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from 'npm:@earendil-works/pi-ai@1.2.0/api/google-generative-ai.lazy';
import type { Model,Api } from 'npm:@earendil-works/pi-ai@1.2.0';
import { checkedJson,HttpError,safeFetch,validateEndpoint,bytesToBase64 } from './security.ts';
export type Endpoint={provider:string;protocol:'openai-completions'|'openai-responses'|'anthropic-messages'|'google-generative-ai';baseUrl:string;model:string;apiKey?:string};
export type Config={text:Endpoint;image:Endpoint;monthlyBudgetYuan:number;requestReserveYuan:number;imageReserveYuan:number;amapKey?:string;searchKey?:string};
export function requireEndpoint(endpoint:Endpoint,kind='文字',requireModel=true){
  const missing=[!endpoint.baseUrl&&'接口地址',requireModel&&!endpoint.model.trim()&&'模型名称',!endpoint.apiKey&&'API Key'].filter(Boolean);
  if(missing.length)throw new HttpError(400,`${kind}模型缺少${missing.join('、')}，请在“我的 → 模型配置”补齐并保存。此次未预留预算。`);
  validateEndpoint(endpoint.baseUrl);
}
export function completeDeepSeekPreset(config:Config):Config {
  const next=structuredClone(config);
  if(next.text.baseUrl&&!/^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(next.text.baseUrl))throw new HttpError(400,'已有接口属于其他地址，请选择 DeepSeek 并重新填写其 Key。');
  next.text={...next.text,provider:'DeepSeek',protocol:'openai-completions',baseUrl:'https://api.deepseek.com',model:'deepseek-flash'};
  requireEndpoint(next.text);return next;
}
export async function listModels(endpoint:Endpoint){
  requireEndpoint(endpoint,'文字',false);
  const headers:Record<string,string>={};
  if(endpoint.protocol==='anthropic-messages'){headers['x-api-key']=endpoint.apiKey!;headers['anthropic-version']='2023-06-01';}
  else if(endpoint.protocol==='google-generative-ai')headers['x-goog-api-key']=endpoint.apiKey!;
  else headers.Authorization=`Bearer ${endpoint.apiKey}`;
  const data=await checkedJson(await safeFetch(`${endpoint.baseUrl}/models`,{headers,signal:AbortSignal.timeout(20000)}));
  return {models:(data.data||data.models||[]).map((m:any)=>({id:String(m.id||m.name||'').replace(/^models\//,''),name:String(m.displayName||m.name||m.id||'')})).filter((m:any)=>m.id&&m.id.length<=150).slice(0,500)};
}
export function validateConfig(raw:any):Config {
  const endpoint=(value:any):Endpoint=>{if(!value||!['openai-completions','openai-responses','anthropic-messages','google-generative-ai'].includes(value.protocol))throw new HttpError(400,'请选择支持的模型接口协议。');if(value.baseUrl)validateEndpoint(value.baseUrl);if(String(value.model||'').length>150||String(value.apiKey||'').length>2000)throw new HttpError(400,'模型名称或密钥过长。');return {provider:String(value.provider||'兼容接口').slice(0,100),protocol:value.protocol,baseUrl:String(value.baseUrl||'').replace(/\/+$/,''),model:String(value.model||''),apiKey:value.apiKey};};
  for(const name of ['monthlyBudgetYuan','requestReserveYuan','imageReserveYuan'])if(!Number.isFinite(raw[name])||raw[name]<0||raw[name]>10000)throw new HttpError(400,'请填写有效的预算与请求预留金额。');
  if(raw.requestReserveYuan<.01||raw.imageReserveYuan<.01)throw new HttpError(400,'每次请求预留金额至少为 0.01 元。');
  return {text:endpoint(raw.text),image:endpoint(raw.image),monthlyBudgetYuan:raw.monthlyBudgetYuan,requestReserveYuan:raw.requestReserveYuan,imageReserveYuan:raw.imageReserveYuan,amapKey:String(raw.amapKey||'').slice(0,1000),searchKey:String(raw.searchKey||'').slice(0,2000)};
}
export function publicConfig(config:Config){const copy=structuredClone(config) as any;for(const name of ['text','image']){copy[name].hasKey=!!copy[name].apiKey;delete copy[name].apiKey;}copy.hasAmapKey=!!copy.amapKey;copy.hasSearchKey=!!copy.searchKey;delete copy.amapKey;delete copy.searchKey;return copy;}
async function completeHttp(endpoint:Endpoint,system:string,prompt:string,maxTokens:number){
  let path='',headers:Record<string,string>={'Content-Type':'application/json'},body:any;
  if(endpoint.protocol==='openai-completions'){path='/chat/completions';headers.Authorization=`Bearer ${endpoint.apiKey}`;body={model:endpoint.model,messages:[{role:'system',content:system},{role:'user',content:prompt}],max_tokens:maxTokens,stream:false};}
  else if(endpoint.protocol==='openai-responses'){path='/responses';headers.Authorization=`Bearer ${endpoint.apiKey}`;body={model:endpoint.model,instructions:system,input:prompt,max_output_tokens:maxTokens};}
  else if(endpoint.protocol==='anthropic-messages'){path='/messages';headers['x-api-key']=endpoint.apiKey!;headers['anthropic-version']='2023-06-01';body={model:endpoint.model,system,messages:[{role:'user',content:prompt}],max_tokens:maxTokens};}
  else{path=`/models/${encodeURIComponent(endpoint.model)}:generateContent`;headers['x-goog-api-key']=endpoint.apiKey!;body={systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens}};}
  const data=await checkedJson(await safeFetch(endpoint.baseUrl+path,{method:'POST',headers,body:JSON.stringify(body)}));
  const result=endpoint.protocol==='openai-completions'?data.choices?.[0]?.message?.content:endpoint.protocol==='openai-responses'?data.output?.flatMap((v:any)=>v.content||[]).filter((v:any)=>v.type==='output_text').map((v:any)=>v.text).join(''):endpoint.protocol==='anthropic-messages'?data.content?.filter((v:any)=>v.type==='text').map((v:any)=>v.text).join(''):data.candidates?.[0]?.content?.parts?.map((v:any)=>v.text||'').join('');
  if(typeof result!=='string'||!result)throw new HttpError(502,'模型没有返回文字结果。');return result;
}
export async function complete(endpoint:Endpoint,system:string,prompt:string,maxTokens=6500){
  requireEndpoint(endpoint);
  validateEndpoint(endpoint.baseUrl);
  const adapters={'openai-completions':openAICompletionsApi,'openai-responses':openAIResponsesApi,'anthropic-messages':anthropicMessagesApi,'google-generative-ai':googleGenerativeAIApi};
  const model:Model<Api>={id:endpoint.model,name:endpoint.model,api:endpoint.protocol,provider:'travel-model',baseUrl:endpoint.baseUrl,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens,compat:endpoint.protocol==='openai-completions'?{supportsDeveloperRole:false,supportsReasoningEffort:false}:undefined};
  const models=createModels();models.setProvider(createProvider({id:'travel-model',auth:{apiKey:{name:'API Key',resolve:async()=>({auth:{apiKey:endpoint.apiKey}})}},models:[model],api:adapters[endpoint.protocol]()}));
  let sent=false;
  try{const result=await models.complete(model,{systemPrompt:system,messages:[{role:'user',content:prompt,timestamp:Date.now()}]},{apiKey:endpoint.apiKey,maxTokens,signal:AbortSignal.timeout(110000),fetch:((url:RequestInfo|URL,init?:RequestInit)=>{sent=true;return safeFetch(url instanceof Request?url.url:String(url),init);}) as typeof fetch});
    if(result.stopReason==='error'||result.stopReason==='aborted'){if(!sent)return await completeHttp(endpoint,system,prompt,maxTokens);const detail=String(result.errorMessage||'');const reason=/401|invalid_api_key|Incorrect API key/i.test(detail)?'API 凭据无效或已过期。':/403|permission/i.test(detail)?'当前凭据没有此模型权限。':/404|not found/i.test(detail)?'模型或接口地址不存在。':/429|quota|rate limit/i.test(detail)?'服务商额度不足或请求过于频繁。':/resolveDns|解析|DNS/i.test(detail)?'云端无法解析模型接口域名，请检查地址或更换兼容接口。':'模型调用失败，请核对接口协议或网络。';throw new HttpError(502,reason);}
    if(result.stopReason==='length')throw new HttpError(502,'模型回复被截断，请减少行程天数或更换输出上限更高的模型。');
    const text=result.content.filter(c=>c.type==='text').map(c=>c.type==='text'?c.text:'').join('');if(!text)throw new HttpError(502,'模型没有返回文字结果。');return text;
  }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(502,'模型接口未完成请求，请核对地址、协议、权限或网络。');}
}
export function parseModelJson(text:string){const cleaned=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');try{return JSON.parse(cleaned);}catch{throw new HttpError(502,'模型返回格式不完整，请重试；原攻略已保留。');}}
export async function generateImage(endpoint:Endpoint,prompt:string):Promise<string>{
  if(!endpoint.apiKey||!endpoint.model||!endpoint.baseUrl)throw new HttpError(400,'请先配置图片模型。');
  // Image-only operation uses the provider HTTP API; no text-model subscription assumptions.
  if(endpoint.protocol==='google-generative-ai'){
    const url=`${endpoint.baseUrl}/models/${encodeURIComponent(endpoint.model)}:generateContent`;
    const data=await checkedJson(await safeFetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':endpoint.apiKey},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE']}})}));
    const part=data.candidates?.[0]?.content?.parts?.find((p:any)=>p.inlineData)?.inlineData;if(!part)throw new HttpError(502,'图片模型未返回图片。');return `data:${part.mimeType};base64,${part.data}`;
  }
  const data=await checkedJson(await safeFetch(`${endpoint.baseUrl}/images/generations`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${endpoint.apiKey}`},body:JSON.stringify({model:endpoint.model,prompt,n:1,size:'1024x1024'})}));
  if(data.data?.[0]?.b64_json)return `data:image/png;base64,${data.data[0].b64_json}`;
  if(data.data?.[0]?.url){const response=await safeFetch(data.data[0].url,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw new HttpError(502,'图片下载失败。');const type=response.headers.get('content-type')?.split(';')[0];if(!['image/png','image/jpeg','image/webp'].includes(type||''))throw new HttpError(502,'返回的图片格式不受支持。');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>6*1024*1024)throw new HttpError(502,'图片过大，请降低图片尺寸。');return `data:${type};base64,${bytesToBase64(bytes)}`;}
  throw new HttpError(502,'图片接口未返回有效图片。请使用支持 Images API 的服务商。');
}
