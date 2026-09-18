const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../ui/score-model.js'),P=require('../ui/lyric-plan.js');
const head=S.newScore(1).split('% verse')[0],block=(name,notes)=>`% ${name}\nV: Vocal\n${notes}\nV: Ins\nZ|\n`;
const score=()=>S.assertValid(head+block('intro','Z|')+block('verse','C8-C8 D4 z4 E8|')+block('chorus','F8 G8 A8 B8|')+block('interlude','Z|')+block('chorus','F8 G8 A8 B8|')+block('outro','Z|'));
const response=plan=>plan.phrases.map(p=>({id:p.id,syllables:p.notes.map(()=> '风')}));
test('phrase plan merges ties, splits at rests, distinguishes repeated choruses and omits instrumental bars',()=>{
 const doc=score(),p=P.create(doc);assert.equal(p.phrases.length,4);assert.deepEqual(p.phrases.map(x=>[x.section,x.notes.length]),[['verse',2],['verse',1],['chorus',4],['chorus',4]]);assert.equal(p.phrases[0].notes[0].beats,2);assert.equal(p.phrases[1].notes[0].bar,2);
 const r=response(p);r[0].syllables=['春','_'];r[1].syllables=['来'];r[2].syllables=['月','光','_','亮'];r[3].syllables=['心','中','有','你'];const fit=P.apply(doc,'',null,r);
 assert.equal(fit.lyrics,'[verse]\n春\n来\n\n[chorus]\n月光亮\n\n[chorus]\n心中有你');assert.equal(fit.summary.holds,2);assert.equal(fit.binding.slots[1][0],'_');assert.equal(fit.binding.slots[2][0],'来');assert.ok(S.validBinding(fit.binding,doc,fit.lyrics));assert.equal(S.lyricFit(doc,fit.lyrics).warnings.length,0);
 assert.deepEqual(P.create(doc,fit.lyrics,fit.binding).phrases.map(x=>x.notes.map(n=>n.fixed||n.units)),[[1,'hold'],[1],[1,1,'hold',1],[1,1,1,1]]);
});
test('same total count cannot conceal a word shifted across a breath, reordered phrases or missing sections',()=>{
 const doc=score(),plan=P.create(doc),r=response(plan);r[0].syllables.push(r[1].syllables.pop());assert.throws(()=>P.apply(doc,'',null,r),/p1.*需要 2 个音符槽/);
 const swapped=response(plan);[swapped[2],swapped[3]]=[swapped[3],swapped[2]];assert.throws(()=>P.apply(doc,'',null,swapped),/必须是 p3/);
 assert.throws(()=>P.apply(doc,'',null,response(plan).slice(0,-1)),/漏句/);
 for(const invalid of ['春风','', '_','风_','[Verse]','a\nb']){const bad=response(plan);bad[1].syllables=[invalid];assert.throws(()=>P.apply(doc,'',null,bad));}
});
test('explicit melismas and manually empty slots survive rewriting with precise offsets',()=>{
 const doc=S.assertValid(head+block('verse','C8 D8 E8 G8|')),lyrics='\n[Verse]\n春风';
 const b={version:1,abcStamp:S.stamp(doc.source),lyricsStamp:S.stamp(lyrics),slots:[['春',9,10],['_',10,10],['风',10,11],['',11,11]],strategy:'manual'};
 // Obtain source offsets rather than relying on the leading whitespace count.
 b.slots[0]=['春',lyrics.indexOf('春'),lyrics.indexOf('春')+1];b.slots[1]=['_',lyrics.indexOf('风'),lyrics.indexOf('风')];b.slots[2]=['风',lyrics.indexOf('风'),lyrics.length];b.slots[3]=['',lyrics.length,lyrics.length];
 assert.ok(S.validBinding(b,doc,lyrics));const p=P.create(doc,lyrics,b),r=[{id:p.phrases[0].id,syllables:['晚','_','晴','']}],a=P.apply(doc,lyrics,b,r);assert.deepEqual(a.binding.slots.map(s=>s[0]),['晚','_','晴','']);assert.ok(S.validBinding(a.binding,doc,a.lyrics));
 r[0].syllables[1]='风';assert.throws(()=>P.apply(doc,lyrics,b,r),/应保留拖腔/);
});
test('unlabelled scores, English word spacing, invalid and silent scores are explicit',()=>{
 const doc=S.assertValid((head+block('verse','C8 D8 E8 G8|')).replace('% verse\n',''));
 const fit=P.apply(doc,'',null,[{id:'p1',syllables:['Stay','_','with','me']}]);assert.equal(fit.lyrics,'[Verse]\nStay with me');assert.ok(S.validBinding(fit.binding,doc,fit.lyrics));
 assert.throws(()=>P.create(S.assertValid(S.newScore())),/只有休止符/);
 const invalid=S.parse((head+block('verse','C8 D8 E8|')));assert.throws(()=>P.create(invalid),/修正小节/);
});
test('numbered AI slots require every position exactly once and keep canonical bindings',()=>{
 const doc=S.assertValid(head+block('verse','C8 D8 E8 G8|'));
 const mapped=P.apply(doc,'',null,[{id:'p1',syllables:{4:'来',2:'风',3:'_',1:'春'}}]);assert.deepEqual(mapped.phrases[0].syllables,['春','风','_','来']);assert.equal(mapped.lyrics,'[verse]\n春风来');
 for(const words of [{1:'春',2:'风',4:'来'},{1:'春',2:'风',3:'_',4:'来',5:'呀'},{0:'春',1:'风',2:'_',3:'来'}])assert.throws(()=>P.apply(doc,'',null,[{id:'p1',syllables:words}]));
 const padding=P.apply(doc,'',null,[{id:'p1',syllables:{1:'春',2:'风',3:'_',4:'来',5:'_',6:'_'}}]);assert.equal(padding.lyrics,mapped.lyrics);assert.equal(padding.binding.slots.length,4);
 assert.throws(()=>P.apply(doc,'',null,[{id:'p1',syllables:{1:'春',2:'风',3:'_',4:'来',6:'_'}}]));
});
test('compact phrases compile text and explicit holds without changing words or musical time',()=>{
 const doc=S.assertValid(head+block('verse','C8 D8 E8 G8|'));
 const a=P.apply(doc,'',null,[{id:'p1',text:'春风来',holds:[3]}]);assert.equal(a.lyrics,'[verse]\n春风来');assert.deepEqual(a.phrases[0].syllables,['春','风','_','来']);assert.ok(S.validBinding(a.binding,doc,a.lyrics));
 const b=P.apply(doc,a.lyrics,a.binding,[{id:'p1',text:'晚风暖',holds:[]}]);assert.equal(b.binding.slots[2][0],'_');
 for(const bad of [{text:'春风来',holds:[]},{text:'春风来',holds:[1]},{text:'春风来',holds:[3,3]},{text:'春风来',holds:[5]},{text:'春风_',holds:[3]}])assert.throws(()=>P.apply(doc,'',null,[{id:'p1',...bad}]));
});
