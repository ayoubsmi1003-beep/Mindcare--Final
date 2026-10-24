/** psql record framing preserves JSON aggregates containing physical newlines. */
export function parseInspectionRows(output){
 const rows=[];let start=-1,depth=0,quoted=false,escaped=false;
 try{
  for(let i=0;i<output.length;i++){
   const c=output[i];
   if(start<0){if(/\s|\x1e/u.test(c))continue;if(c!=='{'&&c!=='[')throw Error();start=i;depth=1;continue;}
   if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
   if(c==='"')quoted=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;
   if(depth===0){rows.push(JSON.parse(output.slice(start,i+1)));start=-1;}
  }
  if(start>=0)throw Error();return rows;
 }catch{throw Error('InvalidInspectionResult');} // JSON parser errors must not echo inspected clinical content.
}
