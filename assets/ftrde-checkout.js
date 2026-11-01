(()=>{'use strict';
window.STORE_ASSET_BASE=new URL('.',document.currentScript?.src||new URL('/assets/storefront.js',document.baseURI));
const filters=document.querySelectorAll('[data-fifth-filter]');
filters.forEach(button=>button.addEventListener('click',()=>{
 const category=button.dataset.fifthFilter;
 filters.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
 document.querySelectorAll('#products tr[data-category]').forEach(row=>{row.hidden=category!=='all'&&row.dataset.category!==category;});
}));
const toggle=document.getElementById('kitMobileToggle');
if(toggle)toggle.addEventListener('click',()=>{const nav=document.querySelector('.main-nav');if(nav){const open=nav.classList.toggle('xhs-open');toggle.setAttribute('aria-expanded',String(open));}});

document.querySelectorAll('.main-nav a').forEach(link=>link.addEventListener('click',()=>{document.querySelector('.main-nav')?.classList.remove('xhs-open');toggle?.setAttribute('aria-expanded','false');}));
const storageKey=window.STORE_SETTINGS?.storageKey||'xhs-preview-orders';
window.xhsOrderDeadline=order=>{
 const saved=Date.parse(order.expiresAt);
 if(Number.isFinite(saved))return saved;
 const created=Date.parse(order.createdAt);
 const fromId=Number(String(order.id).match(/(\d{13})/)?.[1]);
 return (Number.isFinite(created)?created:fromId||NaN)+15*60*1000;
};
window.xhsOrderExpired=order=>order.status==='expired'||(!order.paymentConfirmed&&(!order.status||order.status==='pending')&&Date.now()>=window.xhsOrderDeadline(order));
const readOrders=()=>{
 try{
  const parsed=JSON.parse(localStorage.getItem(storageKey)||'[]');
  const rows=Array.isArray(parsed)?parsed.filter(row=>row&&typeof row==='object'):[];
  let changed=false;
  rows.forEach(order=>{if(order.status!=='expired'&&window.xhsOrderExpired(order)){order.status='expired';order.cancelReason='payment_timeout';order.cancelledAt=new Date(window.xhsOrderDeadline(order)).toISOString();changed=true;}});
  if(changed){try{localStorage.setItem(storageKey,JSON.stringify(rows));}catch{}}
  return rows;
 }catch{return [];}
};
window.cancelExpiredXhsOrder=order=>{
 const latest=readOrders().find(row=>row.id===order.id);
 if(latest)Object.assign(order,latest);
 if(!window.xhsOrderExpired(order))return false;
 order.status='expired';order.cancelReason='payment_timeout';
 document.dispatchEvent(new CustomEvent('xhs-order-expired',{detail:{id:order.id}}));
 return true;
};
window.readXhsOrders=readOrders;
document.querySelectorAll('.xhs-reference-purchase form').forEach(form=>{
 const quantity=form.querySelector('[name=quantity]');
 const product=JSON.parse(form.dataset.product);
 const total=form.querySelector('[data-total]');
 const minimum=Number(quantity.min)||1,maximum=Number(quantity.max)||1000;
 const update=()=>{const value=Number(quantity.value);total.textContent='$'+(Number.isFinite(value)?product.price*value:0).toFixed(2);};
 form.querySelectorAll('[data-quantity-step]').forEach(button=>button.addEventListener('click',()=>{const value=Number(quantity.value)||minimum;quantity.value=Math.max(minimum,Math.min(maximum,value+Number(button.dataset.quantityStep)));update();}));
 quantity.addEventListener('input',update);
 form.querySelectorAll('[name=payment]').forEach(radio=>radio.addEventListener('change',()=>{form.querySelectorAll('.xhs-payment-method').forEach(label=>label.classList.toggle('is-selected',label.querySelector('input').checked));}));
 const buy=form.querySelector('.xhs-create');
 let submitting=false;
 buy.addEventListener('click',async()=>{
  if(submitting||!form.reportValidity())return;
  const count=Number(quantity.value);if(!Number.isInteger(count)||count<minimum||count>maximum)return;
  const email=form.querySelector('[name=email]').value.trim(),payment=form.querySelector('[name=payment]:checked').value;
  const output=form.querySelector('output'),originalButton=buy.innerHTML;
  const controls=[...form.querySelectorAll('input,button')].map(control=>({control,disabled:control.disabled}));
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  submitting=true;output.textContent='';
  controls.forEach(({control})=>{control.disabled=true;});
  buy.setAttribute('aria-busy','true');
  buy.innerHTML='<span class="ftrde-order-spinner" aria-hidden="true"></span><span>正在创建订单…</span>';
  try{
   await pause(600);
   const order={createdAt:new Date().toISOString(),status:'pending',paymentConfirmed:false,unitPrice:Number(product.price),id:(window.STORE_SETTINGS?.orderPrefix||'XHS')+Date.now()+Math.random().toString(36).slice(2,6).toUpperCase(),name:product.name,quantity:count,unit:product.unit||'个',unitsPerPack:product.unitsPerPack||1,total:(product.price*count).toFixed(2),email,payment};
   try{const orders=readOrders();orders.push(order);localStorage.setItem(storageKey,JSON.stringify(orders));}
   catch{output.textContent='订单保存失败，请检查浏览器存储后重试。';return;}
   buy.setAttribute('aria-busy','false');
   buy.innerHTML='<span aria-hidden="true">✓</span><span>订单已创建</span>';
   window.showXhsOrderNotice(order);
   await pause(900);
   const notice=document.getElementById('xhs-order-notice');
   if(notice){clearTimeout(notice.hideTimer);notice.getAnimations().forEach(animation=>animation.cancel());notice.hidden=true;}
   window.showXhsPayment(order);
  }catch{output.textContent='付款信息暂时无法打开，请到订单查询中查看已创建的订单。';}
  finally{
   controls.forEach(({control,disabled})=>{control.disabled=disabled;});
   buy.innerHTML=originalButton;buy.removeAttribute('aria-busy');submitting=false;
  }
 });
 form.addEventListener('submit',event=>{event.preventDefault();buy.click();});
 update();
});
const lookup=document.getElementById('xhs-find');
if(lookup)lookup.addEventListener('submit',event=>{
 event.preventDefault();
 const id=String(new FormData(lookup).get('order')||'').trim();
 const order=readOrders().find(item=>item.id===id);
 const feedback=lookup.querySelector('output'),result=document.getElementById('xhs-order-result');
 result.replaceChildren();result.hidden=true;
 if(!order){feedback.textContent='未找到该订单，请核对编号。';return;}
 feedback.textContent='已找到对应订单';
 result.dataset.orderId=order.id;
 const state=window.xhsOrderExpired(order)?'已取消（支付超时）':'未确认支付';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const rawTime=order.createdAt||new Date(Number(String(order.id).match(/(\d{13})/)?.[1])||Date.now()).toISOString();
 const time=new Date(rawTime).toLocaleString('zh-CN',{hour12:false});
 const network={trc20:'USDT-TRC20',erc20:'USDT-ERC20',bep20:'USDT-BEP20',solana:'USDT-Solana'}[order.payment]||'USDT-TRC20';
 const count=(order.unitsPerPack||1)>1?order.quantity+' × '+order.unit:order.quantity+(order.unit||'个');
 const row=(label,value)=>'<div class="xhs-order-detail-row"><dt>'+label+'</dt><dd>'+escape(value)+'</dd></div>';
 result.innerHTML='<div class="xhs-order-result-head"><h2>订单详情</h2><span class="xhs-order-state">'+state+'</span></div><dl>'+row('订单编号',order.id)+row('商品名称',order.name)+row('购买数量',count)+row('应付金额',Number(order.total).toFixed(2)+' USDT')+row('接收邮箱',order.email)+row('付款网络',network)+row('创建时间',time)+row('支付状态',state)+'</dl><button type="button" class="fifth-table-buy" data-resume-payment>查看付款信息 / 继续付款 →</button>';
 result.querySelector('[data-resume-payment]').addEventListener('click',()=>window.showXhsPayment(order));
 result.hidden=false;
});
document.addEventListener('xhs-order-expired',event=>{
 if(lookup&&document.getElementById('xhs-order-result')?.dataset.orderId===event.detail.id)lookup.requestSubmit();
});
})();

window.closeExpiredXhsPayment=function(order){
 if(!window.cancelExpiredXhsOrder(order))return false;
 const dialog=document.getElementById('xhs-payment-dialog');
 if(dialog){
  clearInterval(dialog.countdownTimer);
  dialog.updateCountdown=null;
  dialog.querySelector('[data-qr]')?.replaceChildren();
  const address=dialog.querySelector('[data-address]');if(address)address.textContent='';
  const notice=dialog.querySelector('#xhs-order-notice');if(notice){clearTimeout(notice.hideTimer);notice.hidden=true;}
  if(dialog.open)dialog.close();
 }
 alert('支付时间已到，订单已超时取消，请重新下单。');
 return true;
};

window.showXhsPayment=function(order){
 const latest=window.readXhsOrders().find(row=>row.id===order.id);
 if(latest)Object.assign(order,latest);
 if(window.closeExpiredXhsPayment(order))return;
 const network={trc20:'TRC20',erc20:'ERC20',bep20:'BEP20',solana:'Solana'}[order.payment||'trc20'];
 const address=window.STORE_PAYMENT?.[network];
 if(!address){alert('当前网络尚未配置收款地址');return;}
 let dialog=document.getElementById('xhs-payment-dialog');
 if(!dialog){
  dialog=document.createElement('dialog');
  dialog.id='xhs-payment-dialog';
  dialog.className='xhs-payment-dialog xhs-confirm-payment';
  dialog.setAttribute('aria-labelledby','xhs-confirm-title');
  dialog.innerHTML='<div class="xhs-confirm-head"><h2 id="xhs-confirm-title"><span aria-hidden="true">▣</span> 确认订单信息</h2><button type="button" data-close aria-label="关闭">×</button></div><div class="xhs-confirm-columns"><div class="xhs-confirm-left"><section class="xhs-confirm-timer"><strong>◷ 请在规定时间内完成支付</strong><div data-countdown role="timer"></div><p data-timer-tip>订单将在倒计时结束后自动取消</p></section><section class="xhs-confirm-details"><h3><span aria-hidden="true">▤</span> 订单详情</h3><p class="xhs-confirm-product" data-product></p><dl><div><dt>订单编号</dt><dd data-order></dd></div><div><dt>收件邮箱</dt><dd data-email></dd></div><div><dt>支付方式</dt><dd data-network></dd></div></dl><div class="xhs-confirm-total"><span>应付总额</span><strong data-amount></strong></div></section></div><section class="xhs-confirm-right"><h3><span aria-hidden="true">▰</span> 支付信息</h3><div class="xhs-confirm-address"><div><span><svg class="xhs-wallet-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v11H5a3 3 0 0 1-3-3V6"/><path d="M20 12h-5a2 2 0 0 0 0 4h5"/><path d="M16 14h.01"/></svg> 收款地址</span><code data-address></code></div><button type="button" data-copy>▣ 复制</button></div><div class="xhs-confirm-qr" data-qr></div><p class="xhs-confirm-scan" data-scan></p></section></div>';
  document.body.append(dialog);
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{clearInterval(dialog.countdownTimer);dialog.updateCountdown=null;});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&dialog.open)dialog.updateCountdown?.();});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.querySelector('[data-copy]').addEventListener('click',async event=>{
   try{await navigator.clipboard.writeText(dialog.querySelector('[data-address]').textContent);event.target.textContent='已复制';}
   catch{const range=document.createRange();range.selectNodeContents(dialog.querySelector('[data-address]'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);event.target.textContent='手动复制';}
  });
 }
 const text=(selector,value)=>{dialog.querySelector(selector).textContent=value;};
 text('[data-product]',order.name);
 text('[data-order]',order.id);
 text('[data-email]',order.email||'—');
 text('[data-network]','USDT-'+network);
 text('[data-amount]',Number(order.total).toFixed(2)+' USDT');
 text('[data-address]',address);
 text('[data-copy]','▣ 复制');
 text('[data-scan]','请使用支持 USDT-'+network+' 的钱包扫码支付');
 const qr=dialog.querySelector('[data-qr]');qr.replaceChildren();
 if(window.QRCodeStyling)new QRCodeStyling({width:208,height:208,type:'svg',data:address,image:new URL('payments/usdt-'+(order.payment||'trc20')+'.png',window.STORE_ASSET_BASE).href,imageOptions:{crossOrigin:'anonymous',imageSize:0.27,margin:4,hideBackgroundDots:true},dotsOptions:{color:'#000',type:'square'},backgroundOptions:{color:'#fff'},qrOptions:{errorCorrectionLevel:'M'}}).append(qr);
 clearInterval(dialog.countdownTimer);
 const savedDeadline=window.xhsOrderDeadline(order);
 const deadline=Number.isFinite(savedDeadline)?savedDeadline:Date.now()+15*60*1000;
 const tick=()=>{
  const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));
  text('[data-countdown]',String(Math.floor(left/60)).padStart(2,'0')+' : '+String(left%60).padStart(2,'0'));
  if(!left){text('[data-timer-tip]','支付时间已到');window.closeExpiredXhsPayment(order);}
 };
 dialog.updateCountdown=tick;
 if(!dialog.open)dialog.showModal();
 dialog.countdownTimer=setInterval(tick,1000);
 tick();
};

window.showXhsOrderNotice=function(order){const dialog=document.getElementById('xhs-payment-dialog');const host=dialog?.open?dialog:document.body;let notice=document.getElementById('xhs-order-notice');if(!notice){notice=document.createElement('div');notice.id='xhs-order-notice';notice.className='xhs-order-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');notice.innerHTML='<span class="xhs-notice-check" aria-hidden="true">✓</span><div><strong>订单已创建</strong><span data-order-id></span></div>'; }host.append(notice);notice.querySelector('[data-order-id]').textContent='订单编号：'+order.id;notice.hidden=false;clearTimeout(notice.hideTimer);notice.getAnimations().forEach(a=>a.cancel());const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;notice.animate([{transform:'translateX(calc(100% + 32px))',opacity:0},{transform:'translateX(0)',opacity:1}],{duration:reduced?0:450,easing:'cubic-bezier(.22,.61,.36,1)',fill:'forwards'});notice.hideTimer=setTimeout(()=>{const out=notice.animate([{transform:'translateX(0)',opacity:1},{transform:'translateX(calc(100% + 32px))',opacity:0}],{duration:reduced?0:300,easing:'ease-in',fill:'forwards'});out.onfinish=()=>{notice.hidden=true;};},4200);};
