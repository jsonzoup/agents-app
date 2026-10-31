// Run in its own Bun process: module mocks and DRAFT_STUDIO_HOME are intentionally isolated.
import { test, expect, mock, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { aiTerminologyRules } from '../lib/ai-terminology';
let mutateIllustrationDraft;

const testHome=await mkdtemp(path.join(os.tmpdir(),'draft-topics-'));
const previousHome=process.env.DRAFT_STUDIO_HOME;
const previousKey=process.env.DEEPSEEK_API_KEY;
process.env.DRAFT_STUDIO_HOME=testHome;
process.env.DEEPSEEK_API_KEY='mock-only';
const graph=await import('../lib/knowledge-graph');
const plugins=await import('../lib/knowledge-plugins');
let researchPrompt='',searchQuery='',generationBody,releaseResearch;
const textCalls=[],harnessCalls=[],imageCalls=[];
let extraGeneration=false, copilotHarness, channelGeneration, visualPlanOverride, omitResearchTools=false;
const modelDraft={title:'智能体如何调用工具',coverTitle:'智能体的工具边界',body:'智能体调用工具需要明确权限，模型推理不等于自主行动。',creativeBrief:{commonBelief:'模型等于智能体',counterAngle:'智能体需要工具与执行环境',emotionalArc:'困惑到看清',readerMirror:'AI产品团队',sceneAnchor:'工具调用',voiceAnchor:'待补充：作者观察',opening:'观察',development:'证据',turn:'边界',landing:'选择',shareLine:'先区分模型与智能体'}};
const png=(await sharp({create:{width:1080,height:1440,channels:3,background:'#eae8e2'}}).png().toBuffer()).toString('base64');
const researchGate=new Promise(resolve=>{releaseResearch=resolve;});
mock.module('../lib/knowledge-graph',()=>({...graph,buildKnowledgeContext:async()=>''}));
mock.module('../lib/knowledge-plugins',()=>({...plugins,
  weKnoraPluginPublicConfig:async()=>({mode:'external',enabled:false}),
  knowledgePluginStatuses:async()=>[],
  searchKnowledgePlugins:async(workspace,query)=>{searchQuery=query;return {hits:[],warnings:[]};},
}));
mock.module('../lib/harness',()=>({runHarnessResearch:async(prompt,on,signal,options)=>{
  if(prompt.includes('完整read review-input.json')){
    const fs=await import('node:fs/promises');const input=JSON.parse(await fs.readFile(path.join(options.cwd,'review-input.json'),'utf8'));
    for(const name of ['grill-with-docs','humanizer-zh']){on({kind:'tool_call',tool:'skill',callId:name,input:{name}});on({kind:'tool_result',tool:'skill',callId:name,status:'completed'});}
    return JSON.stringify(prompt.includes('这是修复任务')?input.candidate:{passed:true,issues:[],limitation:'测试未进行目视审校'});
  }

  if(prompt.includes('文章插画设计师')){
    const fs=await import('node:fs/promises');const input=JSON.parse(await fs.readFile(path.join(options.cwd,'article.json'),'utf8'));
    if(mutateIllustrationDraft) await mutateIllustrationDraft();
    await new Promise(r=>setTimeout(r,20));
 on({kind:'tool_call',tool:'read',callId:'creative-method',input:{file_path:'creative-method/SKILL.md'}});on({kind:'tool_result',tool:'read',callId:'creative-method',status:'completed'});
     on({kind:'tool_call',tool:'skill',callId:'manim',input:{name:'manimgl-best-practices'}});on({kind:'tool_result',tool:'skill',callId:'manim',status:'completed'});
    return JSON.stringify({sceneCode:'from manimlib import *\nclass DraftIllustration0(Scene):\n    def construct(self):\n        self.add(Text("工具执行必须先得到明确授权。",font="PingFang SC"),Text("明确授权",font="PingFang SC"))\n',review:'根据正文设计解释性插画，测试使用stub渲染，不作为真实视觉验收。'});
  }
  harnessCalls.push(prompt);
  if(!on)return copilotHarness ? copilotHarness(prompt,options) : '已检查智能体术语。';
  researchPrompt=prompt;
  await researchGate;
  if(omitResearchTools)return JSON.stringify({sourceIds:[],sources:[]});
  on({kind:'tool_call',tool:'web_search',callId:'s',input:{query:'测试方向'}});
  on({kind:'tool_call',tool:'web_fetch',callId:'f',input:{url:'https://example.com/original'}});
  on({kind:'tool_result',tool:'web_fetch',callId:'f',result:'独立测试原文证据，包含具体方法与边界。'.repeat(20)});
  if(prompt.includes('深度研究与综合思辨')) {
    on({kind:'tool_call',tool:'web_fetch',callId:'independent',input:{url:'https://independent.example.com/review'}});
    on({kind:'tool_result',tool:'web_fetch',callId:'independent',result:'独立来源讨论部署成本、反例与人工复核边界。'.repeat(20)});
    return JSON.stringify({sources:[{title:'独立分析',url:'https://independent.example.com/review',facts:'部署有成本，写入需要人工复核。',unknowns:'样本范围有限'}]});
  }
  return JSON.stringify({sources:[{title:'测试原始资料',url:'https://example.com/original',facts:'原文支持的判断',direction:'AI 产品'}]});
}}));
const videoTools=await import('../server/video');
mock.module('../server/video',()=>({...videoTools,runVideoCommand:async()=>{},constrainedRender:async(binary,args,work)=>{
 const fs=await import('node:fs/promises');const input=JSON.parse(await fs.readFile(path.join(work,'article.json'),'utf8'));
 const canvas=await sharp({create:{width:input.width,height:input.height,channels:3,background:'#f4f1e9'}}).composite([{input:Buffer.from(`<svg width="${input.width}" height="${input.height}"><rect x="100" y="100" width="300" height="200" fill="#17695b"/></svg>`)}]).png().toBuffer();
 await fs.writeFile(path.join(work,'page-0.png'),canvas);
}}));
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.site/v1/images/generations'){imageCalls.push(JSON.parse(options.body));return Response.json({data:[{b64_json:png}]});}
  if(String(url)==='https://api.deepseek.com/v1/tools/search') {
    expect(JSON.parse(options.body).need_content).toBe(true);
    return Response.json({results:[1,2].map(i=>({title:'原文'+i,url:`https://official-test.example/${i}`,content:'这是搜索接口返回的完整原文，包含可核实的部署成本与人工复核边界。'.repeat(20)}))});
  }
  if(String(url)!=='https://api.deepseek.com/chat/completions')throw Error(`Unexpected external request: ${url}`);
  generationBody=JSON.parse(options.body);
  textCalls.push(generationBody);
  if(channelGeneration)return channelGeneration(generationBody);
  if(extraGeneration){
    const system=generationBody.messages[0].content;
    const result=system.includes('视觉总监')?(visualPlanOverride ?? {images:[{kind:'slide',title:'智能体的边界',lead:'执行前确认权限，推理结果不能直接等同于执行授权。',claim:'模型推理不等于执行授权',valueReason:'区分推理与执行的权限边界',evidenceQuotes:[modelDraft.body]}]}):modelDraft;
    return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
  }
  const evidence=JSON.parse(generationBody.messages.find(m=>m.role==='user').content).evidence;
  return Response.json({choices:[{message:{content:JSON.stringify({topics:[{title:'从真实资料看小团队的工具选择',direction:'AI 产品',thesis:'测试判断',readerValue:'帮助读者识别适用边界',sourceIds:[evidence[0].id]}]})}}]});
};
const {app}=await import('../server/app');
const {readWorkspace,updateWorkspace}=await import('../lib/store');
const base='http://127.0.0.1:8794';
const session=await app.request(`${base}/api/session`,{headers:{host:'127.0.0.1:8794'}});
const {token}=await session.json();
const post=body=>app.request(`${base}/api/topics/generate-batch`,{method:'POST',headers:{host:'127.0.0.1:8794',origin:base,'content-type':'application/json','x-draft-studio-token':token},body:JSON.stringify(body)});
afterAll(async()=>{
  // Status is persisted before background tasks release their final locks.
  await new Promise(resolve=>setTimeout(resolve,100));
  releaseResearch();
  globalThis.fetch=originalFetch;
  if(previousHome===undefined)delete process.env.DRAFT_STUDIO_HOME;else process.env.DRAFT_STUDIO_HOME=previousHome;
  if(previousKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previousKey;
  await rm(testHome,{recursive:true,force:true});
});

test('optional request validates, starts without local evidence, runs once under concurrency and reaches grounded generation',async()=>{
  await updateWorkspace(w=>{
    w.sources=[];w.topics=[];w.topicRuns=[];
    for(const key of Object.keys(w.settings.topicMix))w.settings.topicMix[key]=key==='科研'?100:0;
  });
  expect((await post({})).status).toBe(400);
  expect((await post({request:'  \n '})).status).toBe(400);
  expect((await post({request:'长'.repeat(2001)})).status).toBe(400);
  const request='研究小团队采用 AI 编程工具的真实成本、案例和局限。'.repeat(15);
  const responses=await Promise.all([post({request,count:1}),post({request,count:1})]);
  expect(responses.map(r=>r.status).sort()).toEqual([202,429]);
  releaseResearch();
  let data;
  for(let i=0;i<150;i++){
    data=await readWorkspace();
    if(data.topicRuns[0]?.status!=='运行中')break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  expect(data.topicRuns).toHaveLength(1);
  expect(data.topicRuns[0].status).toBe('完成');
  expect(data.topicRuns[0]).toMatchObject({request,searchCalls:1,fetchCalls:1});
  expect(researchPrompt).toContain(request);
  expect(researchPrompt).toContain(aiTerminologyRules);
  expect(generationBody.messages[0].content).toContain(aiTerminologyRules);
  expect(searchQuery).toBe(request.slice(0,200));
  const context=JSON.parse(generationBody.messages.find(m=>m.role==='user').content);
  expect(context.request).toBe(request);
  expect(context.targetDirectionCounts).toBeUndefined();
  expect(context.evidence[0].excerpt).toContain('独立测试原文证据');
  expect(data.topics).toHaveLength(1);
  expect(data.topics[0].direction).toBe('AI 产品');
  expect(data.topics[0].sourceIds).toEqual([data.sources[0].id]);
  expect(data.sources[0]).toMatchObject({url:'https://example.com/original',verification:'待核实'});
},15000);


const waitUntil=async(predicate)=>{
  for(let i=0;i<250;i++){
    const data=await readWorkspace();if(predicate(data)){await new Promise(resolve=>setTimeout(resolve,50));return data;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error('Background task did not finish');
};
const call=async(route,body)=>app.request(`${base}/api${route}`,{method:'POST',headers:{host:'127.0.0.1:8794',origin:base,'content-type':'application/json','x-draft-studio-token':token},body:JSON.stringify(body)});
test('writing, brief, rewrite, Copilot, visual planning and both image submission paths receive the AI vocabulary',async()=>{
  extraGeneration=true;
  const topic=(await readWorkspace()).topics[0];
  const start=await call(`/topics/${topic.id}/generate`,{channel:'xiaohongshu'});
  expect(start.status).toBe(202);
  const draftId=(await start.json()).draft.id;
  let data=await waitUntil(w=>w.drafts.find(d=>d.id===draftId)?.generationRun?.status!=='运行中');
  expect(data.drafts.find(d=>d.id===draftId).generationRun.status).toBe('完成');
  expect((await call(`/drafts/${draftId}/plan`,{})).status).toBe(200);
  expect((await call(`/drafts/${draftId}/rewrite`,{})).status).toBe(200);
  for(const request of textCalls.filter(r=>r.messages[0].content.includes('深度研究与综合思辨'))) {
    expect(request.messages.map(m=>m.content).join('\n')).toContain('独立分析');
    expect(request.messages[0].content).toContain('不为显深刻堆概念');
  }
  expect((await call(`/drafts/${draftId}/copilot`,{target:'title',message:'检查标题的AI术语'})).status).toBe(202);
  await waitUntil(w=>!w.drafts.find(d=>d.id===draftId).copilotMessages.some(m=>m.status==='运行中'));
  expect(harnessCalls.at(-1)).toContain(aiTerminologyRules);
  const oldImageKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='mock-only';
  try{
    expect((await call(`/drafts/${draftId}/images`,{model:'gpt-image-2.5-flare'})).status).toBe(202);
    data=await waitUntil(w=>w.drafts.find(d=>d.id===draftId).visualRun?.status!=='运行中');
    expect(data.drafts.find(d=>d.id===draftId).visualRun.status).toBe('完成');
    expect(imageCalls.length).toBe(2);
    const saved=data.drafts.find(d=>d.id===draftId);
    expect(saved.images).toHaveLength(1);
    expect(saved.images[0].prompt).toBe(imageCalls[0].prompt);
    expect(saved.images[0].prompt).toContain('【主体与任务】');
    expect(saved.images[0].prompt).toContain('锁定色调');
    expect((await call(`/drafts/${draftId}/image`,{model:'gpt-image-2.5-flare',prompt:'AI智能体与工具协作'})).status).toBe(200);
    for(const request of imageCalls)expect(request.prompt).toContain(aiTerminologyRules);
  }finally{
    if(oldImageKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldImageKey;
  }
  const systems=textCalls.map(request=>request.messages[0].content);
  expect(systems.some(s=>s.includes('视觉总监'))).toBe(true);
  expect(systems.some(s=>s.includes('只生成创作卡'))).toBe(true);
  expect(systems.some(s=>s.includes('重写正文'))).toBe(true);
  for(const system of systems)expect(system).toContain(aiTerminologyRules);
  for(const label of ['只生成创作卡','重写正文']) expect(systems.find(s=>s.includes(label))).toContain('共同传播骨架');
},20000);


test('ungrounded plans preserve body assets while regenerating an independent cover',async()=>{
  const draft=(await readWorkspace()).drafts[0];
  const before=JSON.stringify([draft.images,draft.wechatCover,draft.visualStyleGuide,draft.visualThemeId]);
  const count=imageCalls.length;
  process.env.OPENAI_API_KEY='mock-only';
  extraGeneration=true;
  try {
    for(const plan of [{images:[{kind:'slide',title:'未经证实',lead:'提高99%',claim:'增长',valueReason:'比较',evidenceQuotes:['不在文章中的证据']}]},{images:[{}]}]){
      visualPlanOverride=plan;
      expect((await call(`/drafts/${draft.id}/images`,{model:'gpt-image-2.5-flare'})).status).toBe(202);
      const state=await waitUntil(w=>w.drafts.find(d=>d.id===draft.id).visualRun?.status!=='运行中');
      const saved=state.drafts.find(d=>d.id===draft.id);
      if (plan.images[0].claim) {
        expect(saved.images).toEqual(draft.images);
        expect(saved.wechatCover.fileName).not.toBe(draft.wechatCover.fileName);
        expect(imageCalls.length).toBe(count+1);
      } else {
        expect(saved.visualRun.status).toBe("失败");
        expect(imageCalls.length).toBe(count+1);
      }
    }
  }finally{visualPlanOverride=undefined;delete process.env.OPENAI_API_KEY;}
});

test('article Copilot sessions keep histories, context, tools and concurrent tasks separate',async()=>{
  const topic=(await readWorkspace()).topics[0];
  const a=(await (await call(`/topics/${topic.id}/draft`,{})).json()).draft;
  const b=(await (await call(`/topics/${topic.id}/draft`,{})).json()).draft;
  const markers=new Map([[a.id,'ARTICLE_A_PRIVATE'],[b.id,'ARTICLE_B_PRIVATE']]);
  await updateWorkspace(w=>{
    for(const d of w.drafts.filter(d=>markers.has(d.id))){
      const marker=markers.get(d.id);
      d.title=marker;d.body=marker+'_BODY';
      d.copilotMessages=[{id:marker,role:'user',text:marker+'_HISTORY',target:'title',status:'完成',createdAt:new Date().toISOString(),mentions:[]}];
    }
  });
  const pending=new Map(),captured=new Map();
  const tool=async(options,action,args={})=>{
    const response=await app.request(`${base}/api/copilot/tool`,{
      method:'POST',headers:{host:'127.0.0.1:8794',origin:base,'content-type':'application/json','x-draft-studio-token':token,'x-draft-studio-copilot-tool':options.env.DRAFT_STUDIO_COPILOT_TOOL_SECRET},
      body:JSON.stringify({draftId:options.env.DRAFT_STUDIO_COPILOT_DRAFT_ID,action,arguments:args}),
    });
    expect(response.status).toBe(200);return response.json();
  };
  copilotHarness=async(prompt,options)=>{
    const id=options.env.DRAFT_STUDIO_COPILOT_DRAFT_ID;
    captured.set(id,{prompt,context:await tool(options,'get_context')});
    if(id===a.id){
      const researched=await tool(options,'research_article',{question:'工具权限的机制与反例'});
      expect(researched.research).toContain('独立分析');
      expect(researched.research).toContain('反方');
      expect(prompt).toContain('必须先调用 draft_studio_research_article');
    }
    await new Promise(resolve=>pending.set(id,resolve));
    await tool(options,'replace_title',{title:markers.get(id)+'_EDITED'});
    return markers.get(id)+'_REPLY';
  };
  try{
    const starts=await Promise.all([
      call(`/drafts/${a.id}/copilot`,{target:'title',message:'A_ONLY_REQUEST'}),
      call(`/drafts/${a.id}/copilot`,{target:'title',message:'A_DUPLICATE_REQUEST'}),
      call(`/drafts/${b.id}/copilot`,{target:'title',message:'B_ONLY_REQUEST'}),
    ]);
    expect(starts.slice(0,2).map(r=>r.status).sort()).toEqual([202,429]);
    expect(starts[2].status).toBe(202);
    await waitUntil(()=>pending.size===2);
    const runningState=await readWorkspace();
    for(const id of markers.keys()){
      const assistant=runningState.drafts.find(d=>d.id===id).copilotMessages.at(-1);
      expect(assistant.status).toBe('运行中');
      expect(assistant.toolEvents.map(event=>[event.action,event.status])).toEqual([['get_context','完成'],...(id===a.id?[['research_article','完成']]:[])]);
    }
    for(const [id,marker] of markers){
      const other=id===a.id?'ARTICLE_B_PRIVATE':'ARTICLE_A_PRIVATE';
      expect(captured.get(id).prompt).toContain(marker+'_BODY');
      expect(captured.get(id).prompt).toContain(marker+'_HISTORY');
      expect(captured.get(id).prompt).not.toContain(other);
      expect(JSON.stringify(captured.get(id).context)).not.toContain(other);
      expect(captured.get(id).context.context.id).toBe(id);
    }
    pending.get(b.id)();
    let state=await waitUntil(w=>w.drafts.find(d=>d.id===b.id).copilotMessages.at(-1).status==='完成');
    expect(state.drafts.find(d=>d.id===a.id).copilotMessages.at(-1).status).toBe('运行中');
    pending.get(a.id)();
    state=await waitUntil(w=>w.drafts.find(d=>d.id===a.id).copilotMessages.at(-1).status==='完成');
    for(const [id,marker] of markers){
      const draft=state.drafts.find(d=>d.id===id);
      expect(draft.title).toBe(marker+'_EDITED');
      expect(draft.copilotMessages).toHaveLength(3);
      expect(draft.copilotMessages.at(-1).text).toContain(marker+'_REPLY');
      expect(draft.copilotMessages.at(-1).toolEvents.map(event=>[event.action,event.status])).toEqual([
        ['get_context','完成'],...(id===a.id?[['research_article','完成']]:[]),['replace_title','完成'],
      ]);
      expect(JSON.stringify(draft.copilotMessages)).not.toContain(id===a.id?'ARTICLE_B_PRIVATE':'ARTICLE_A_PRIVATE');
    }
  }finally{
    for(const release of pending.values())release();
    copilotHarness=undefined;
  }
},15000);


test('topic pool only creates blank articles; channel generation requires one explicitly selected channel',async()=>{
  const topic=(await readWorkspace()).topics[0];
  for(const body of [null,[],true,'wechat',{channels:['wechat']},{channel:'wechat'}]){
    expect((await call(`/topics/${topic.id}/draft`,body)).status).toBe(400);
  }
  for(const body of [null,[],true,'wechat',{channels:['wechat','xiaohongshu']},{channels:['wechat'],channel:'wechat'}]){
    expect((await call(`/topics/${topic.id}/generate`,body)).status).toBe(400);
  }
  const blank=await call(`/topics/${topic.id}/draft`,{});
  expect(blank.status).toBe(201);
  const blankDraft=(await blank.json()).draft;
  expect(blankDraft.body).toBe('');
  expect(blankDraft.channelVariants).toEqual({});
  const prompts=[];
  channelGeneration=request=>{
    prompts.push(request);
    return Response.json({choices:[{message:{content:JSON.stringify({...modelDraft,title:'微信公众号专属标题',body:'微信公众号专属正文'})}}]});
  };
  try{
    const start=await call(`/topics/${topic.id}/generate`,{channel:'wechat'});
    expect(start.status).toBe(202);
    const id=(await start.json()).draft.id;
    const data=await waitUntil(w=>w.drafts.find(d=>d.id===id)?.generationRun.status!=='运行中');
    const draft=data.drafts.find(d=>d.id===id);
    expect(draft.generationRun.status).toBe('完成');
    expect(draft.channel).toBe('wechat');
    expect(draft.title).toBe('微信公众号专属标题');
    expect(data.topics.find(t=>t.id===topic.id).title).toBe(topic.title);
    expect(draft.body).toBe('微信公众号专属正文');
    expect(Object.keys(draft.channelVariants)).toEqual(['wechat']);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].messages[0].content).toContain('公众号');
  }finally{channelGeneration=undefined;}
},15000);

test('article regeneration accepts content or images and rejects title generation', async()=>{
  const topic=(await readWorkspace()).topics[0];
  const draft=(await (await call(`/topics/${topic.id}/draft`,{})).json()).draft;
  for(const body of [{},null,{selections:[]},{selections:[{channel:'wechat',title:true,content:true,images:false}]},{selections:[{channel:'wechat',title:false,content:false,images:false}]},{selections:[{channel:'other',title:true,content:false,images:false}]}])
    expect((await call(`/drafts/${draft.id}/regenerate`,body)).status).toBe(400);
});

test('topic publication persists, filters into published, and can return to selected', async () => {
  const { topicPoolStage } = await import('../lib/topic-pool');
  const workspace = await readWorkspace();
  const topic = workspace.topics[0];
  expect(topicPoolStage({ ...topic, status: '待评估' }, [])).toBe('待选');
  expect(topicPoolStage({ ...topic, status: '暂缓' }, [])).toBe('待选');
  expect(topicPoolStage({ ...topic, status: '准备写作' }, [])).toBe('已选');
  expect(topicPoolStage({ ...topic, status: '待评估' }, [{ topicId: topic.id }])).toBe('已选');
  const patch = status => app.request(`${base}/api/topics/${topic.id}`, {
    method: 'PATCH',
    headers: { host: '127.0.0.1:8794', origin: base, 'content-type': 'application/json', 'x-draft-studio-token': token },
    body: JSON.stringify({ status }),
  });
  expect((await patch('已发布')).status).toBe(200);
  const published = (await readWorkspace()).topics.find(item => item.id === topic.id);
  expect(published.status).toBe('已发布');
  expect(topicPoolStage(published, [{ topicId: topic.id }])).toBe('已发');
  expect((await patch('准备写作')).status).toBe(200);
  expect(topicPoolStage((await readWorkspace()).topics.find(item => item.id === topic.id), [])).toBe('已选');
  expect((await patch('无效状态')).status).toBe(400);
});

test('text cards render locally and only the independent cover uses image generation', async () => {
 const draft=(await (await call(`/topics/${(await readWorkspace()).topics[0].id}/draft`,{})).json()).draft;
 draft.body='工具执行必须先得到明确授权。';
 await updateWorkspace(w=>{w.drafts.find(d=>d.id===draft.id).body=draft.body;});
 const before=imageCalls.length;
 process.env.OPENAI_API_KEY='mock-only';
 extraGeneration=true;
 visualPlanOverride={images:[{kind:'slide',layout:'text_card',title:'工具执行的权限边界',lead:'推理结果不等于执行授权',claim:'工具权限与推理分开',valueReason:'让作者识别执行边界',evidenceQuotes:[draft.body]}]};
 try {
  expect((await call(`/drafts/${draft.id}/images`,{model:'gpt-image-2.5-flare'})).status).toBe(202);
  const workspace=await waitUntil(w=>w.drafts.find(d=>d.id===draft.id).visualRun?.status!=='运行中');
  const saved=workspace.drafts.find(d=>d.id===draft.id);
  expect({status:saved.visualRun.status,error:saved.visualRun.error}).toEqual({status:'完成',error:undefined});
  expect(saved.images).toHaveLength(1);
  expect(saved.images[0].promptSpec.composition).toContain('text_card');
  expect(imageCalls.length).toBe(before+1);
  expect(imageCalls.at(-1).prompt).toContain('封面');
 } finally {visualPlanOverride=undefined;delete process.env.OPENAI_API_KEY;}
});

test('four delivery scenes persist separately and render channel-sized cards plus independent covers', async () => {
 const {contentChannels}=await import('../lib/channels');
 const {channelLabel}=await import('../lib/wechat');
 const {channelVisuals}=await import('../lib/channel-visuals');
 const topic=(await readWorkspace()).topics[0];
 const draft=(await (await call(`/topics/${topic.id}/draft`,{})).json()).draft;
 const oldKey=process.env.OPENAI_API_KEY;
 process.env.OPENAI_API_KEY='mock-only';extraGeneration=true;
 try {
  for(const channel of contentChannels){
   const changed=await call(`/drafts/${draft.id}/channel`,{channel});
   expect(changed.status).toBe(200);
   await updateWorkspace(w=>{const d=w.drafts.find(d=>d.id===draft.id);d.title=channelLabel(channel);d.body='工具执行需要明确授权，写入操作必须人工复核。';});
   const current=(await readWorkspace()).drafts.find(d=>d.id===draft.id);
   visualPlanOverride={images:[{kind:'slide',layout:'text_card',title:'执行权限与推理分开',lead:'写入操作必须人工复核',claim:'执行授权',valueReason:'说明权限边界',evidenceQuotes:[current.body]}]};
   expect((await call(`/drafts/${draft.id}/images`,{model:'gpt-image-2.5-flare'})).status).toBe(202);
   const state=await waitUntil(w=>w.drafts.find(d=>d.id===draft.id).visualRun.status!=='运行中');
   const saved=state.drafts.find(d=>d.id===draft.id);
   expect(saved.visualRun.status).toBe('完成');
   const media=await app.request(`${base}/api/media/${saved.images[0].fileName}`,{headers:{host:'127.0.0.1:8794'}});
   const metadata=await sharp(Buffer.from(await media.arrayBuffer())).metadata();
   expect([metadata.width,metadata.height]).toEqual([channelVisuals[channel].width,channelVisuals[channel].height]);
   if(channelVisuals[channel].cover){
    const response=await app.request(`${base}/api/media/${saved.wechatCover.fileName}`,{headers:{host:'127.0.0.1:8794'}});
    const cover=await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect([cover.width,cover.height]).toEqual([channelVisuals[channel].cover.width,channelVisuals[channel].cover.height]);
    expect(saved.wechatCover.fileName).not.toBe(saved.images[0].fileName);
    const {sortedWechatBodyImages}=await import('../lib/wechat');
    expect(sortedWechatBodyImages(saved).map(item=>item.image.id)).toContain(saved.images[0].id);
   }
  }
  await call(`/drafts/${draft.id}/channel`,{channel:'xiaohongshu'});
  const saved=(await readWorkspace()).drafts.find(d=>d.id===draft.id);
  for(const channel of contentChannels)expect(saved.channelVariants[channel].title).toBe(channelLabel(channel));
 } finally {visualPlanOverride=undefined;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
},20000);


test('web outage falls back to related archived evidence with explicit limitations', async () => {
 const topic=(await readWorkspace()).topics[0];
 const before=textCalls.length;
 omitResearchTools=true;extraGeneration=true;
 try {
  const response=await call(`/topics/${topic.id}/generate`,{channel:'xiaohongshu'});
  expect(response.status).toBe(202);
  const draftId=(await response.json()).draft.id;
  const state=await waitUntil(w=>w.drafts.find(d=>d.id===draftId)?.generationRun?.status!=='运行中');
  const draft=state.drafts.find(d=>d.id===draftId);
  expect(draft.generationRun.status).toBe('完成');
  expect(draft.knowledgeContext).toContain('兜底');
  expect(draft.knowledgeContext).toContain('未获得可用网页原文');
  expect(textCalls.length).toBeGreaterThan(before);
 } finally {omitResearchTools=false;extraGeneration=false;}
});

 test('official Search Markdown is captured as original evidence without a redundant Fetch request',async()=>{
 const topic=(await readWorkspace()).topics[0];
 process.env.DEEPSEEK_API_KEY='official-test-key';extraGeneration=true;
 try {
  const r=await call(`/topics/${topic.id}/generate`,{channel:'xiaohongshu'});
  expect(r.status).toBe(202);
  const id=(await r.json()).draft.id;
  const state=await waitUntil(w=>w.drafts.find(d=>d.id===id)?.generationRun?.status!=='运行中');
  const draft=state.drafts.find(d=>d.id===id);
  expect(draft.generationRun.status).toBe('完成');
  expect(draft.knowledgeContext).toContain('official-test.example');
  expect(draft.knowledgeContext).not.toContain('本轮未获得可用网页原文');
 }finally{process.env.DEEPSEEK_API_KEY='mock-only';extraGeneration=false;}
 });

test('regeneration response immediately drops selected old visuals and preserves unselected text',async()=>{
 const topic=(await readWorkspace()).topics[0];
 const draft=(await (await call(`/topics/${topic.id}/draft`,{})).json()).draft;
 await updateWorkspace(w=>{
  const d=w.drafts.find(d=>d.id===draft.id);
  d.title=topic.title;d.body='工具执行必须先得到明确授权。';d.tags='#AI';
  d.images=[{id:'old',fileName:'old-regeneration.png',title:'旧图',role:'正文',prompt:'',createdAt:new Date().toISOString()}];
  d.imageFile='old-regeneration.png';
 });
 const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='mock-only';
 extraGeneration=true;
 visualPlanOverride={images:[]};
 try{
  const response=await call(`/drafts/${draft.id}/regenerate`,{selections:[{channel:'xiaohongshu',content:false,images:true}]});
  expect(response.status).toBe(202);
  const payload=await response.json();
  expect(payload.draft.images).toEqual([]);
  expect(payload.draft.imageFile).toBeUndefined();
  expect(payload.draft.body).toBe('工具执行必须先得到明确授权。');
  expect(payload.draft.tags).toBe('#AI');
  const state=await waitUntil(w=>w.drafts.find(d=>d.id===draft.id).generationRun?.status!=='运行中');
  const saved=state.drafts.find(d=>d.id===draft.id);
  expect(saved.generationRun.status).toBe('完成');
  expect(saved.images).toEqual([]);
  expect(saved.wechatCover).toBeUndefined();
 } finally{visualPlanOverride=undefined;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});

test('cover-only regeneration preserves illustrations and content',async()=>{
 const topic=(await readWorkspace()).topics[0];
 const draft=(await (await call(`/topics/${topic.id}/draft`,{})).json()).draft;
 await updateWorkspace(w=>{const d=w.drafts.find(d=>d.id===draft.id);d.title=topic.title;d.body='工具执行必须先得到明确授权。';d.images=[{id:'keep',fileName:'keep-body.png',title:'保留插图',role:'正文',prompt:'',createdAt:new Date().toISOString()}];});
 const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='mock-only';extraGeneration=true;
 try{
 const response=await call(`/drafts/${draft.id}/regenerate`,{selections:[{channel:'xiaohongshu',content:false,cover:true,images:false}]});
 expect(response.status).toBe(202);
 const payload=await response.json();expect(payload.draft.images[0].id).toBe('keep');
 const state=await waitUntil(w=>w.drafts.find(d=>d.id===draft.id).generationRun?.status!=='运行中');
 const saved=state.drafts.find(d=>d.id===draft.id);
 expect(saved.generationRun.status).toBe('完成');expect(saved.wechatCover.fileName).toBeTruthy();
 expect(saved.images[0].id).toBe('keep');expect(saved.body).toBe('工具执行必须先得到明确授权。');
 }finally{if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});

test('video script generation uses distilled narrative and ManimGL guidance, saving a separate summary before rendering',async()=>{
 const topic=(await readWorkspace()).topics[0];
 const draft=(await (await call(`/topics/${topic.id}/draft`,{})).json()).draft;
 const before=textCalls.length;
 extraGeneration=true;
 channelGeneration=async()=>Response.json({choices:[{message:{content:JSON.stringify({...modelDraft,wechatSummary:'先明确授权，再让智能体执行。'+'说明边界。'.repeat(30)})}}]});
 try {
  const response=await call(`/drafts/${draft.id}/regenerate`,{selections:[{channel:'video',content:true,cover:false,images:false}]});
  expect(response.status).toBe(202);
  const state=await waitUntil(w=>w.drafts.find(d=>d.id===draft.id)?.channelVariants.video?.body && w.drafts.find(d=>d.id===draft.id)?.generationRun?.status!=='运行中');
  const saved=state.drafts.find(d=>d.id===draft.id);
  expect(saved.channelVariants.video.body).toBe(modelDraft.body);
  expect(saved.channelVariants.video.wechatSummary).toStartWith('先明确授权，再让智能体执行。');expect([...saved.channelVariants.video.wechatSummary].length).toBeLessThanOrEqual(120);
  expect(saved.video).toBeUndefined();
  const prompt=textCalls.slice(before).find(c=>c.messages[0].content.includes('draft-studio-manimgl-video')).messages[0].content;
  expect(prompt).toContain('起承转合');expect(prompt).toContain('manimgl-best-practices');expect(prompt).toContain('共鸣');expect(prompt).toContain('先产出创作卡');expect(prompt).toContain('设计ManimGL解释性动画');
 } finally {channelGeneration=undefined;extraGeneration=false;}
});


test('Manim article illustration renders without image-model calls when cover is excluded',async()=>{
 const draft=(await (await call(`/topics/${(await readWorkspace()).topics[0].id}/draft`,{})).json()).draft;
 await updateWorkspace(w=>{w.drafts.find(d=>d.id===draft.id).body='工具执行必须先得到明确授权。';});
 const before=imageCalls.length;const old=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;extraGeneration=true;
 visualPlanOverride={images:[{kind:'illustration',renderer:'manim',title:'明确授权',lead:'工具执行必须先得到明确授权。',claim:'执行前授权',valueReason:'对象与授权关系解释',evidenceQuotes:['工具执行必须先得到明确授权。']}]};
 try{
  expect((await call(`/drafts/${draft.id}/images`,{model:'gpt-image-2.5-flare',cover:false})).status).toBe(202);
  const w=await waitUntil(w=>w.drafts.find(d=>d.id===draft.id).visualRun?.status!=='运行中');const saved=w.drafts.find(d=>d.id===draft.id);
  expect({status:saved.visualRun.status,error:saved.visualRun.error}).toEqual({status:'完成',error:undefined});expect(saved.images[0].origin).toBe('derived');expect(saved.images[0].notice).toContain('ManimGL');expect(imageCalls.length).toBe(before);
  const retainedFile=saved.images[0].fileName;
  mutateIllustrationDraft=async()=>{await updateWorkspace(w=>{w.drafts.find(d=>d.id===draft.id).body+='内容已更新。';});};
  expect((await call(`/drafts/${draft.id}/images`,{model:'gpt-image-2.5-flare',cover:false})).status).toBe(202);
  const stale=await waitUntil(w=>w.drafts.find(d=>d.id===draft.id).visualRun?.status!=='运行中');
  expect(stale.drafts.find(d=>d.id===draft.id).visualRun.error).toContain('生成期间变化');
  expect(stale.drafts.find(d=>d.id===draft.id).images[0].fileName).toBe(retainedFile);
  mutateIllustrationDraft=undefined;
  expect((await call(`/drafts/${draft.id}/regenerate`,{selections:[{channel:'xiaohongshu',content:false,cover:false,images:true}]})).status).toBe(202);
  const regenerated=await waitUntil(w=>w.drafts.find(d=>d.id===draft.id).generationRun?.status!=='运行中');
  expect(regenerated.drafts.find(d=>d.id===draft.id).generationRun.status).toBe('完成');expect(imageCalls.length).toBe(before);
 }finally{mutateIllustrationDraft=undefined;visualPlanOverride=undefined;extraGeneration=false;if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;}
});


test('video writing repairs malformed fields once and preserves the independent short cover title',async()=>{
 const topic=(await readWorkspace()).topics[0];
 const longTitle='北大团队把89.5dB动态范围模拟前端压到4.54μW：多尺度神经接口SoC对植入式BCI意味着什么';
 await updateWorkspace(w=>{w.topics.find(t=>t.id===topic.id).title=longTitle;});
 const draft=(await (await call(`/topics/${topic.id}/draft`,{})).json()).draft;
 extraGeneration=true;let calls=0;
 const run=async()=>{expect((await call(`/drafts/${draft.id}/regenerate`,{selections:[{channel:'video',content:true,cover:false,images:false}]})).status).toBe(202);return waitUntil(w=>w.drafts.find(d=>d.id===draft.id).generationRun?.status!=='运行中');};
 try{
  channelGeneration=async body=>{calls++;if(calls===2){expect(body.messages.at(-1).content).toContain('coverTitle');expect(body.messages.at(-2).content).toContain(longTitle);}return Response.json({choices:[{message:{content:JSON.stringify({...modelDraft,title:longTitle,coverTitle:calls===1?longTitle:'低功耗不等于植入可用'})}}]});};
  let state=await run();let saved=state.drafts.find(d=>d.id===draft.id);expect(saved.generationRun.status).toBe('完成');expect(calls).toBe(2);expect(saved.channelVariants.video.title).toBe(longTitle);expect(saved.channelVariants.video.coverTitle).toBe('低功耗不等于植入可用');
  calls=0;channelGeneration=async()=>{calls++;return Response.json({choices:[{message:{content:calls===1?'{"body":':JSON.stringify({...modelDraft,title:longTitle,coverTitle:'检查证据边界'})}}]});};
  state=await run();expect(calls).toBe(2);expect(state.drafts.find(d=>d.id===draft.id).generationRun.status).toBe('完成');
  calls=0;channelGeneration=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({...modelDraft,title:longTitle,coverTitle:longTitle})}}]});};
  state=await run();saved=state.drafts.find(d=>d.id===draft.id);expect(calls).toBe(2);expect(saved.generationRun.error).toContain('coverTitle');expect(saved.generationRun.error).toContain('一次结构修订');
 }finally{channelGeneration=undefined;extraGeneration=false;}
});
