import { test, expect } from 'bun:test';
import { selectWritingMethod, writingMethodPrompt, editorialNorthStar } from '../lib/writing-methods';

test('matches article genre and keeps news about tutorial products out of tutorial mode', () => {
 for (const [input,method] of [
  [{title:'工具上手指南',direction:'AI 产品'},'tutorial'],
  [{title:'编程工具横评',direction:'商业化'},'review'],
  [{title:'模型论文解读',direction:'学术前沿'},'research'],
  [{title:'新一轮融资背后',direction:'商业化'},'business'],
  [{title:'团队失去判断之后',direction:'AI 人文视角'},'human'],
  [{title:'新模型发布',evidence:'文档附带教程和排错指南'},'news'],
 ]) expect(selectWritingMethod(input)).toBe(method);
});
test('every method keeps the engagement backbone and evidence limits across channels', () => {
 for(const title of ['论文解读','产品评测','上手指南','融资事件','认知观察','产品发布']){
  const prompt=writingMethodPrompt({title,channel:'toutiao'});
  expect(prompt).toContain('共同传播骨架');
  expect(prompt).toContain(editorialNorthStar);
  expect(prompt).toContain('开头三行');
  expect(prompt).toContain('标题力度不得超过证据');
  expect(prompt).toContain('没有实测记录不能自称亲测');
  expect(prompt).toContain('修改时尊重作者已确认的创作卡');
 }
});

 test('method adapts audience hook and story to evidence without inventing human motivation',()=>{
 const prompt=writingMethodPrompt({title:'芯片研究',channel:'video'});
 expect(prompt).toContain('读者具体处境');expect(prompt).toContain('心理诊断');expect(prompt).toContain('不得超过证据');expect(prompt).toContain('避免机械套时间段');
 });
