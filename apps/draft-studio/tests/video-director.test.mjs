import { test, expect, mock, afterAll } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
let load=true, feedback, captured, malformed=0;
const result={style:'墨色青绿品牌基调，使用流动节点解释责任分工',thesis:'速度提升不等于判断质量提升，证据仍需核对',sceneCode:'from manimlib import *\nclass DraftVideoScene(Scene):\n    def construct(self):\n        self.play(ShowCreation(Circle()), run_time=10)\n        self.play(Transform(Circle(), Square()), run_time=10)\n',scenes:[{id:'speed',explanation:'通过线索流动展示模型加速整理的作用',visualMechanism:'节点收集线索并沿路径流动到模型',narration:'模型可以更快地整理线索。',duration:10,sourceIds:['source-one']},{id:'decision',explanation:'在执行前建立核对证据与判断的关口',visualMechanism:'建议路径在关口分成核对和直接执行两条',narration:'更快不等于可靠，判断仍需要证据。',duration:10,sourceIds:['source-one']}],review:'事实仅来自输入资料，未读取图片，不声称目视检查。'};
mock.module('../lib/harness',()=>({runHarnessResearch:async(prompt,on,signal,options)=>{
 captured={prompt,options};
 const article=JSON.parse(await readFile(path.join(options.cwd,'article.json'),'utf8'));
 expect(article.title).toBe('模型更快，谁来判断');expect(article.sources[0].facts).toContain('证据');expect(article.originals[0].text).toContain('原文');expect(article.knowledgeContext).toBe('责任分工');
 const patch=JSON.parse(await readFile(options.patchFiles[1],'utf8'));
 const skill=await readFile(path.join(patch[0].config.customSkillDirs[0],'manimgl-best-practices/SKILL.md'),'utf8');expect(skill).toContain('ManimGL');
 const method=await readFile(path.join(options.cwd,'creative-method/SKILL.md'),'utf8');expect(method).toContain('视频口播');expect(prompt).toContain('creative-method/SKILL.md');
 if(load){on({kind:'tool_call',tool:'read',callId:'creative-method',input:{file_path:'creative-method/SKILL.md'}});on({kind:'tool_result',tool:'read',callId:'creative-method',status:'completed'});
 on({kind:'tool_call',tool:'skill',callId:'s',input:{name:'manimgl-best-practices'}});on({kind:'tool_result',tool:'skill',callId:'s',status:'completed'});}
 feedback=prompt;if(malformed>0){malformed--;return "invalid JSON";}return JSON.stringify(result);
}}));
const {directVideo,videoContextDigest}=await import('../server/video-director');
const roots=[];
afterAll(async()=>{await Promise.all(roots.map(root=>rm(root,{recursive:true,force:true})));});
const draft={title:'模型更快，谁来判断',body:'模型能整理线索，人需核对事实。',wechatSummary:'证据与判断',sources:'source-one',knowledgeContext:'责任分工',creativeBrief:{opening:'具体冲突'},channelVariants:{}};
const input={sources:[{id:'source-one',facts:'证据需要核对'}],originals:[{sourceId:'source-one',text:'已检索原文'}],entities:[{name:'模型'}],relations:[]};
test('DSH receives complete article research and an actual upstream skill mount; retries receive real error and prior code',async()=>{
 const work=await mkdtemp(path.join(tmpdir(),'director-test-'));roots.push(work);
 const first=await directVideo(draft,work,process.cwd(),{input});
 expect(first.sceneCode).toContain('Transform');expect(captured.options.cwd).toBe(work);expect(captured.prompt).toContain('不要生成逐句字幕卡');
 await directVideo(draft,work,process.cwd(),{input},{result:first,error:'NameError: Create is not defined'});
 expect(feedback).toContain('NameError: Create is not defined');expect(feedback).toContain(first.sceneCode.replaceAll('\n','\\n'));
 await directVideo(draft,work,process.cwd(),{input},{result:first,previewFrames:['preview-0.png']});expect(feedback).toContain('preview-0.png');
 expect(videoContextDigest(input)).not.toBe(videoContextDigest({...input,originals:[{sourceId:'source-one',text:'资料已修改'}]}));
});
test('a plausible result without a successful skill call is rejected',async()=>{
 const work=await mkdtemp(path.join(tmpdir(),'director-test-'));roots.push(work);load=false;
 try {await expect(directVideo(draft,work,process.cwd(),{input})).rejects.toThrow('未实际加载');}finally{load=true;}
});

test('invalid director JSON gets one grounded correction with the real validation error',async()=>{
 const work=await mkdtemp(path.join(tmpdir(),'director-test-'));roots.push(work);malformed=1;
 const fixed=await directVideo(draft,work,process.cwd(),{input});
 expect(fixed.thesis).toBe(result.thesis);expect(feedback).toContain('上次返回未通过响应验证');
});
