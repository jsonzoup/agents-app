import { test, expect } from 'bun:test';
import { distinctArticleSources, deepInquiryRules } from '../lib/article-research';

test('research counts read documents once despite tracking URLs, excluding candidates and empty records', () => {
 const source={id:'a',kind:'资料摘录',facts:'有据可查',excerpt:'',url:'https://example.com/report?utm_source=a#top'};
 expect(distinctArticleSources([source,{...source,id:'b',url:'https://example.com/report'}, {...source,id:'c',kind:'候选链接'}, {...source,id:'d',facts:''}, {...source,id:'e',url:'https://other.example.com/review'}]).map(s=>s.id)).toEqual(['a','e']);
 expect(deepInquiryRules).toContain('转载、同一公告的转述不算独立验证');
 expect(deepInquiryRules).toContain('情景、畅想、趋势预测与已发生事实分开');
});
