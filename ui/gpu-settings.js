'use strict';
const gpuSettings=document.createElement('div');gpuSettings.className='gpu-settings';
gpuSettings.innerHTML='<div class="gpu-settings-heading"><strong>本地显卡</strong><button id="gpu-detect" class="button secondary small">重新检测</button></div><div id="gpu-devices" class="gpu-devices" aria-label="检测到的 NVIDIA 显卡"></div><div class="gpu-selection"><label for="gpu-select">运行显卡</label><select id="gpu-select" aria-describedby="gpu-selection-help"></select><button id="gpu-apply" class="button primary small">应用选择</button></div><p id="gpu-selection-help" class="help">音乐生成、歌曲 Cover、音色替换和歌词识别统一使用所选单张显卡。歌词时间对齐使用 CPU。</p><p id="gpu-selection-status" class="help" role="status"></p>';
$('#page-settings .hardware-card').append(gpuSettings);
let gpuChoice=null,gpuSaved=null,gpuBusy=false,gpuOptionsKey='';
const gpuGiB=n=>Number.isFinite(n)?(n/1024).toFixed(1)+' GB':'—';
function renderGpuSettings(){
 if(!state?.hardware)return;const h=state.hardware,devices=h.gpus||[],saved=h.gpuDevice||'auto';
 if(gpuChoice===null||gpuChoice===gpuSaved)gpuChoice=saved;gpuSaved=saved;
 const key=JSON.stringify([devices.map(g=>[g.uuid,g.index,g.name,g.memoryMiB]),gpuChoice]);
 if(key!==gpuOptionsKey){const select=$('#gpu-select');select.replaceChildren(new Option('默认显卡（第一张 NVIDIA 显卡）','auto'));
  for(const g of devices)select.add(new Option(`GPU ${g.index} · ${g.name} · ${gpuGiB(g.memoryMiB)}`,g.uuid));
  if(gpuChoice!=='auto'&&!devices.some(g=>g.uuid===gpuChoice))select.add(new Option('已选显卡未连接',gpuChoice));
  select.value=gpuChoice;gpuOptionsKey=key;
 }
 const blocked=gpuBusy||state.gpuSwitchBlocked||!!state.operation||jobs.some(j=>['queued','running'].includes(j.status));
 $('#gpu-select').disabled=!!blocked;$('#gpu-detect').disabled=gpuBusy;
 $('#gpu-apply').disabled=!!blocked||gpuChoice===saved||!devices.some(g=>gpuChoice==='auto'||g.uuid===gpuChoice);
 $('#gpu-devices').replaceChildren();
 for(const gpu of devices){const card=document.createElement('div');card.className='gpu-device';card.classList.toggle('selected',gpu.uuid===h.selectedUuid);
  const label=document.createElement('strong'),details=document.createElement('p'),badge=document.createElement('span');label.textContent=`GPU ${gpu.index} · ${gpu.name}`;
  details.textContent=`显存 ${gpuGiB(gpu.memoryMiB)} · 已用 ${gpuGiB(gpu.usedMiB)} · 可用 ${gpuGiB(gpu.freeMiB)}\n驱动 ${gpu.driver}`;
  statusBadge(badge,gpu.uuid===h.selectedUuid?'当前运行显卡':'可选择',gpu.uuid===h.selectedUuid?'ready':'');card.append(label,details,badge);$('#gpu-devices').append(card);
 }
 $('#gpu-selection-status').textContent=gpuBusy?'正在检测并保存…':h.gpuError||(!devices.length?'未检测到可用的 NVIDIA 显卡，请检查驱动。':blocked?'任务、诊断或环境准备进行中，完成后可切换。':gpuChoice!==saved?'选择尚未应用。':`选择已保存 · 检测时间 ${new Date(h.detectedAt).toLocaleTimeString()} · 下一项任务使用当前显卡`);
 if(h.gpuError)statusBadge($('#hardware-badge'),'显卡不可用','warning');
}
$('#gpu-select').onchange=()=>{gpuChoice=$('#gpu-select').value;renderGpuSettings();};
$('#gpu-detect').onclick=safe(async()=>{gpuBusy=true;renderGpuSettings();try{state=await api.status();}finally{gpuBusy=false;renderGpuSettings();}await refresh();});
$('#gpu-apply').onclick=safe(async()=>{gpuBusy=true;renderGpuSettings();try{await api.selectGpu(gpuChoice);state=await api.status();gpuChoice=state.hardware.gpuDevice;gpuSaved=gpuChoice;toast('运行显卡已保存，下一项任务生效');}finally{gpuBusy=false;renderGpuSettings();}await refresh();});
