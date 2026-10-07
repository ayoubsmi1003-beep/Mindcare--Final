/** Only stage and an allowlisted technical code enter diagnostics; never SQL messages or values. */
export function documentBoundaryDiagnostic(stage:"startup"|"session"|"transaction",cause:unknown):void{
 const code=typeof cause==="object"&&cause!==null&&"code" in cause?String(cause.code):"UNKNOWN";
 console.error("[db-boundary]",stage,/^[A-Z0-9_]{2,32}$/.test(code)?code:"UNKNOWN");
}
