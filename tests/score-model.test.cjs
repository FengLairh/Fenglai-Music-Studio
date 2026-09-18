const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const S=require('../ui/score-model.js'),{validateInput,validateProposal}=require('../desktop/music-assistant.cjs');
const root=path.resolve(__dirname,'..'),header=S.newScore(1).split('% verse')[0];
const score=(v,i='Z|',head=header)=>head+'% verse\nV: Vocal\n'+v+'\nV: Ins\n'+i;
const fraction=x=>{const [n,d=1]=String(x).split('/').map(Number);return n/d;};
function oracle(abc){const dir=fs.mkdtempSync(path.join(root,'test-results/score-oracle-')),file=path.join(dir,'score.abc');fs.writeFileSync(file,abc);const r=spawnSync('python',[path.join(root,'vendor/yue2-music-skill/scripts/abc_tools.py'),'inspect',file],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr||r.stdout);return JSON.parse(r.stdout);}
const pitches=d=>d.vocal.map(n=>n.midi);
test('native pitch, cross-octave accidental and barline tie semantics match the pinned YuE oracle',()=>{
 const samples=[score('^F8 f8 =F8 f8|'),score('z24 ^F8-|F8 F8 z16|','Z2|'),score('C12 D6 E6 z8|'),score('C24|','Z|',header.replace('M:4/4','M:6/8')),score('F8 f8 F8 f8|','Z|',header.replace('K:C','K:G'))];
 for(const abc of samples){const doc=S.assertValid(abc),official=oracle(abc);for(const voice of ['Vocal','Ins'])assert.deepEqual(doc.voices[voice].events.map(n=>[n.onset,n.midi,n.duration]),official.voices[voice].notes.map(n=>[fraction(n.onset_quarters),n.midi_pitch,fraction(n.duration_quarters)]));}
 assert.deepEqual(pitches(S.assertValid(samples[0])),[66,78,65,77]);assert.deepEqual(pitches(S.assertValid(samples[1])),[66,65]);
});
test('pitch/rest edits preserve the sounding pitches of all unselected notes',()=>{
 const doc=S.assertValid(score('^F8 f8 F8 =F8|'));const changed=S.assertValid(S.changePitch(doc,0,67));assert.deepEqual(pitches(changed),[67,78,66,65]);oracle(changed.source);
 const rested=S.assertValid(S.toRest(doc,0));assert.deepEqual(pitches(rested),[78,66,65]);oracle(rested.source);
 const inserted=S.assertValid(S.restToNote(S.assertValid(score('z8 C8 C8 C8|')),0,61));assert.deepEqual(pitches(inserted),[61,60,60,60]);oracle(inserted.source);
 const tied=S.assertValid(score('z24 ^F8-|F8 F8 z16|','Z2|'));const edited=S.assertValid(S.changePitch(tied,1,68));assert.deepEqual(edited.vocal.map(n=>[n.midi,n.duration]),[[68,2],[65,1]]);oracle(edited.source);
});
test('split, tie/untie, rest expansion, bar addition and chord editing preserve native structure',()=>{
 let doc=S.assertValid(score('C16 C16|'));doc=S.assertValid(S.split(doc,0));assert.equal(doc.vocal.length,3);assert.equal(doc.voices.Vocal.time,4);
 doc=S.assertValid(S.toggleTie(doc,0));assert.equal(doc.vocal.length,2);assert.equal(doc.vocal[0].duration,2);
 doc=S.assertValid(S.toggleTie(doc,0));assert.equal(doc.vocal.length,3);
 doc=S.assertValid(S.setChord(doc,0,'Am7'));assert.ok(doc.source.includes('"Am7"'));oracle(doc.source);
 doc=S.assertValid(S.setChord(doc,0,''));assert.ok(!doc.source.includes('"Am7"'));
 const rest=S.assertValid(S.newScore());const expanded=S.assertValid(S.expandRest(rest,16));assert.equal(expanded.voices.Ins.bars.length,4);oracle(expanded.source);
 const added=S.assertValid(S.addBar(doc));assert.equal(added.voices.Vocal.bars.length,2);oracle(added.source);
 assert.throws(()=>S.toggleTie(S.assertValid(score('C16 D16|')),0),/同音高/);
});
test('unsupported notation and unbalanced measures are reported without mutating the source',()=>{
 const abc=score('C8 D8 E8 F8|'),bad=S.changeDuration(S.assertValid(abc),0,2);assert.ok(S.parse(bad).errors.length);assert.throws(()=>S.assertValid(bad),/小节/);assert.throws(()=>S.midi(S.parse(bad)));
 for(const other of [abc+'\nw: hello',abc.replace('C8','[CEG]8'),abc.replace('D8','(3DEF'),abc.replace('T:','T:Other'),abc.replace('Z|','Z2|'),S.newScore().replace('1/32','1/0'),S.newScore().replace('K:C','K:constructor')])assert.throws(()=>S.assertValid(other));
 assert.equal(S.assertValid(abc).source,abc);
});
test('visual duration edits preserve later note onsets, meter, pitches and chord locations',()=>{
 const original=S.assertValid(score('^F8 f8 F8 =F8|')),short=S.assertValid(S.resizeDuration(original,0,.5));
 assert.deepEqual(short.vocal.map(n=>[n.onset,n.midi,n.duration]),[[0,66,.5],[1,78,1],[2,66,1],[3,65,1]]);oracle(short.source);
 const restored=S.assertValid(S.resizeDuration(short,0,1));assert.deepEqual(restored.vocal.map(n=>[n.onset,n.midi,n.duration]),original.vocal.map(n=>[n.onset,n.midi,n.duration]));
 assert.throws(()=>S.resizeDuration(original,0,2),/空间不足/);assert.equal(S.assertValid(original.source).source,original.source);
 const gap=S.assertValid(score('C4 z4 z8 G16|')),long=S.assertValid(S.resizeDuration(gap,0,1.5));assert.deepEqual(long.vocal.map(n=>[n.onset,n.duration]),[[0,1.5],[2,2]]);oracle(long.source);
 assert.throws(()=>S.resizeDuration(S.assertValid(score('C8 "Am"z8 G16|')),0,2),/空间不足/);
 const rests=S.assertValid(S.resizeDuration(S.assertValid(S.newScore()),16,1));assert.equal(rests.voices.Ins.bars.length,4);assert.equal(rests.tokens.find(t=>t.voice==='Ins').duration,1);oracle(rests.source);
});
test('deleting tied notes disconnects only the affected links and preserves other pitches',()=>{
 const doc=S.assertValid(score('^F8- F8- F8 F8|'));const erased=S.assertValid(S.eraseNote(doc,1));
 assert.deepEqual(erased.vocal.map(n=>[n.onset,n.midi,n.duration]),[[0,66,1],[2,66,1],[3,66,1]]);oracle(erased.source);
 const written=S.assertValid(S.writeNote(S.assertValid(S.newScore()),16,48));assert.equal(written.voices.Ins.events[0].midi,48);assert.equal(written.voices.Ins.bars.length,4);oracle(written.source);
});
test('note insertion and deletion keep unaffected lyric slots anchored to their musical times',()=>{
 const doc=S.assertValid(score('C8 D8 E8 F8|')),lyrics='[Verse]\n夜风轻唱',binding=S.align(doc,lyrics);
 const split=S.assertValid(S.split(doc,0)),mapped=S.rebind(doc,split,binding,lyrics);assert.ok(S.validBinding(mapped,split,lyrics));assert.deepEqual(mapped.slots.map(s=>s[0]),['夜','','风','轻','唱']);
 const deleted=S.assertValid(S.eraseNote(split,2)),after=S.rebind(split,deleted,mapped,lyrics);assert.ok(S.validBinding(after,deleted,lyrics));assert.deepEqual(after.slots.map(s=>s[0]),['夜','','轻','唱']);assert.equal(lyrics,'[Verse]\n夜风轻唱');
 const t=S.assertValid(score('F8 z24|')).tokens[0];assert.equal(S.stepPitch(t,1),67);assert.equal(S.stepPitch(t,-1),64);
});
test('Chinese/English lyric editing retains tags, line breaks, unassigned text and valid sidecar ranges',()=>{
 const doc=S.assertValid(score('C8 D8 E8 F8|')),lyrics='[Verse]\n夜 风, hello world!\n[Chorus]\n未安排的词';let binding=S.align(doc,lyrics);
 assert.deepEqual(binding.slots.map(s=>s[0]),['夜','风','hello','world']);let edit=S.editLyric(doc,lyrics,binding,2,'goodbye');assert.match(edit.lyrics,/goodbye world!/);assert.match(edit.lyrics,/\[Chorus\]\n未安排的词/);assert.ok(S.validBinding(edit.binding,doc,edit.lyrics));
 edit=S.editLyric(doc,edit.lyrics,edit.binding,1,'_');assert.equal(edit.binding.slots[1][0],'_');assert.ok(S.validBinding(edit.binding,doc,edit.lyrics));
 edit=S.editLyric(doc,edit.lyrics,edit.binding,1,'雨');assert.ok(S.validBinding(edit.binding,doc,edit.lyrics));assert.match(edit.lyrics,/雨, goodbye/);
 const rendered=S.renderSource(doc,edit.binding,'夜航','Vocal');assert.match(rendered.text,/w:夜 雨 goodbye world/);assert.ok(!doc.source.includes('w:'));assert.ok(!rendered.text.includes('V: Ins'));assert.equal(rendered.renderOffsets.size,4);
 assert.equal(S.validBinding(binding,doc,lyrics+'changed'),false);assert.throws(()=>S.editLyric(doc,lyrics,binding,0,'[Chorus]'));
});
test('display accidentals are minimal while preserving native cross-octave meaning',()=>{
 const doc=S.assertValid(score('^F8 f8 =F8 f8|')),text=S.renderSource(doc,null,'','Vocal').text;assert.match(text,/\^F8 \^f8 =F8 =f8/);
 const plain=S.assertValid(S.changePitch(S.assertValid(score('C8 D8 E8 F8|')),0,60));assert.match(S.renderSource(plain,null,'','Vocal').text,/C8 D8 E8 F8/);
});
function midiEvents(bytes){const b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,4),'MThd');assert.equal(b.readUInt16BE(12),1024);let at=14;const tracks=[];while(at<b.length){assert.equal(b.toString('ascii',at,at+4),'MTrk');const end=at+8+b.readUInt32BE(at+4);at+=8;let tick=0,events=[];const vlq=()=>{let n=0,x;do{x=b[at++];n=n*128+(x&127);}while(x&128);return n;};while(at<end){tick+=vlq();const status=b[at++];if(status===255){const type=b[at++],n=vlq();if(type===81)events.push(['tempo',b.readUIntBE(at,n)]);at+=n;}else if((status&240)===192)at++;else{const pitch=b[at++],velocity=b[at++];events.push([(status&240)===144?'on':'off',tick,pitch,velocity]);}}tracks.push(events);}return tracks;}
test('MIDI exports merged ties, note-off timing, tempo and separate voice tracks',()=>{
 const doc=S.assertValid(score('C16-|C16 z16|','Z2|',header.replace('M:4/4','M:2/4')) .replace('C16 z16','C16'));
 const tracks=midiEvents(S.midi(doc));assert.equal(tracks.length,2);assert.deepEqual(tracks[0],[['tempo',750000],['on',0,60,88],['off',4096,60,0]]);assert.deepEqual(tracks[1],[]);
});
test('AI score output is native-validated and Cover preserves notes, meters, keys and tempo',()=>{
 const abc=score('C8 D8 E8 F8|'),context={title:'测试',style:'folk',lyrics:'[Verse]\n微风吹来',abc,cot:'full'},input=validateInput({mode:'cover',task:'score',brief:'增加和弦',context}),proposal={title:'测试',style:'jazz',lyrics:'变化',abc:S.setChord(S.assertValid(abc),0,'C'),notes:[]};
 const good=validateProposal(proposal,input);assert.equal(good.lyrics,context.lyrics);assert.equal(good.style,context.style);assert.match(good.abc,/"C"/);
 for(const bad of [S.changePitch(S.assertValid(abc),0,62),abc.replace('=80','=90'),abc.replace('K:C','K:Am')])assert.throws(()=>validateProposal({...proposal,abc:bad},input),/模型更改/);
 assert.throws(()=>validateProposal({...proposal,abc:abc.replace('C8','C16')},input),/模型乐谱未通过检查/);
 const created=validateProposal({...proposal,abc},{...input,mode:'create',context:{...context,abc:'',cot:'off'}});assert.equal(created.cot,'full');
});
