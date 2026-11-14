export function documentAssetPath(version:string):string {
 if(version!=="v1"&&version!=="v2")throw new Error("DocumentRendererUnsupported");
 return `/documents/${version}/document.css`;
}
