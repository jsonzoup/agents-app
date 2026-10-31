import {test, expect} from 'bun:test';
import {resolveVisualEntities, visualEntities, visualEntityContext} from '../lib/visual-entities';
import {buildKnowledgeProjection} from '../lib/knowledge-model';

test('resolves Chinese and English aliases without network access',()=>{
  expect(resolveVisualEntities('英伟达 NVIDIA 与老黄的发布会')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({name:'NVIDIA',type:'公司'}),
      expect.objectContaining({name:'黄仁勋',type:'人物'}),
    ]),
  );
  expect(resolveVisualEntities('小札谈 Meta 与 OpenAI')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({name:'马克·扎克伯格'}),
      expect.objectContaining({name:'OpenAI'}),
    ]),
  );
  expect(resolveVisualEntities('普通技术文章')).toHaveLength(0);
});

test('visual context carries portrait and logo policies',()=>{
  const context=visualEntityContext({title:'OpenAI与山姆·奥特曼',body:'Meta的小札也参与讨论',visualBrief:''});
  expect(context).toContain('公开人物编辑肖像');
  expect(context).toContain('准确 Logo 必须使用用户拥有授权的本地素材');
  expect(context).toContain('https://openai.com/');
});

test('directory entities are visible in Kuzu projection without fake evidence',()=>{
  const projection=buildKnowledgeProjection({sources:[],topics:[],drafts:[],sites:[],runs:[],topicRuns:[],entities:[],relations:[],settings:{frequencyHours:24,topicsPerRun:6,topicMix:{商业化:1,科研:0,'AI 产品':0,'AI 新趋势':0,'AI 边界':0,'AI 人文视角':0,'学术前沿':0},autoCollect:false}});
  expect(projection.entities.length).toBe(visualEntities.length);
  expect(projection.entities.find(e=>e.name==='NVIDIA')).toMatchObject({sourceIds:[],type:'公司'});
  expect(projection.entities.find(e=>e.name==='OpenAI').aliases).toContain('开放AI');
});
