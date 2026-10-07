export interface SaveState {readonly generation:number;readonly edit:number;readonly saved:number;readonly saving:number|null;readonly conflict:boolean}
type Action={type:"edit"}|{type:"start"|"failure"|"conflict";generation:number}|{type:"ack";generation:number;edit:number};
export function saveState(state:SaveState,action:Action):SaveState{
 if(action.type==="edit")return {...state,edit:state.edit+1};
 if(action.generation!==state.generation)return state;
 if(action.type==="start")return state.saving===null&&!state.conflict?{...state,saving:state.edit}:state;
 if(action.type==="ack")return {...state,saved:action.edit,saving:null};
 return {...state,saving:null,conflict:action.type==="conflict"};
}
