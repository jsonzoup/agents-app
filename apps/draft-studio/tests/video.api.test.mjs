// Isolated process: use a temporary workspace and renderer stub, never user data or paid APIs.
import { test, expect, mock, afterAll } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { videoSourceText } from '../lib/video';
import { videoContextDigest } from '../server/video-director';
const temp=await mkdtemp(path.join(tmpdir(),'video-api-'));
const previous=process.env.DRAFT_STUDIO_HOME;
const previousImageKey=process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY='mock-only';
const originalFetch=globalThis.fetch;
const imageCalls=[];
const png=(await sharp({create:{width:1080,height:1920,channels:3,background:'#10252b'}}).png().toBuffer()).toString('base64');
globalThis.fetch=async(url,options)=>{
 if(String(url).endsWith('/v1/images/generations')){imageCalls.push(JSON.parse(options.body));return Response.json({data:[{b64_json:png}]});}
 throw Error('Unexpected external request in isolated video test');
};
process.env.DRAFT_STUDIO_HOME=temp;
mock.module('../lib/harness',()=>({runHarnessResearch:async(prompt,on)=>{
 for(const name of ['grill-with-docs','humanizer-zh']){on({kind:'tool_call',tool:'skill',callId:name,input:{name}});on({kind:'tool_result',tool:'skill',callId:name,status:'completed'});}
 return JSON.stringify({passed:true,issues:[],limitation:'接口测试未目视'});
}}));
const renderer=await import('../server/video');
let release, fail=false, rendererCover;
mock.module('../server/video',()=>({...renderer, renderDraftVideo:async(draft,media,runtime,options)=>{
  rendererCover=draft.wechatCover;
  await new Promise(resolve=>{release=resolve;});
  if(fail)throw new Error('测试：OpenGL不可用');
  const stem=`video_${randomUUID()}`;
  const files={fileName:stem+'.mp4',subtitleFile:stem+'.srt',planFile:stem+'.json',projectFile:stem+'.zip'};
  await writeFile(path.join(media,files.fileName),Buffer.alloc(1000,1));
  await writeFile(path.join(media,files.subtitleFile),'1\n00:00:00,000 --> 00:00:03,000\n原文');
  await writeFile(path.join(media,files.planFile),'{}');
  const project=new JSZip();project.file('scene.py','from manimlib import *\nclass DraftVideoScene(Scene): pass');project.file('SKILL.md','actual skill');project.file('custom_config.yml','camera: {}');await writeFile(path.join(media,files.projectFile),await project.generateAsync({type:'nodebuffer'}));
  return {...files,engine:'dsh-manim',contextDigest:videoContextDigest(options.input),sourceText:videoSourceText(draft),duration:3,createdAt:new Date().toISOString()};
}}));
const {app}=await import('../server/app');
const {readWorkspace,updateWorkspace}=await import('../lib/store');
const base='http://127.0.0.1:8794';
const session=await app.request(base+'/api/session',{headers:{host:'127.0.0.1:8794'}});
const {token}=await session.json();
const call=(route,method='GET',body)=>app.request(base+'/api'+route,{method,headers:{host:'127.0.0.1:8794',origin:base,'x-draft-studio-token':token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const wait=async check=>{for(let i=0;i<100;i++){const d=(await readWorkspace()).drafts[0];if(check(d))return d;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
afterAll(async()=>{globalThis.fetch=originalFetch;if(previousImageKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousImageKey;release?.();if(previous===undefined)delete process.env.DRAFT_STUDIO_HOME;else process.env.DRAFT_STUDIO_HOME=previous;await rm(temp,{recursive:true,force:true});});

test('video channel persists independently, renders asynchronously, blocks mutation, exports and detects stale text',async()=>{
 await updateWorkspace(w=>w.topics.push({id:'topic-test',title:'谁来核对',direction:'AI 产品',thesis:'证据约束',readerValue:'判断',sourceIds:[],status:'待评估',createdAt:new Date().toISOString()}));
 const created=await (await call('/topics/topic-test/draft','POST',{})).json();
 const id=created.draft.id;
 expect((await call(`/drafts/${id}/channel`,'POST',{channel:'video'})).status).toBe(200);
 expect((await call(`/drafts/${id}/video`,'POST',{})).status).toBe(400);
 await call(`/drafts/${id}`,'PUT',{title:'谁来核对',coverTitle:'有证据再判断',body:'模型能更快回答。核对事实不能省。',wechatSummary:'效率与判断。'});
 const responses=await Promise.all([call(`/drafts/${id}/video`,'POST',{}),call(`/drafts/${id}/video`,'POST',{})]);
 expect(responses.map(r=>r.status).sort()).toEqual([202,409]);
 for(const [route,method,body] of [[`/drafts/${id}`,'PUT',{body:'错误覆盖'}],[`/drafts/${id}`,'DELETE'],[`/drafts/${id}/channel`,'POST',{channel:'wechat'}]])expect((await call(route,method,body)).status).toBe(409);
 expect((await call("/topics/topic-test","DELETE")).status).toBe(409);
 for(let i=0;!release&&i<100;i++)await new Promise(r=>setTimeout(r,10));
 release();
 const done=await wait(d=>d.videoRun?.status==='完成');
 expect(done.wechatCover.fileName).toEndWith('.png');
 expect(done.wechatCover.origin).toBe('ai');
 expect(rendererCover.fileName).toBe(done.wechatCover.fileName);
 expect(imageCalls).toHaveLength(1);
 expect(imageCalls[0].model).toBe(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare');
 expect(imageCalls[0].size).toBe('1024x1536');
 expect(imageCalls[0].prompt).toContain('9:16竖屏封面');
 expect(imageCalls[0].prompt).not.toContain('不要画竖版海报');
 const coverMetadata=await sharp(await readFile(path.join(temp,'media',done.wechatCover.fileName))).metadata();
 expect([coverMetadata.width,coverMetadata.height]).toEqual([1080,1920]);
 expect(done.video.sourceText).toBe(videoSourceText(done));
 const video=await app.request(base+'/api/videos/'+done.video.fileName,{headers:{host:'127.0.0.1:8794',range:'bytes=100-199'}});
 expect(video.status).toBe(206);expect(video.headers.get('content-range')).toBe('bytes 100-199/1000');expect((await video.arrayBuffer()).byteLength).toBe(100);
 const invalid=await app.request(base+'/api/videos/'+done.video.fileName,{headers:{host:'127.0.0.1:8794',range:'bytes=1000-'}});expect(invalid.status).toBe(416);
 const packageResponse=await call(`/drafts/${id}/package`);
 expect(packageResponse.status).toBe(200);
 const zip=await JSZip.loadAsync(await packageResponse.arrayBuffer());
 for(const name of ['video.mp4','subtitles.srt','cover.png','plan.json','scene.py','SKILL.md','custom_config.yml','发布文案.txt'])expect(zip.file(name)).not.toBeNull();
 expect(await zip.file('发布文案.txt').async('string')).toContain('效率与判断。');
 await updateWorkspace(w=>{w.topics.find(t=>t.id==='topic-test').thesis='新增证据边界';});
 expect((await call(`/drafts/${id}/package`)).status).toBe(400);
 await updateWorkspace(w=>{w.topics.find(t=>t.id==='topic-test').thesis='证据约束';});
 expect((await call(`/drafts/${id}/package`)).status).toBe(200);
 await call(`/drafts/${id}/channel`,'POST',{channel:'wechat'});
 const other=(await readWorkspace()).drafts[0];expect(other.body).toBe('');
 await call(`/drafts/${id}/channel`,'POST',{channel:'video'});
 const restored=(await readWorkspace()).drafts[0];expect(restored.body).toBe(done.body);expect(restored.video.fileName).toBe(done.video.fileName);
 await call(`/drafts/${id}`,'PUT',{body:done.body+'修改。'});
 expect((await call(`/drafts/${id}/package`)).status).toBe(400);
 fail=true;release=undefined;
 expect((await call(`/drafts/${id}/video`,'POST',{})).status).toBe(202);
 for(let i=0;!release&&i<100;i++)await new Promise(r=>setTimeout(r,10));release();
 const failed=await wait(d=>d.videoRun?.status==='失败');expect(imageCalls).toHaveLength(1);expect(failed.body).toContain('修改。');expect(failed.video.fileName).toBe(done.video.fileName);
 // An upgraded legacy cover must not silently fall back when GPT Image fails.
 await updateWorkspace(w=>{w.drafts[0].wechatCover.origin='derived';});
 const savedFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response('{}',{status:401});
 try {
  expect((await call(`/drafts/${id}/video`,'POST',{})).status).toBe(202);
  const imageFailed=await wait(d=>d.videoRun?.status==='失败');
  expect(imageFailed.video.fileName).toBe(done.video.fileName);
  expect(imageFailed.videoRun.error).toContain('401');
 } finally {globalThis.fetch=savedFetch;}
 expect((await call(`/drafts/${id}`,'DELETE')).status).toBe(200);
 await expect(readFile(path.join(temp,'media',done.video.fileName))).rejects.toThrow();
});
