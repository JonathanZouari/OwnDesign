const $ = id => document.getElementById(id);
const demoPrefix = "atelier-project-message:";
const demoRead = (role,id) => "atelier-project-read:"+role+":"+id;

export function projectChat({endpoint,user,role,request}) {
  const panel=$("messages-panel"), field=$("message-text"), button=$("compose").querySelector("button");
  let running=false, again=false, sending=false, scope="", pending=null, older=false, more=false;
  let history=new Map();
  function draftKey(){return "atelier-message-draft:"+scope}
  function demoRows(){
    return Object.keys(localStorage).filter(k=>k.startsWith(demoPrefix)).map(k=>JSON.parse(localStorage.getItem(k)))
      .sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))
      .map(row=>({...row,mine:row.author_role===role()}));
  }
  async function refresh(){
    if(running){again=true;return}
    running=true;
    try {
      const next=endpoint?endpoint+":"+user:"demo:"+role();
      if(scope!==next){scope=next;history.clear();older=false;more=false;
        pending=JSON.parse(sessionStorage.getItem(draftKey())||"null");field.value=pending?.body||"";}
      let rows,unread;
      const loadingHistory=older;
      if(endpoint){
        const first=[...history.keys()].sort((a,b)=>a-b)[0];
        const loadOlder=older&&first;
        const data=await request(endpoint+"/messages"+(loadOlder?"?before="+first:""));
        if(!history.size||loadOlder)more=data.more;
        if(!loadOlder&&history.size&&data.items.length && !history.has(data.items[0].id)&&data.more){
          history.clear();more=true;
        }
        for(const row of data.items)history.set(row.id,row);
        older=false; rows=[...history.values()].sort((a,b)=>a.id-b.id);unread=data.unread;
      }else{
        rows=demoRows();unread=rows.filter(r=>!r.mine&&!localStorage.getItem(demoRead(role(),r.id))).length;
      }
      $("message-badge").textContent=unread?unread+" חדשות":"";
      if(panel.open){
        $("older").hidden=!more;
        const list=$("messages"),previousHeight=list.scrollHeight, previousTop=list.scrollTop;
        const atEnd=previousTop+list.clientHeight>=previousHeight-3;
        list.replaceChildren(...rows.map(row=>{const el=document.createElement("li");
          el.textContent=(row.author_role==="designer"?"מעצב":"לקוח")+" · "+row.body;return el}));
        if(loadingHistory)list.scrollTop=previousTop+list.scrollHeight-previousHeight;
        else if(atEnd)list.scrollTop=list.scrollHeight;
        if(!document.hidden&&unread){
          const ids=rows.filter(r=>!r.mine).map(r=>r.id);
          if(endpoint){for(let i=0;i<ids.length;i+=50)await request(endpoint+"/messages/read",{method:"PUT",body:{ids:ids.slice(i,i+50)}})}
          else for(const id of ids)localStorage.setItem(demoRead(role(),id),"1");
          if(!more||!endpoint)$("message-badge").textContent="";
        }
      }
      $("chat-status").textContent="";
    }catch{ $("chat-status").textContent="השיחה לא התעדכנה. ננסה שוב עם חידוש החיבור." }
    finally{running=false;if(again){again=false;void refresh()}}
  }
  field.oninput=()=>{pending={request_id:crypto.randomUUID(),body:field.value};sessionStorage.setItem(draftKey(),JSON.stringify(pending))};
  $("compose").onsubmit=async e=>{
    e.preventDefault();const text=field.value.trim();if(!text||sending)return;
    if(!pending||pending.body.trim()!==text)pending={request_id:crypto.randomUUID(),body:text};
    sessionStorage.setItem(draftKey(),JSON.stringify(pending));
    sending=true;field.disabled=button.disabled=true;
    try{
      if(endpoint)await request(endpoint+"/messages",{method:"POST",body:{...pending,body:text}});
      else {const key=demoPrefix+pending.request_id;
        if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({id:pending.request_id,body:text,author_role:role(),created_at:new Date().toISOString()}))}
      pending=null;sessionStorage.removeItem(draftKey());field.value="";await refresh();
    }catch{$("chat-status").textContent="השליחה לא אושרה. הטיוטה נשמרה לניסיון נוסף."}
    finally{sending=false;field.disabled=button.disabled=false}
  };
  $("older").onclick=()=>{older=true;void refresh()};
  panel.ontoggle=refresh;
  for(const id of ["designer","client"])$(id).addEventListener("click",refresh);
  window.addEventListener("storage",refresh);window.addEventListener("online",refresh);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
  setInterval(()=>{if(!document.hidden)refresh()},4500);
  refresh();
}
