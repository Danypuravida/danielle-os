/* Explicit local appearance preference. Applied before paint; independent of sign-in. */
(function(){
'use strict';
const key='danielle-os-appearance',valid=value=>value==='dark'||value==='light';
let current='light',storageAvailable=true;
try{const saved=localStorage.getItem(key);if(valid(saved))current=saved;}catch{storageAvailable=false;}
function apply(value){
 current=valid(value)?value:'light';document.documentElement.dataset.theme=current;document.documentElement.style.colorScheme=current;
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',current==='dark'?'#11171c':'#f5f4ed');
 document.querySelectorAll('[data-appearance-select]').forEach(control=>{control.value=current;});
 document.querySelectorAll('[data-appearance-status]').forEach(el=>{el.textContent=storageAvailable?'':'A aparência foi aplicada, mas este navegador não permitiu salvar sua escolha.';el.hidden=storageAvailable;});
}
apply(current);
document.addEventListener('change',event=>{
 if(!event.target.matches?.('[data-appearance-select]')||!valid(event.target.value))return;
 try{localStorage.setItem(key,event.target.value);storageAvailable=true;}catch{storageAvailable=false;}
 apply(event.target.value);
});
window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.newValue);});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>apply(current),{once:true});else apply(current);
})();
