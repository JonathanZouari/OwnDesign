import { containsPoint, planBox, roomBox, wallLength } from "./plan.js";
import { svg, roomSurface, layoutSurface, wallNode, openingNode, clientFurniture } from "./editor/render.js";

const el = id => document.getElementById(id);

export function editPartition(board, original, roomId, clearance, finish, initialWallId=null) {
  function sharesEdge(w,other) {
    if (!other.roomId || w.roomId===other.roomId) return false;
    const dx=w.x2-w.x1, dy=w.y2-w.y1, length=wallLength(w);
    const positions=[];
    for (const [x,y] of [[other.x1,other.y1],[other.x2,other.y2]]) {
      if (Math.abs((x-w.x1)*dy-(y-w.y1)*dx)>length*1e-6) return false;
      positions.push(((x-w.x1)*dx+(y-w.y1)*dy)/length);
    }
    return Math.min(length,Math.max(...positions))-Math.max(0,Math.min(...positions))>1e-6;
  }
  const eligible = original.walls.filter(w => w.kind==="partition" && original.walls.some(other=>sharesEdge(w,other)));
  if (!eligible.length) {
    el("notice").textContent="בתוכנית הזו אין קיר פנימי ישר לעריכה.";
    return;
  }
  const selected=eligible.find(w=>w.id===initialWallId);
  if (initialWallId && !selected) {
    el("notice").textContent="אפשר לערוך מחיצה פנימית המשותפת לשני חדרים.";
    return null;
  }
  const roomName = id => original.rooms.find(r=>r.id===id)?.name || "";
  const choice=el("partition-choice"), mode=el("wall-mode"), distance=el("wall-distance");
  const apply=el("wall-apply"), info=el("wall-info"), controls=el("wall-controls");
  const locked=document.querySelectorAll(".project-tools, aside, .modes, #room, #version, #wall-edit, #room-tools, .sheetfoot");
  const controller=new AbortController(), options={signal:controller.signal};
  const halls=new Set(original.rooms.filter(r=>r.type==="hallway").map(r=>r.id));
  let wall=selected || eligible.find(w=>w.roomId===roomId && original.walls.some(other=>halls.has(other.roomId) && sharesEdge(w,other)))
    || eligible.find(w=>w.roomId===roomId) || eligible[0];
  let revision=0, timer, pending, approved=null, drag=null, handles, closed=false;
  const box=planBox(original), pad=40;
  if (!selected) board.setAttribute("viewBox",[box.x-pad,box.y-pad,box.w+2*pad,box.h+2*pad].join(" "));
  board.classList.add("wall-edit-mode");
  board.onclick=board.onkeydown=null;
  controls.hidden=false;
  info.hidden=false;
  const exact=el("wall-exact");
  exact.hidden=true;
  el("more-wall-shapes").open=false;
  let commitRequested=false;
  function placeControls() {
    const stage=el("plan-stage").getBoundingClientRect();
    const mid=new DOMPoint((wall.x1+wall.x2)/2,(wall.y1+wall.y2)/2).matrixTransform(board.getScreenCTM());
    const x=mid.x-stage.left, y=mid.y-stage.top, h=controls.offsetHeight, width=controls.offsetWidth;
    controls.style.left=Math.max(4,Math.min(stage.width-width-4,x-width/2))+"px";
    controls.style.top=Math.max(4,Math.min(stage.height-h-4,y>h+64?y-h-60:y+60))+"px";
  }
  const resize=new ResizeObserver(placeControls);
  resize.observe(board); resize.observe(controls);
  el("workspace").classList.add("editing-partition");
  for (const node of locked) node.inert=true;
  choice.replaceChildren(...eligible.map(w=>{
    const neighbors=new Set(original.walls.filter(other=>sharesEdge(w,other)).map(other=>roomName(other.roomId)));
    return new Option(roomName(w.roomId)+" ↔ "+[...neighbors].join(", "),w.id);
  }));

  function paint(plan, flagged=[], spans=[]) {
    const walls=new Map(plan.walls.map(w=>[w.id,w]));
    const surfaces=plan.rooms.flatMap(r=>{
      const b=roomBox(plan,r.id);
      return b ? [roomSurface(r,b,{fill:r.id===wall.roomId?"#eee6d9":"#f7f4ef"}),...(r.layout?[layoutSurface(r)]:[])] : [];
    });
    const items=plan.furniture.map(f=>{
      const n=clientFurniture(f);
      if (flagged.includes(f.id)) {
        n.classList.add("wall-conflict");
        n.append(svg("rect",{x:-f.w/2,y:-f.d/2,width:f.w,height:f.d,fill:"none",stroke:"#b63323","stroke-width":5}));
      }
      return n;
    });
    handles=svg("g",{class:"partition-handles"});
    board.replaceChildren(...surfaces,...items,...plan.walls.map(w=>wallNode(w,false)),
      ...plan.openings.map(o=>openingNode(o,walls.get(o.wallId),false)),
      ...spans.map(points=>svg("polyline",{points:points.map(p=>p.join(",")).join(" "),stroke:"#b63323","stroke-width":6,fill:"none"})),handles);
    drawHandles();
  }

  function drawHandles() {
    const shift=Number(distance.value)||0, len=wallLength(wall);
    const normal={x:(wall.y1-wall.y2)/len,y:(wall.x2-wall.x1)/len};
    const shape=["ellipse","bay","parallel"].includes(mode.value);
    function point(t) {
      let h=1;
      if (mode.value==="ellipse") h=Math.sqrt(4*t*(1-t));
      if (mode.value==="bay") h=Math.min(4*t,1,4*(1-t));
      if (mode.value==="parallel") h=2*Math.min(t,1-t);
      if (mode.value==="start") h=1-t;
      if (mode.value==="end") h=t;
      return [wall.x1+(wall.x2-wall.x1)*t+normal.x*shift*h,wall.y1+(wall.y2-wall.y1)*t+normal.y*shift*h];
    }
    const stations=mode.value==="ellipse"?Array.from({length:49},(_,i)=>i/48):[0,.25,.5,.75,1];
    const handle=(x,y,operation)=>svg("circle",{cx:x,cy:y,r:Math.max(8,11/(board.getScreenCTM()?.a||1)),
      "data-handle":operation,fill:operation===mode.value?"#80562f":"#fff",stroke:"#523a28","stroke-width":3});
    const guide=svg("polyline",{points:stations.map(t=>point(t).join(",")).join(" "),fill:"none",
      stroke:"#ad7143","stroke-width":shape?3:7,"stroke-linejoin":"round","pointer-events":"none"});
    const scale=board.getScreenCTM()?.a || 1;
    const anchor=point(mode.value==="start"?0:mode.value==="end"?1:.5);
    const probe={x:(wall.x1+wall.x2)/2+normal.x*Math.sign(shift),y:(wall.y1+wall.y2)/2+normal.y*Math.sign(shift)};
    const towards=shift && original.rooms.find(r=>{
      const b=roomBox(original,r.id);
      return b && containsPoint(r,b,probe);
    });
    const label=Math.abs(shift)+" ס״מ"+(towards?" לכיוון "+towards.name:"");
    const width=Math.max(68,label.length*8+16);
    const matrix=board.getScreenCTM(), bounds=board.getBoundingClientRect();
    const pointer=new DOMPoint(...anchor).matrixTransform(matrix);
    const bx=Math.max(bounds.left+width/2+2,Math.min(bounds.right-width/2-2,pointer.x));
    const by=pointer.y<bounds.top+50?pointer.y+32:pointer.y-30;
    const at=new DOMPoint(bx,by).matrixTransform(matrix.inverse());
    const badge=svg("g",{"data-measure":"",tabindex:0,role:"button","aria-label":"הזנת מידה מדויקת, "+label,
      transform:"translate("+at.x+" "+at.y+") scale("+1/scale+")"});
    const caption=svg("text",{"text-anchor":"middle",y:5,fill:"#fff","font-size":14});
    caption.textContent=label;
    badge.append(svg("rect",{x:-width/2,y:-16,width,height:32,rx:9,fill:"#453527"}),caption);
    const baseline=svg("line",{x1:wall.x1,y1:wall.y1,x2:wall.x2,y2:wall.y2,stroke:"#594c42",
      "stroke-dasharray":"5 4","stroke-width":2,"vector-effect":"non-scaling-stroke","pointer-events":"none"});
    handles.replaceChildren(...(shift?[baseline]:[]),guide,badge,handle(...point(0),"start"),handle(...point(1),"end"),handle(...point(.5),shape?mode.value:"move"));
  }

  async function request(value, ticket) {
    if (pending || closed) return;
    const call=new AbortController();
    const sourceWall=wall.id, operation=mode.value;
    pending=call;
    try {
      const {config}=await import("./config.js");
      const response=await fetch(config.apiUrl+"/v1/partition-preview",{method:"POST",signal:call.signal,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({geometry:original,wall_id:sourceWall,
          mode:operation,offset:value,clearance})});
      const result=await response.json();
      if (closed || ticket!==revision || sourceWall!==wall.id || operation!==mode.value || !Number(distance.value)) return;
      if (!response.ok) throw Error(typeof result.detail==="string"?result.detail:result.error || "לא ניתן להחיל את ההזזה.");
      const data=result.data;
      paint(data.geometry,data.furniture,data.narrow_spans);
      const area=data.areas.map(r=>r.room+" "+r.before+" ← "+r.after+" מ״ר");
      const warnings=[...data.warnings];
      if (data.furniture.length) warnings.push(data.furniture.length+" רהיטים חורגים מסומנים באדום");
      const angle = Math.atan2(value,wallLength(wall))*180/Math.PI*(operation==="start"?-1:1);
      info.textContent=[value+" ס״מ",...(["start","end"].includes(operation)?["הטיה "+angle.toFixed(1)+"°"]:[]),...area,...warnings].join(" · ");
      if (ticket===revision) {
        approved=data.geometry;
        apply.disabled=false;
        if(commitRequested) close(approved);
      }
    } catch (error) {
      if (ticket!==revision || call.signal.aborted) return;
      approved=null; commitRequested=false;
      paint(original);
      info.textContent=error.message;
    } finally {
      pending=null;
      if (!closed && ticket!==revision && Number(distance.value) && distance.validity.valid)
        schedule();
    }
  }
  function schedule() {
    if (timer || pending || closed) return;
    timer=setTimeout(()=>{
      timer=null;
      request(Number(distance.value),revision);
    },35);
  }

  function update() {
    revision++;
    approved=null;
    apply.disabled=!Number(distance.value) || !distance.validity.valid;
    controls.querySelectorAll("[data-shape]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.shape===mode.value)));
    const value=Number(distance.value);
    drawHandles();
    if (!value || !distance.validity.valid) {
      clearTimeout(timer); timer=null;
      paint(original);
      info.textContent=["ellipse","bay","parallel"].includes(mode.value)
        ? "גררו את הידית האמצעית פנימה או החוצה. שתי נקודות הקצה נשארות במקומן."
        : "בחרו קיר בתוכנית. גררו את הידית האמצעית להזזה או ידית קצה להטיה.";
      return;
    }
    info.textContent="הסטה של "+value+" ס״מ · בודק את התוכנית";
    schedule();
  }
  function select(w) {
    commitRequested=false; wall=w; choice.value=w.id; distance.value=0; placeControls();
    paint(original); update();
  }
  function close(plan) {
    if(closed)return;
    const message="הקיר עודכן בטיוטה. "+info.textContent;
    closed=true; resize.disconnect(); revision++; clearTimeout(timer); pending?.abort();
    controller.abort();
    board.classList.remove("wall-edit-mode");
    controls.hidden=true; controls.classList.remove("dragging"); info.hidden=true;
    el("workspace").classList.remove("editing-partition");
    for (const node of locked) node.inert=false;
    finish(plan,message);
  }
  const cursor=e=>new DOMPoint(e.clientX,e.clientY).matrixTransform(board.getScreenCTM().inverse());
  board.addEventListener("pointerdown",e=>{
    if(e.target.closest("[data-measure]")) { openExact(); e.preventDefault(); return; }
    const handle=e.target.closest("[data-handle]")?.dataset.handle;
    if (!handle) {
      const node=e.target.closest("[data-kind]");
      const id=node?.dataset.kind==="openings"?original.openings.find(o=>o.id===node.dataset.id)?.wallId:node?.dataset.id;
      const hit=eligible.find(w=>w.id===id);
      if (hit) select(hit);
      return;
    }
    if (handle!==mode.value) distance.value=0;
    mode.value=handle;
    commitRequested=false; controls.classList.add("dragging");
    drag={id:e.pointerId,start:cursor(e),offset:Number(distance.value)};
    board.setPointerCapture(e.pointerId); e.preventDefault(); update();
  },options);
  board.addEventListener("pointermove",e=>{
    if (drag?.id!==e.pointerId) return;
    const p=cursor(e), start=drag.start, length=wallLength(wall);
    distance.value=Math.round(drag.offset+((p.x-start.x)*(wall.y1-wall.y2)+(p.y-start.y)*(wall.x2-wall.x1))/length);
    update();
  },options);
  function commit() {
    if (!Number(distance.value) || !distance.validity.valid) return;
    commitRequested=true;
    if(approved) close(approved);
    else schedule();
  }
  board.addEventListener("pointerup",e=>{
    if(drag?.id!==e.pointerId)return;
    drag=null; controls.classList.remove("dragging"); commit();
  },options);
  board.addEventListener("pointercancel",()=>{drag=null; controls.classList.remove("dragging"); distance.value=0; update();},options);
  choice.addEventListener("change",()=>select(eligible.find(w=>w.id===choice.value)),options);
  function changeShape(value) {
    commitRequested=false; mode.value=value; distance.value=0; paint(original); update();
  }
  mode.addEventListener("change",()=>changeShape(mode.value),options);
  controls.querySelectorAll("[data-shape]").forEach(b=>b.addEventListener("click",()=>changeShape(b.dataset.shape),options));
  function openExact() { exact.hidden=false; placeControls(); distance.focus({preventScroll:true}); distance.select(); }
  board.addEventListener("keydown",e=>{
    if(e.target.closest("[data-measure]") && ["Enter"," "].includes(e.key)){ e.preventDefault();openExact(); }
  },options);
  distance.addEventListener("input",update,options);
  exact.addEventListener("submit",e=>{e.preventDefault();commit();},options);
  el("wall-cancel").addEventListener("click",()=>close(null),options);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")close(null);},options);
  const requested=new URLSearchParams(location.search).get("wallMode");
  mode.value=[...mode.options].some(o=>o.value===requested)?requested:"move";
  select(wall);
  return ()=>close(null);
}
