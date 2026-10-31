import {test,expect} from 'bun:test';
import {parseVoiceEvents,voiceCues,voiceSrt} from '../server/video-voice';
const word={text:'证据',begin_index:0,end_index:2,begin_time:80,end_time:400};
const event=o=>'event:result\r\n'+JSON.stringify(o,null,2).split('\n').map(line=>'data:'+line).join('\r\n')+'\r\n\r\n';
test('multiline SSE deduplicates timestamps and requires completed audio',()=>{
 const sentence={index:0,words:[word]};
 const data=event({output:{sentence}})+event({output:{sentence}})+event({output:{finish_reason:'stop',audio:{url:'https://example.com/audio.wav'}}});
 expect(parseVoiceEvents(data).words).toEqual([word]);
 expect(()=>parseVoiceEvents(event({output:{sentence}}))).toThrow('不完整');
 expect(()=>parseVoiceEvents(event({code:'InvalidApiKey'}))).toThrow('InvalidApiKey');
 expect(()=>parseVoiceEvents(event({output:{sentence:{index:0,words:[{...word,end_time:0}]}}}))).toThrow('时间戳无效');
});
test('captions use actual word times plus the cover and scene offsets',()=>{
 const cues=voiceCues([word,{...word,text:'需要核对。',begin_time:500,end_time:1300,begin_index:2,end_index:7}],1);
 expect(cues).toEqual([{text:'证据需要核对。',start:1.08,end:2.3}]);
 expect(voiceSrt(cues)).toContain('00:00:01,080 --> 00:00:02,300');
});

test('punctuation prefixed to the next spoken word closes the preceding cue',()=>{
 const cues=voiceCues([
  {...word,text:'整理不等于核实',begin_time:80,end_time:1400},
  {...word,text:'。但回答',begin_time:1600,end_time:2200},
  {...word,text:'需要判断。',begin_time:2300,end_time:3300}
 ],1);
 expect(cues).toEqual([{text:'整理不等于核实。',start:1.08,end:2.4},{text:'但回答需要判断。',start:2.6,end:4.3}]);
});
