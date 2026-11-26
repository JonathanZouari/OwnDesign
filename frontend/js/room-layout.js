import { addRoom, emptyPlan, roomBox } from "./plan.js";

// The template supplies a proposed contour only. The server trims it to the
// existing architectural shell; none of the template objects enter the plan.
export async function reshapeRoom(plan, roomId, settings) {
  const bounds = roomBox(plan,roomId);
  if (!bounds) throw Error("יש לבחור חדר עם מעטפת סגורה.");
  const cx = bounds.x + bounds.w/2, cy = bounds.y + bounds.h/2;
  const {width,length,rotation,shape} = settings;
  let points;
  if (shape === "ellipse") {
    const angle = rotation*Math.PI/180;
    points = Array.from({length:512}, (_,i) => {
      const t = 2*Math.PI*i/512;
      const x = width*Math.cos(t)/2, y = length*Math.sin(t)/2;
      return [cx+x*Math.cos(angle)-y*Math.sin(angle),cy+x*Math.sin(angle)+y*Math.cos(angle)];
    });
  } else {
    const template = addRoom(emptyPlan(),{...settings,name:"",type:"other"},cx-width/2,cy-length/2);
    points = template.walls.map(w=>[w.x1,w.y1]);
  }
  const {config} = await import("./config.js");
  const response = await fetch(config.apiUrl+"/v1/layout-audit/reshape",{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({geometry:plan,room_id:roomId,candidate:{...settings,points}}),
  });
  if (!response.ok) throw Error("לא ניתן ליצור גבול רציף בתוך מעטפת החדר. בדקו את מידות הצורה ואת חיבורי הקירות.");
  return (await response.json()).data;
}
