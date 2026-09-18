'use strict';
// Shared by the renderer and contrast regression tests. Accent fills retain the
// user's choice while their text/control variants stay legible on every surface.
((scope)=>{
 const rgb=hex=>{let value=hex.trim().slice(1);if(value.length===3)value=value.split('').map(n=>n+n).join('');return value.match(/../g).map(n=>parseInt(n,16));};
 const luminance=color=>rgb(color).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const mix=(a,b,t)=>'#'+rgb(a).map((n,i)=>Math.round(n*(1-t)+rgb(b)[i]*t).toString(16).padStart(2,'0')).join('');
 const readable=(accent,surfaces,minimum)=>{
  if(surfaces.every(s=>contrast(accent,s)>=minimum))return accent;
  const target=surfaces.reduce((n,s)=>n+luminance(s),0)/surfaces.length>.45?'#000000':'#ffffff';
  for(let step=1;step<=100;step++){const candidate=mix(accent,target,step/100);if(surfaces.every(s=>contrast(candidate,s)>=minimum))return candidate;}
  return target;
 };
 const foreground=color=>contrast(color,'#000000')>=contrast(color,'#ffffff')?'#000000':'#ffffff';
 function palette(accent,surfaces,muted='#808080'){
  const backgrounds=[...surfaces,...surfaces.map(s=>mix(s,accent,.12))];
  const control=readable(accent,backgrounds,3),text=readable(accent,backgrounds,4.6);
  return {text,control,line:control,muted:readable(muted,backgrounds,4.6),onAccent:foreground(accent),onControl:foreground(control),score:readable(accent,['#f9faf9'],4.6)};
 }
 const api={palette,contrast,mix};if(typeof module!=='undefined'&&module.exports)module.exports=api;else scope.ThemePalette=api;
})(globalThis);
