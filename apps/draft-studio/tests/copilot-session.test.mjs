import { test, expect } from 'bun:test';
import { blankCopilotSession, updateCopilotSession, applyCopilotResponse, applyCopilotMessages, sameCopilotMessages, submitCopilotRequest } from '../lib/copilot-session';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};};

test('article inputs, targets, asset mentions and busy state survive switching independently',()=>{
  let sessions={};
  const set=(id,key,value)=>{sessions=updateCopilotSession(sessions,id,key,value);};
  set('a','input','A input');set('a','target','image');set('a','mentions',['a-image']);set('a','open',true);set('a','mentionOpen',true);set('a','submitting',true);
  expect(sessions.b??blankCopilotSession()).toEqual(blankCopilotSession());
  set('b','input','B input');set('b','target','body');set('b','open',true);
  expect(sessions.b.submitting).toBe(false);
  set('a','input','');set('a','mentions',[]);set('a','submitting',false);
  expect(sessions.b).toEqual({...blankCopilotSession(),input:'B input',target:'body',open:true});
  expect(sessions.a.target).toBe('image');
  set('b','input',value=>value+' continued');
  expect(sessions.b.input).toBe('B input continued');
});

test('delayed save and submit responses cannot switch articles or overwrite the other article, even in reverse order',async()=>{
  const a={id:'a',title:'A',copilotMessages:[]},b={id:'b',title:'B',copilotMessages:[]};
  let editing=a;
  const save=deferred(),postA=deferred(),postB=deferred();
  const calls=[];
  const call=async(route,method,body)=>{
    calls.push({route,method,body});
    if(method==='PUT')return save.promise;
    return route==='/drafts/a/copilot'?postA.promise:postB.promise;
  };
  const receive=response=>{editing=applyCopilotResponse(editing,response);};
  const first=submitCopilotRequest(a,true,{message:'A request',target:'image',mentions:['A image']},call,receive);
  editing=b;
  const second=submitCopilotRequest(b,false,{message:'B request',target:'body',mentions:[]},call,receive);
  save.resolve({draft:{...a,title:'A saved'}});
  await Promise.resolve();await Promise.resolve();
  expect(editing).toBe(b);
  postB.resolve({draft:{...b,copilotMessages:['B only']}});
  await second;
  postA.resolve({draft:{...a,copilotMessages:['A only']}});
  await first;
  expect(editing.id).toBe('b');
  expect(editing.copilotMessages).toEqual(['B only']);
  expect(calls.find(c=>c.route==='/drafts/a/copilot').body).toEqual({message:'A request',target:'image',mentions:['A image']});
  editing=null;receive(a);expect(editing).toBeNull();
});

test('live Copilot progress merges by article without replacing locally edited draft fields',()=>{
  const running=[{id:'assistant',role:'assistant',text:'正在理解…',status:'运行中',toolEvents:[{id:'context',action:'get_context',status:'运行中'}]}];
  const completed=[{...running[0],toolEvents:[{id:'context',action:'get_context',status:'完成'},{id:'title',action:'replace_title',status:'运行中'}]}];
  const editing={id:'article-a',title:'unsaved title',body:'unsaved body',copilotMessages:running};
  expect(sameCopilotMessages(running,completed)).toBe(false);
  const updated=applyCopilotMessages(editing,{id:'article-a',copilotMessages:completed});
  expect(updated).toMatchObject({id:'article-a',title:'unsaved title',body:'unsaved body',copilotMessages:completed});
  expect(applyCopilotMessages({...editing,id:'article-b'}, {id:'article-a',copilotMessages:completed})).toMatchObject({id:'article-b',copilotMessages:running});
  expect(applyCopilotMessages(updated,{id:'article-a',copilotMessages:completed})).toBe(updated);
});
