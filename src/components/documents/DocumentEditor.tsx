"use client";

import {useEffect,useRef} from "react";

import {useEditor,EditorContent} from "@tiptap/react";

import type {JSONContent} from "@tiptap/core";

import {parseDocumentContent,resolveFields} from "@/shared/documents/content";

import type {DocumentContent,Variables} from "@/shared/documents/types";

import {documentsEditor as t} from "@/i18n/documents-editor";

import {documentExtensions} from "./document-extensions";

export function DocumentEditor({content,onChange,onError,headerHtml="",fieldValues={},invalid=false}:{readonly invalid?:boolean;readonly headerHtml?:string;readonly fieldValues?:Variables;readonly content:DocumentContent;readonly onChange:(c:DocumentContent)=>void;readonly onError:(message:string)=>void}){

 const displayed=resolveFields(content,fieldValues);
 const lastContent=useRef(content),lastFields=useRef(JSON.stringify(fieldValues));

 const editor=useEditor({extensions:documentExtensions,immediatelyRender:false,content:displayed as JSONContent,editorProps:{attributes:{class:"doc2-editor",role:"textbox","aria-label":t.edit},transformPastedHTML:html=>{const parsed=new DOMParser().parseFromString(html,"text/html");parsed.querySelectorAll("script,style,img,iframe,object,embed,svg").forEach(el=>el.remove());parsed.querySelectorAll("*").forEach(el=>{for(const attribute of Array.from(el.attributes))if(!["dir"].includes(attribute.name))el.removeAttribute(attribute.name);});return parsed.body.innerHTML;}},onUpdate:({editor:e})=>{try{onChange(parseDocumentContent(e.getJSON()));}catch{onError(t.invalidContent);}}});

 useEffect(()=>{if(invalid)return;const fields=JSON.stringify(fieldValues);if(content===lastContent.current&&fields===lastFields.current)return;lastContent.current=content;lastFields.current=fields;if(editor&&JSON.stringify(editor.getJSON())!==JSON.stringify(displayed))editor.commands.setContent(displayed as JSONContent,{emitUpdate:false});},[content,fieldValues,displayed,editor,invalid]);

 if(!editor)return null;

 const button=(label:string,action:()=>void,active?:boolean)=><button type="button" aria-label={label} aria-pressed={active} onMouseDown={e=>e.preventDefault()} onClick={action}>{label}</button>;

 return <div className="doc2-editing"><div className="doc2-toolbar" role="toolbar" aria-label={t.edit}>

 {button(t.bold,()=>{editor.chain().focus().toggleBold().run();},editor.isActive("bold"))}

 {button(t.italic,()=>{editor.chain().focus().toggleItalic().run();},editor.isActive("italic"))}

 {button(t.underline,()=>{editor.chain().focus().toggleUnderline().run();},editor.isActive("underline"))}

 {button(t.undo,()=>{editor.chain().focus().undo().run();})}{button(t.redo,()=>{editor.chain().focus().redo().run();})}
 <details className="doc2-format-menu"><summary>{t.formatting}</summary><div> {(["left","center","right","justify"] as const).map(a=><span key={a}>{button(t[a],()=>{editor.chain().focus().setTextAlign(a).run();})}</span>)}

 {button(t.bulletList,()=>{editor.chain().focus().toggleBulletList().run();})}{button(t.orderedList,()=>{editor.chain().focus().toggleOrderedList().run();})}

 {button(t.rtl,()=>{editor.chain().focus().updateAttributes("paragraph",{dir:"rtl"}).run();})}{button(t.ltr,()=>{editor.chain().focus().updateAttributes("paragraph",{dir:"ltr"}).run();})}

 {button(t.pageBreak,()=>{editor.chain().focus().insertContent({type:"pageBreak"}).run();})}



 {button(t.detachField,()=>{const node=editor.state.selection.$from.nodeAfter;if(node?.type.name==="field")editor.chain().focus().insertContent(String(node.attrs.value)).run();})}

</div></details>
 </div><div className="doc2-page doc2-editor-sheet"><div contentEditable={false} dangerouslySetInnerHTML={{__html:headerHtml}}/><EditorContent editor={editor}/></div></div>;

}

