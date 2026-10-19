/** The model may omit constants bound by the server; retain its unbound schema result separately. */
export function finalizeAlexaAdmission(trace,liveCall,schema,acceptedIds,dispatchedCall){
 const metadata=liveCall.name==='declare_request';
 const effectiveArgs=metadata?structuredClone(liveCall.args):dispatchedCall?structuredClone(dispatchedCall.args):null;
 const schemaValid=schema?.safeParse(effectiveArgs).success===true;
 return {...trace,id:liveCall.id,unboundSchemaValid:trace.valid,normalizedModelArgs:structuredClone(liveCall.args),effectiveArgs,
  admitted:liveCall.name==='declare_request'?schemaValid:acceptedIds.has(liveCall.id),
  valid:schemaValid&&(liveCall.name==='declare_request'||acceptedIds.has(liveCall.id))};
}
