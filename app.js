(function(){
"use strict";
const $=id=>document.getElementById(id);
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const root=document.documentElement;
root.dataset.theme=store.get("lna.theme",matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");
$("theme").onclick=()=>{const n=root.dataset.theme==="dark"?"light":"dark";root.dataset.theme=n;store.set("lna.theme",n);const m=document.querySelector('meta[name=theme-color]');if(m)m.content=n==="dark"?"#1B1A18":"#FAF9F5"};

let tt;function toast(m){const t=$("toast");t.textContent=m;t.classList.add("on");clearTimeout(tt);tt=setTimeout(()=>t.classList.remove("on"),2600)}

const messages=$("messages"),welcome=$("welcome"),input=$("input"),sendBtn=$("send"),diag=$("diag");
let history=store.get("lna.hist",[]);
let busy=false;

// сразу показать, если открыто с диска
$("hint").textContent=location.protocol==="file:"?"Открыто с диска · нужен интернет":("Онлайн · "+location.host);


function showChat(){welcome.hidden=true;messages.hidden=false}
function esc(s){return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}
function scrollBottom(){requestAnimationFrame(()=>{$("chatMain").scrollTop=$("chatMain").scrollHeight})}
function renderAll(){
  if(!history.length){welcome.hidden=false;messages.hidden=true;messages.innerHTML="";return}
  showChat();
  messages.innerHTML=history.map((m,i)=>{
    const cls=m.role==="user"?"user":"bot"+(m.err?" err":"");
    const actions=m.role==="assistant"&&!m.err?`<div class="meta"><button type="button" data-copy="${i}">Копировать</button></div>`:"";
    return `<div class="msg ${cls}">${esc(m.content)}${actions}</div>`;
  }).join("");
  scrollBottom();
}

function payload(prompt,msgs){
  const list=[{role:"system",content:"You are Lingo AI, a helpful assistant like Gemini. Reply in the user's language. Be clear and useful."}];
  (msgs||[]).filter(m=>(m.role==="user"||m.role==="assistant")&&!m.err).slice(-6)
    .forEach(m=>list.push({role:m.role,content:m.content}));
  list.push({role:"user",content:prompt});
  return list;
}

async function viaPuter(prompt){
  if(typeof puter==="undefined"||!puter.ai||!puter.ai.chat)throw new Error("Puter не загрузился");
  const r=await puter.ai.chat(prompt,{model:"gpt-4o-mini"});
  const t=typeof r==="string"?r:(r&&r.message?r.message:(r&&r.text?r.text:String(r)));
  if(!t||!String(t).trim())throw new Error("пустой ответ Puter");
  return String(t).trim();
}

async function viaIndex(messages){
  const r=await fetch("https://index-translate.bilibili.com/v1/chat/completions",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"Index-Translate-35B-A3B",temperature:.7,messages})
  });
  if(!r.ok)throw new Error("Index HTTP "+r.status);
  const j=await r.json();
  const t=(j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content||"").trim();
  if(!t)throw new Error("Index пусто");
  return t;
}

async function viaPoll(messages){
  const r=await fetch("https://text.pollinations.ai/openai",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"openai",messages})
  });
  if(!r.ok)throw new Error("Poll HTTP "+r.status);
  const j=await r.json();
  const t=(j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content||"").trim();
  if(!t)throw new Error("Poll пусто");
  return t;
}

async function askNeural(prompt,msgs){
  // file:// пробуем всё равно — API с CORS * часто работают
  const messages=payload(prompt,msgs);
  const log=[];
  // 1 Puter (часто работает из браузера)
  try{const t=await viaPuter(prompt);log.push("Puter: ok");return t}catch(e){log.push("Puter: "+e.message)}
  // 2 Index-Translate (тот же, что у переводчика)
  try{const t=await viaIndex(messages);log.push("Index: ok");return t}catch(e){log.push("Index: "+e.message)}
  // 3 Pollinations
  try{const t=await viaPoll(messages);log.push("Poll: ok");return t}catch(e){log.push("Poll: "+e.message)}
  console.warn(log);
  throw new Error("Все сервисы не ответили:\n"+log.join("\n"));
}

async function testConn(){
  diag.hidden=false;diag.className="diag";diag.textContent="Проверяю…";
  const lines=["Протокол: "+location.protocol+" // "+location.host];
  // Index
  try{
    const t=await viaIndex([{role:"user",content:"Say only: OK"}]);
    lines.push("✓ Index-Translate: "+t.slice(0,40));
  }catch(e){lines.push("✗ Index-Translate: "+e.message)}
  // Poll
  try{
    const t=await viaPoll([{role:"user",content:"Say only: OK"}]);
    lines.push("✓ Pollinations: "+t.slice(0,40));
  }catch(e){lines.push("✗ Pollinations: "+e.message)}
  // Puter
  try{
    const t=await viaPuter("Say only: OK");
    lines.push("✓ Puter: "+t.slice(0,40));
  }catch(e){lines.push("✗ Puter: "+e.message)}
  const ok=lines.some(l=>l.startsWith("✓"));
  diag.className="diag "+(ok?"ok":"bad");
  diag.innerHTML=lines.map(l=>esc(l)).join("<br>");
  toast(ok?"Связь есть — можно писать":"Сервисы недоступны с этой сети");
}

async function send(text){
  text=(text||input.value).trim();
  if(!text||busy)return;
  busy=true;sendBtn.disabled=true;input.value="";autoSize();
  history.push({role:"user",content:text});
  store.set("lna.hist",history);
  showChat();
  messages.innerHTML+=`<div class="msg user">${esc(text)}</div><div class="msg bot typing">Думаю</div>`;
  scrollBottom();
  try{
    const answer=await askNeural(text,history.filter(m=>!m.err).slice(0,-1));
    history.push({role:"assistant",content:answer});
    store.set("lna.hist",history);
    renderAll();
  }catch(e){
    history.push({role:"assistant",content:String(e.message||e),err:true});
    store.set("lna.hist",history);
    renderAll();
  }finally{busy=false;sendBtn.disabled=false;input.focus()}
}

function autoSize(){
  input.style.height="auto";
  input.style.height=Math.min(140,Math.max(44,input.scrollHeight))+"px";
}
input.addEventListener("input",autoSize);
input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});
sendBtn.onclick=()=>send();
$("suggestions").onclick=e=>{
  if(e.target.id==="btnTest"){testConn();return}
  const b=e.target.closest("button[data-q]");if(b)send(b.dataset.q);
};
$("btnNew").onclick=()=>{if(busy)return;history=[];store.set("lna.hist",[]);renderAll();toast("Новый чат")};
messages.addEventListener("click",async e=>{
  const b=e.target.closest("[data-copy]");if(!b)return;
  const m=history[+b.dataset.copy];if(!m)return;
  try{await navigator.clipboard.writeText(m.content);toast("Скопировано")}catch(_){}
});

renderAll();
if("serviceWorker"in navigator&&/^https?:$/.test(location.protocol))
  addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
