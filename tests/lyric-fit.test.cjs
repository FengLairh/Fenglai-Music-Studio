const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../ui/score-model.js');
const header=S.newScore(1).split('% verse')[0];
const block=(name,notes='C8 D8 E8 G8|')=>`% ${name}\nV: Vocal\n${notes}\nV: Ins\nZ|\n`;

test('repeated choruses map separately and missing verses never spill into a chorus',()=>{
 const doc=S.assertValid(header+block('verse')+block('chorus')+block('interlude','Z|')+block('chorus')+block('outro','Z|'));
 const lyrics='[Verse 1]\n晚风轻吹\n[Verse 2]\n未安排词\n[Chorus]\n星光闪烁\n[Chorus]\n再次相逢\n[Outro]\n慢慢变老';
 const fit=S.lyricFit(doc,lyrics),binding=S.align(doc,lyrics);
 assert.deepEqual(binding.slots.map(s=>s[0]),[...'晚风轻吹星光闪烁再次相逢']);
 assert.ok(fit.warnings.some(w=>w.includes('Verse 2')&&w.includes('挤字')));
 assert.ok(fit.warnings.some(w=>w.includes('Outro')&&w.includes('没有新的演唱')));
 assert.ok(S.validBinding(binding,doc,lyrics));
 const edited=S.editLyric(doc,lyrics,binding,4,'月');assert.ok(S.validBinding(edited.binding,doc,edited.lyrics));assert.ok(edited.lyrics.includes('未安排词'));
});

test('lyric overflow remains in the text and is not assigned to another section',()=>{
 const doc=S.assertValid(header+block('verse')+block('chorus'));
 const lyrics='[Verse]\n一二三四五六\n[Chorus]\n七八九十';const binding=S.align(doc,lyrics);
 assert.deepEqual(binding.slots.map(s=>s[0]),[...'一二三四七八九十']);assert.ok(S.lyricFit(doc,lyrics).warnings.some(w=>w.includes('挤字')));
 assert.equal(lyrics.slice(binding.slots[4][1],binding.slots[4][2]),'七');
});

test('counts merge ties and keep instrumental sections and missing labels explicit',()=>{
 const doc=S.assertValid(header+block('intro','Z|')+block('verse','C8-C8 D8 E8|')+block('outro','Z|'));
 const fit=S.lyricFit(doc,'[Verse]\n风吹来');assert.equal(fit.sections[0].noteIndices.length,3);assert.deepEqual(fit.warnings,[]);
 assert.equal(S.lyricFit(doc,'自由创作的词').named,false);
 const unlabelled=S.assertValid((header+block('verse')).replace('% verse\n',''));assert.equal(S.lyricFit(unlabelled,'[Chorus]\n月光如水').named,false);
});

test('unassigned pickup slots remain valid through later deletion, growth and editing',()=>{
 const doc=S.assertValid(header+block('intro','z24 C4 D4|')+block('verse')+block('outro','Z|'));
 const lyrics='[Verse]\n黄昏微风\n[Outro]\n慢慢变老';
 assert.ok(S.lyricFit(doc,lyrics).warnings.some(w=>w.includes('弱起')));
 for(const word of ['暮色','_']){
  const a=S.editLyric(doc,lyrics,S.align(doc,lyrics),2,word);assert.ok(S.validBinding(a.binding,doc,a.lyrics));
  const b=S.editLyric(doc,a.lyrics,a.binding,0,'前');assert.ok(S.validBinding(b.binding,doc,b.lyrics));assert.ok(b.lyrics.endsWith('慢慢变老'));
 }
});

test('explicit section numbers are respected and reversed order is reported',()=>{
 const doc=S.assertValid(header+block('verse 1')+block('verse 2'));
 const lyrics='[Verse 2]\n二段歌词\n[Verse 1]\n一段歌词';const fit=S.lyricFit(doc,lyrics);
 assert.equal(fit.sections[0].scoreIndex,1);assert.equal(fit.sections[1].scoreIndex,-1);assert.ok(fit.warnings.length>0);
 const forward=S.align(doc,'[Verse 1]\n一段歌词\n[Verse 2]\n二段歌词');assert.deepEqual(forward.slots.map(s=>s[0]),[...'一段歌词二段歌词']);
});

test('a native unnumbered span can contain two consecutive lyric verses without false missing-section errors',()=>{
 const doc=S.assertValid(header+'% verse\nV: Vocal\nC8 D8 E8 G8|A8 G8 E8 D8|\nV: Ins\nZ2|');
 const lyrics='[Verse 1]\n春风吹来\n[Verse 2]\n花香满街';const fit=S.lyricFit(doc,lyrics);
 assert.deepEqual(fit.warnings,[]);assert.equal(fit.sections.length,1);assert.equal(fit.sections[0].units.length,8);
 assert.deepEqual(S.align(doc,lyrics).slots.map(s=>s[0]),[...'春风吹来花香满街']);
});
