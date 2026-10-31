import { test, expect } from 'bun:test';
import { exploreTopicRequest } from '../lib/topic-exploration';

const source = (id, extra={}) => ({id,title:id,kind:'资料摘录',facts:'',excerpt:'本地原文证据',summary:'资料摘要',url:'',externalKnowledgeId:undefined,...extra});
const normalized = url => { try { const u=new URL(url);u.hash='';return u.toString(); } catch { return ''; } };
function setup(overrides={}) {
  const patches=[]; const archived=[];
  const deps={
    search:async()=>({hits:[],warnings:[],searchedPlugins:['kuzu-local']}),
    importDocument:async(id)=>source('import-'+id,{externalKnowledgeId:id}),
    research:async()=>({sources:[],sourceIds:[]}),
    archive:async(items)=>{archived.push(...items);return items.map((a,i)=>source('web-'+i,a));},
    progress:async(p)=>{patches.push(structuredClone(p));},
    normalizeUrl:normalized,cleanContent:t=>t.trim(),...overrides,
  };
  return {deps,patches,archived};
}

test('combines knowledge, selected old local sources and actual fetched text; rejects failed, fabricated and duplicate URLs',async()=>{
  const old=source('old'); const local=source('local'); let imported=0; let prompt='';
  const {deps,patches,archived}=setup({
    search:async()=>({hits:[{pluginId:'kuzu-local',sourceIds:['old']},{pluginId:'weknora',documentId:'remote'},{pluginId:'weknora',documentId:'remote'}],warnings:['一项检索降级']}),
    importDocument:async(id)=>{imported++;return source('remote',{externalKnowledgeId:id});},
    research:async(p,on)=>{
      prompt=p;
      on({kind:'tool_call',tool:'web_search',callId:'search',input:{query:'研究'}});
      on({kind:'tool_call',tool:'web_fetch',callId:'a',input:{url:'https://example.com/good'}});
      on({kind:'tool_call',tool:'web_fetch',callId:'b',input:{url:'https://example.com/bad'}});
      on({kind:'tool_result',tool:'web_fetch',callId:'b',status:'error',result:'Error: failed'});
      on({kind:'tool_result',tool:'web_fetch',callId:'a',result:'原文中的可核实证据。'.repeat(20)});
      return {sourceIds:['local','fabricated'],sources:[{title:'成功',url:'https://example.com/good'},{title:'重复',url:'https://example.com/good#copy'},{title:'失败',url:'https://example.com/bad'},{title:'虚构',url:'https://example.com/fake'}]};
    },
  });
  const request='完整诉求'.repeat(100);
  const r=await exploreTopicRequest(request,{sources:[old,local]},deps);
  expect(prompt).toContain(request); expect(prompt).toContain('本地原文证据');
  expect(imported).toBe(1);expect(archived).toHaveLength(1);
  expect(archived[0].excerpt).toContain('可核实证据');
  expect(r.sources.map(s=>s.id)).toEqual(['old','remote','local','web-0']);
  expect(r.warnings).toContain('一项检索降级');
  expect(patches.at(-1)).toMatchObject({searchCalls:1,fetchCalls:2});
});

test('knowledge outage permits web evidence without any existing local sources',async()=>{
  const {deps}=setup({search:async()=>{throw Error('离线');},research:async(p,on)=>{
    on({kind:'tool_call',tool:'web_search',callId:'s'});
    on({kind:'tool_call',tool:'web_fetch',callId:'f',input:{url:'https://example.com/article'}});
    on({kind:'tool_result',tool:'web_fetch',callId:'f',result:'成功原文。'.repeat(30)});
    return {sources:[{title:'可用',url:'https://example.com/article'}]};
  }});
  const r=await exploreTopicRequest('研究方向',{sources:[]},deps);
  expect(r.sources).toHaveLength(1);expect(r.warnings.join()).toContain('离线');
});

test('web failure preserves knowledge evidence; no evidence fails without falling back to unrelated local sources',async()=>{
  const local=source('kb');
  const {deps}=setup({search:async()=>({hits:[{pluginId:'kuzu-local',sourceIds:['kb']}],warnings:[]}),research:async()=>{throw Error('网页暂不可用');}});
  const r=await exploreTopicRequest('方向',{sources:[local]},deps);
  expect(r.sources).toEqual([local]);expect(r.warnings.join()).toContain('网页暂不可用');
  deps.search=async()=>({hits:[],warnings:[]});
  await expect(exploreTopicRequest('方向',{sources:[local]},deps)).rejects.toThrow('没有找到');
});

test('limits remote document imports to eight unique documents',async()=>{
  const imported=[];
  const {deps}=setup({search:async()=>({hits:Array.from({length:20},(_,i)=>({pluginId:'weknora',documentId:String(i)})),warnings:[]}),importDocument:async(id)=>{imported.push(id);return source(id);}});
  const r=await exploreTopicRequest('方向',{sources:[]},deps);
  expect(imported).toHaveLength(8);expect(r.sources).toHaveLength(8);
});

test('keeps valid fetched articles among malformed and excessive results, and isolates archive failures',async()=>{
  const archived=[];
  const {deps}=setup({research:async(p,on)=>{
    for(const n of [1,2]) {
      on({kind:'tool_call',tool:'web_fetch',callId:String(n),input:{url:`https://example.com/${n}`}});
      on({kind:'tool_result',tool:'web_fetch',callId:String(n),result:'有依据的原文内容。'.repeat(20)});
    }
    return {sources:[null,{title:42,url:'bad'},...Array.from({length:13},(_,i)=>({title:'未抓取',url:`https://example.com/unused-${i}`})),{title:'归档失败',url:'https://example.com/1'},{title:'保留',url:'https://example.com/2'}]};
  },archive:async([article])=>{
    if(article.url.endsWith('/1'))throw Error('磁盘暂不可用');
    archived.push(article);return [source('kept',article)];
  }});
  const r=await exploreTopicRequest('方向',{sources:[]},deps);
  expect(archived).toHaveLength(1);expect(r.sources[0].id).toBe('kept');
  expect(r.warnings.join()).toContain('格式不完整');expect(r.warnings.join()).toContain('磁盘暂不可用');
});
