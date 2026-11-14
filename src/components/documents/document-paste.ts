/** Keep only document semantics; pasted code, resources and arbitrary styles are discarded. */
export function sanitizeDocumentPaste(html:string):string {
 const parsed=new DOMParser().parseFromString(html,"text/html");
 parsed.querySelectorAll("script,style,img,iframe,object,embed,svg,link,meta").forEach(el=>el.remove());
 parsed.querySelectorAll("*").forEach(el=>{
  const field=el.tagName==="SPAN"?el.getAttribute("data-field"):null;
  const dir=el.getAttribute("dir"),align=el instanceof HTMLElement?el.style.textAlign:"";
  const start=el.tagName==="OL"?el.getAttribute("start"):null;
  for(const attribute of Array.from(el.attributes))el.removeAttribute(attribute.name);
  if(field&&/^[a-z][a-z0-9_]{0,63}$/.test(field))el.setAttribute("data-field",field);
  if(dir&&["auto","rtl","ltr"].includes(dir))el.setAttribute("dir",dir);
  if(["left","center","right","justify"].includes(align))el.setAttribute("style",`text-align:${align}`);
  if(start&&/^\d+$/.test(start)&&Number(start)>=1&&Number(start)<=10000)el.setAttribute("start",start);
 });
 return parsed.body.innerHTML;
}
