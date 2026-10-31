import {test,expect} from 'bun:test';
import {groundedVisualPlan,visualPlanningRules} from '../lib/visual-plan';
import {articleVisualStyle,selectVisualArtDirection,visualArtDirections} from '../lib/visual-art-directions';
import {selectVisualTheme} from '../lib/visual-themes';
import {buildDraftPromptSpec,selectVisualPromptTemplate,formatDraftPromptSpec} from '../lib/visual-prompt-library';

const body='工具执行前必须取得明确授权。测试成功率为82%，样本100项，仅适用于只读任务。写入操作需要人工复核。';
const page={kind:'slide',title:'执行权限独立于推理',lead:'先确认权限，再执行工具。',claim:'工具执行需要授权',valueReason:'解释推理到行动之间的授权边界',evidenceQuotes:['工具执行前必须取得明确授权。']};
test('count follows grounded independent information rather than page quota',()=>{
 expect(groundedVisualPlan({images:[]},body).images).toHaveLength(0);
 expect(groundedVisualPlan({images:[page]},body).images).toHaveLength(1);
 expect(groundedVisualPlan({images:[page,{...page,title:'换个标题'}]},body).images).toHaveLength(1);
 expect(groundedVisualPlan({images:[page,{...page,claim:'换个结论措辞'}]},body).images).toHaveLength(1);
 expect(groundedVisualPlan({images:[page,{...page,claim:'人工复核',evidenceQuotes:['写入操作需要人工复核。']}]},body).images).toHaveLength(2);
});
test('rejects ungrounded claims, numeric substrings and mismatched metric labels',()=>{
 expect(groundedVisualPlan({images:[{...page,evidenceQuotes:['不存在的原文']}]},body).images).toHaveLength(0);
 expect(groundedVisualPlan({images:[{...page,title:'成功率提高99%'}]},body).images).toHaveLength(0);
 const chart={...page,kind:'chart',title:'测试成功率',lead:'仅适用于只读任务',evidenceQuotes:['测试成功率为82%，样本100项，仅适用于只读任务。'],metrics:[{value:'82%',label:'成功率',detail:'100项只读任务'}]};
 expect(groundedVisualPlan({images:[chart]},body).images).toHaveLength(1);
 expect(groundedVisualPlan({images:[{...chart,metrics:[{value:'8',label:'成功率'}]}]},body).images).toHaveLength(0);
 expect(groundedVisualPlan({images:[{...chart,metrics:[{value:'82%',label:'收入'}]}]},body).images).toHaveLength(0);
 expect(()=>groundedVisualPlan({images:[{}]},body)).toThrow();
});
test('oversized copy requests revision instead of truncating conditions',()=>{
 const longLead='背景说明。'.repeat(20)+'但不能用于写入操作。';
 expect(()=>groundedVisualPlan({images:[{...page,lead:longLead}]},body)).toThrow('不得截断');
});
test('sixteen art recipes remain stable through rewrites and channel changes',()=>{
 const draft={id:'article-17',title:'AI 产品',body,channel:'xiaohongshu'};
 const changed={...draft,title:'新标题',body:'完全不同的正文',channel:'wechat'};
 expect(selectVisualArtDirection(draft)).toEqual(selectVisualArtDirection(changed));
 expect(selectVisualTheme(draft)).toEqual(selectVisualTheme(changed));
 expect(articleVisualStyle(draft,selectVisualTheme(draft))).toBe(articleVisualStyle(changed,selectVisualTheme(changed)));
 expect(selectVisualTheme({...changed,visualThemeId:'forest'}).id).toBe('forest');
 expect(new Set(Array.from({length:256},(_,i)=>selectVisualArtDirection({id:`article-${i}`})[0])).size).toBe(16);
 expect(visualArtDirections).toHaveLength(16);
 expect(selectVisualPromptTemplate(draft)).toEqual(selectVisualPromptTemplate(changed));
 expect(new Set(Array.from({length:128},(_,i)=>selectVisualPromptTemplate({...draft,id:`article-${i}`} ).id)).size).toBe(5);
});
test('model-facing planning rules and compiled prompt keep value ahead of styling',()=>{
 expect(visualPlanningRules).toMatchSnapshot();
 const draft={id:'article-17'};
 const spec=buildDraftPromptSpec({template:selectVisualPromptTemplate(draft),concept:'权限边界',role:'机制解释',index:1,total:2,themeLabel:'森林编辑',channel:'xiaohongshu',kind:'background'});
 spec.visualStyle=articleVisualStyle(draft,selectVisualTheme(draft));
 expect(formatDraftPromptSpec(spec)).toMatchSnapshot();
 expect(spec.composition).not.toContain('情绪落点');
});

test('omits empty closing art while preserving meaningful illustrations', () => {
 const art = {...page, kind:'illustration', prompt:'用两道关卡解释授权与复核'};
 expect(groundedVisualPlan({images:[{...art,title:'',lead:'',points:[]}]},body).images).toHaveLength(0);
 expect(groundedVisualPlan({images:[{...art,title:'感谢阅读'}]},body).images).toHaveLength(0);
 expect(groundedVisualPlan({images:[art]},body).images[0].kind).toBe('illustration');
});
test('short content does not become a padded carousel and longer content stays below six pages', () => {
 const quotes=Array.from({length:7},(_,i)=>`第${i+1}项证据说明不同工具必须先取得权限。`);
 const pages=quotes.map((quote,i)=>({...page,title:`权限条件${i+1}`,claim:quote,evidenceQuotes:[quote]}));
 const short=quotes.join('');
 expect(groundedVisualPlan({images:pages},short).images).toHaveLength(2);
 expect(groundedVisualPlan({images:pages},short+'背景资料。'.repeat(400)).images).toHaveLength(6);
});

test('excess model points require revision without dropping the final boundary', () => {
 const quotes=['工具执行前必须取得明确授权。','写入操作需要人工复核。','测试成功率为82%，样本100项，仅适用于只读任务。'];
 const pages=quotes.map((quote,index)=>({...page,claim:quote,evidenceQuotes:[quote],points:index===2?['执行前授权','写入须复核','只读有边界','不可自动写入']:[]}));
 expect(()=>groundedVisualPlan({images:pages},body+'补充背景。'.repeat(40))).toThrow('不得截断');
 expect(()=>groundedVisualPlan({images:[{...page,points:['有效',null]}]},body)).toThrow();
});

test('excess metrics, evidence and proposed pages are normalized without weakening grounding', () => {
 const quote='测试成功率为82%，样本100项，仅适用于只读任务。';
 const chart={...page,kind:'chart',evidenceQuotes:Array(5).fill(quote),metrics:Array(5).fill({value:'82%',label:'成功率'})};
 expect(()=>groundedVisualPlan({images:[chart]},body)).toThrow('不得截断');
 const quotes=Array.from({length:9},(_,i)=>`第${i+1}条工具权限必须独立复核。`);
 const pages=quotes.map(quote=>({...page,claim:quote,evidenceQuotes:[quote]}));
 expect(groundedVisualPlan({images:pages},quotes.join('')+'背景资料。'.repeat(400)).images).toHaveLength(6);
 expect(groundedVisualPlan({images:[{...chart,metrics:chart.metrics.slice(0,4),evidenceQuotes:[quote,'不存在的证据']}]},body).images).toHaveLength(0);
});

test('article template locks overrides and compiles per-page layout instructions', () => {
 const draft={id:'article-17',imagePromptTemplateId:'document-publishing'};
 expect(selectVisualPromptTemplate(draft).id).toBe('document-publishing');
 const spec=buildDraftPromptSpec({template:selectVisualPromptTemplate(draft),concept:'授权条件',role:'解释',index:0,total:1,themeLabel:'森林',channel:'wechat',kind:'background',layout:'hero_illustration'});
 expect(spec.composition).toContain('hero_illustration');
 expect(groundedVisualPlan({images:[{...page,layout:'text_card'}]},body).images[0].layout).toBe('text_card');
 expect(groundedVisualPlan({images:[{...page,kind:'illustration',prompt:'权限关卡'}]},body).images[0].layout).toBe('hero_illustration');
});

test('body first page is not treated as a cover', () => {
 const input={template:selectVisualPromptTemplate({id:'article-17'}),concept:'授权边界',role:'解释',index:0,total:2,themeLabel:'森林',channel:'xiaohongshu',kind:'background'};
 expect(buildDraftPromptSpec(input).composition).not.toContain('封面级');
 expect(buildDraftPromptSpec({...input,purpose:'cover'}).composition).toContain('封面级');
});
