const {test}=require('node:test'),assert=require('node:assert/strict'),{palette,contrast,mix}=require('../ui/theme-palette.js');
test('custom accent text and controls remain readable across all UI surfaces and notation paper',()=>{
 const themes=[['#141619','#1d2025','#272b31','#14171c','#15181d'],['#111b2a','#1b2a3c','#26394c','#152233','#142032'],['#f4f5f7','#fff','#ebeef2','#f8f9fb','#eef0f4']];
 for(const surfaces of themes)for(const accent of ['#d4edaa','#38bdf8','#da304e','#ffffff','#000000','#eeeeee','#252b32','#00ff00','#ffff00','#ff00ff','#0000ff','#808080']){
  const colors=palette(accent,surfaces);
  for(const bg of [...surfaces,...surfaces.map(s=>mix(s,accent,.12))]){assert.ok(contrast(colors.text,bg)>=4.5);assert.ok(contrast(colors.muted,bg)>=4.5);assert.ok(contrast(colors.control,bg)>=3);}
  assert.ok(contrast(colors.score,'#f9faf9')>=4.5);assert.ok(contrast(colors.onAccent,accent)>=4.5);assert.ok(contrast(colors.onControl,colors.control)>=4.5);
 }
});
