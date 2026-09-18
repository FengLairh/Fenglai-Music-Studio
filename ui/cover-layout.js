'use strict';
// Keep the score as the main working surface. All existing controls and drafts
// retain their IDs, listeners and values when the preparation area is folded.
(()=>{
 const page=$('#page-cover'),editor=workbenchEditors.cover,pane=editor.pane,grid=page.querySelector('.workbench-grid'),source=page.querySelector('.source-strip'),head=source.querySelector('.source-head');
 page.classList.add('cover-score-workspace');
 const make=(tag,cls,html='')=>{const n=document.createElement(tag);n.className=cls;n.innerHTML=html;return n;};
 const sourceTitle=make('div','cover-source-label'),sourcePicker=make('div','cover-source-picker'),sourceActions=make('div','cover-transcribe-controls');
 sourceTitle.append(head.querySelector('strong'),$('#cover-ready'),$('#cover-score-status'));sourcePicker.append($('#cover-source'),$('#cover-import'));sourceActions.append($('#cover-mode'),$('#cover-transcribe'));head.append(sourceTitle,sourcePicker,sourceActions);
 $('#cover-import').setAttribute('title','导入新的音乐文件');$('#cover-import').setAttribute('aria-label','选择音乐文件');$('#cover-import').replaceChildren();$('#cover-import').innerHTML='<i data-icon="upload"></i>导入';
 const tools=make('div','cover-editor-tools'),toolbar=pane.querySelector('.score-toolbar'),transport=pane.querySelector('.score-transport');toolbar.before(tools);tools.append(toolbar,transport);
 const help=make('details','cover-editor-help','<summary aria-label="查看乐谱编辑快捷键" title="乐谱编辑快捷键"><i data-icon="keyboard"></i></summary>');help.append(pane.querySelector('.score-edit-help'));pane.querySelector('.score-file-actions').append(help);
 const brief=page.querySelector('.creative-brief'),theme=$('#cover-theme'),themeToggle=make('button','cover-theme-toggle','<i data-icon="edit"></i><span>改编主题</span><span class="cover-theme-preview"></span><i data-icon="chevron-down"></i>');themeToggle.id='cover-theme-toggle';themeToggle.setAttribute('aria-controls','cover-theme-panel');themeToggle.setAttribute('aria-expanded','false');
 brief.id='cover-theme-panel';brief.hidden=true;brief.setAttribute('aria-label','改编主题');
 const themeClose=make('button','text-button','完成');themeClose.id='cover-theme-close';brief.querySelector('.workbench-theme').append(themeClose);page.querySelector('.cover-mode-switch').append(themeToggle);
 const focus=make('button','button secondary small','<i data-icon="arrows-maximize"></i><span>专注乐谱</span>');focus.id='cover-score-focus';focus.setAttribute('aria-pressed','false');focus.title='收起上方准备区，为乐谱留出完整空间';page.querySelector('.workbench-heading-actions').prepend(focus);
 let frame=null;
 const layout={
  focus:false,
  theme(open){brief.hidden=!open;themeToggle.setAttribute('aria-expanded',String(open));if(open)theme.focus({preventScroll:true});},
  setFocus(value){const position=editor.captureScorePosition();this.focus=value;this.theme(false);page.classList.toggle('score-focus',value);focus.setAttribute('aria-pressed',String(value));focus.innerHTML=`<i data-icon="${value?'arrows-minimize':'arrows-maximize'}"></i><span>${value?'退出专注':'专注乐谱'}</span>`;drawIcons(focus);this.resize();editor.restoreScorePosition(position);},
  resize(){
   this.summary();if(page.hidden)return;const top=grid.getBoundingClientRect().top+window.scrollY,bottom=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--player-height'))||0;
   const growing=['score-scroll','score-source-view','lyrics-pane','workbench-style'];
   const chrome=[...pane.children].filter(n=>!growing.some(c=>n.classList.contains(c))&&getComputedStyle(n).display!=='none').reduce((sum,n)=>sum+n.getBoundingClientRect().height,0);
   // Additional AI or note controls must not reduce the staff to a title strip.
   // A short window can scroll the page instead of compressing the notation.
   const height=Math.max(innerHeight-top-bottom-12,chrome+260);
   if(Math.abs(parseFloat(page.style.getPropertyValue('--workbench-height'))-height)>1||!page.style.getPropertyValue('--workbench-height'))page.style.setProperty('--workbench-height',height+'px');
  },
  schedule(){if(frame!==null)return;frame=requestAnimationFrame(()=>{frame=null;layout.resize();});},
  summary(){const text=theme.value.trim();themeToggle.querySelector('.cover-theme-preview').textContent=text||'点击填写';themeToggle.title=text?'改编主题：'+text:'填写主题，供各处 AI 辅助使用';}
 };
 window.coverLayout=layout;
 themeToggle.onclick=()=>layout.theme(brief.hidden);themeClose.onclick=()=>{layout.theme(false);themeToggle.focus({preventScroll:true});};focus.onclick=()=>layout.setFocus(!layout.focus);theme.addEventListener('input',()=>layout.summary());
 document.addEventListener('pointerdown',e=>{if(!brief.hidden&&!brief.contains(e.target)&&!themeToggle.contains(e.target))layout.theme(false);if(!help.contains(e.target))help.open=false;});
 document.addEventListener('keydown',e=>{if(e.key!=='Escape'||e.isComposing||confirmDialog.open||currentPage!=='cover')return;if(!brief.hidden){layout.theme(false);themeToggle.focus({preventScroll:true});e.preventDefault();e.stopPropagation();}else if(help.open){help.open=false;e.preventDefault();}else if(layout.focus&&!e.target.matches('input,textarea,select')&&!editor.noteDrag&&editor.float.hidden){layout.setFocus(false);e.preventDefault();}},true);
 const observer=new ResizeObserver(()=>layout.schedule());for(const n of [page.querySelector('.workbench-heading'),page.querySelector('.cover-mode-switch'),source,tools,pane.querySelector('.score-tabs'),pane.querySelector('[data-ai-slot="score"]'),editor.inspector,pane.querySelector('.score-structure'),pane.querySelector('[data-score-error]')])observer.observe(n);
 new MutationObserver(()=>layout.schedule()).observe(pane,{attributes:true,attributeFilter:['data-active-tab']});
 document.addEventListener('DOMContentLoaded',()=>{layout.summary();layout.schedule();},{once:true});theme.addEventListener('change',()=>layout.summary());drawIcons(page);layout.resize();
})();
