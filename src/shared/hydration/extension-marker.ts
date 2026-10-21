/** Remove the two observed extension-owned attributes before React compares the SSR tree.
 * No text, application attributes, security checks or hydration diagnostics change.
 * beforeInteractive runs this before Next invokes hydrateRoot.
 */
export const extensionMarkerScript = `(()=>{
 const markers=["bis_skin_checked","bis_register"];
 const selector=markers.map(marker=>"["+marker+"]").join(",");
 const strip=(node)=>markers.forEach(marker=>node.removeAttribute(marker));
 const clean=(node)=>{
  if(node.nodeType===1)strip(node);
  if(node.querySelectorAll)node.querySelectorAll(selector).forEach(strip);
 };
 document.querySelectorAll(selector).forEach(clean);
 new MutationObserver(records=>records.forEach(record=>{
  if(record.type==="attributes")strip(record.target);
  record.addedNodes.forEach(clean);
 })).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:markers});
})();`;
