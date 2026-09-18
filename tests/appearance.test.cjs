const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Appearance,normalize,DEFAULTS}=require('../desktop/appearance.cjs');
test('theme settings reject malformed and unsafe values and never take renderer background paths',()=>{
 for(const value of [null,[],{...DEFAULTS,theme:'remote'},{...DEFAULTS,accent:'url(file:///x)'},{...DEFAULTS,overlay:NaN},{...DEFAULTS,blur:25},{...DEFAULTS,overlay:20}])assert.throws(()=>normalize(value));
 assert.deepEqual(normalize({...DEFAULTS,background:'../../secret',image:'https://remote'}),{theme:'classic',accent:'#d4edaa',overlay:72,blur:4});
});
test('appearance read is side effect free; save persists preferences and filters corrupt paths',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yue-appearance-')),service=new Appearance(root,{});assert.equal(service.status().image,null);assert.equal(fs.existsSync(service.file),false);
 service.save({...DEFAULTS,theme:'light',accent:'#AABBCC'});assert.equal(new Appearance(root,{}).status().accent,'#aabbcc');
 fs.writeFileSync(service.file,JSON.stringify({...DEFAULTS,background:'../../outside.jpg'}));assert.equal(service.status().background,null);
});
test('background imports validate file format before decoding and retain the previous image on failure',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yue-background-'));let decoded=0;
 const jpeg=Buffer.from([255,216,255,1,2,3]),service=new Appearance(root,{createFromBuffer(){decoded++;return {isEmpty:()=>false,getSize:()=>({width:800,height:600}),toJPEG:()=>jpeg};}}),good=path.join(root,'good.jpg');fs.writeFileSync(good,jpeg);
 const result=service.importFile(good);assert.equal(result.hasBackground,true);assert.match(result.image,/^data:image\/jpeg;base64,/);assert.match(result.background,/^[a-f0-9]{64}\.jpg$/);
 const bad=path.join(root,'bad.png');fs.writeFileSync(bad,'<svg onload="attack"></svg>');assert.throws(()=>service.importFile(bad));assert.equal(decoded,1);assert.equal(service.status().background,result.background);
 assert.equal(service.remove().image,null);assert.ok(fs.existsSync(path.join(root,'appearance',result.background)));
});
