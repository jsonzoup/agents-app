import { test, expect } from 'bun:test';
import { aiTerminologyRules, withAiTerminology } from '../lib/ai-terminology';

test('adds AI vocabulary without rewriting citations, proxy meanings, names or identifiers',()=>{
  const material='AI代理；HTTP代理；统计代理指标；销售代理商；nnInteractive Agent；`userAgent`；https://example.com/agent；原文引语：“代理”。';
  const prompt=withAiTerminology(material);
  expect(prompt).toBe(`${aiTerminologyRules}\n\n${material}`);
  expect(withAiTerminology(prompt)).toBe(prompt);
  expect(aiTerminologyRules).toMatchSnapshot();
});
