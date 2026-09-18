'use strict';
// Keep editing confirmations in the renderer. Synchronous window.confirm opens
// a second native modal loop and can leave Windows text input without focus.
const confirmDialog=document.createElement('dialog');
confirmDialog.id='studio-confirm';confirmDialog.className='studio-confirm';
confirmDialog.setAttribute('aria-labelledby','studio-confirm-title');
confirmDialog.setAttribute('aria-describedby','studio-confirm-message');
confirmDialog.innerHTML='<h2 id="studio-confirm-title">确认修改</h2><p id="studio-confirm-message"></p><div class="confirm-actions"><button type="button" class="button secondary" data-confirm-cancel autofocus>取消</button><button type="button" class="button primary" data-confirm-accept>继续</button></div>';
document.body.append(confirmDialog);
let resolveConfirmation=null;
function finishConfirmation(accepted){
 if(!resolveConfirmation)return;
 const complete=resolveConfirmation;resolveConfirmation=null;
 confirmDialog.close();complete(accepted);
}
function studioConfirm(message){
 if(resolveConfirmation)return Promise.resolve(false);
 const previous=document.activeElement;
 confirmDialog.querySelector('p').textContent=message;
 return new Promise(resolve=>{
  resolveConfirmation=accepted=>{
   if(previous?.isConnected&&previous.getClientRects().length)previous.focus({preventScroll:true});
   resolve(accepted);
  };
  confirmDialog.showModal();confirmDialog.querySelector('[data-confirm-cancel]').focus({preventScroll:true});
 });
}
confirmDialog.querySelector('[data-confirm-cancel]').onclick=()=>finishConfirmation(false);
confirmDialog.querySelector('[data-confirm-accept]').onclick=()=>finishConfirmation(true);
confirmDialog.addEventListener('cancel',e=>{e.preventDefault();finishConfirmation(false);});
confirmDialog.addEventListener('keydown',e=>e.stopPropagation());
