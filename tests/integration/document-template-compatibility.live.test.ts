import {describe,it,expect} from "vitest";
import {execFileSync} from "node:child_process";
type Template={doc_type:string;body_html:string};
function sql(database:string,query:string){return execFileSync("docker",["exec","mc-p3","psql","-U","postgres","-d",database,"-tA","-c",query],{encoding:"utf8",maxBuffer:4*1024*1024}).trim();}
function literal(value:string){return "convert_from(decode('"+Buffer.from(value).toString("base64")+"','base64'),'UTF8')";}
function normalized(html:string){return html.replace(/<\/(?:p|li|ul|ol)>/g," ").replace(/<[^>]*>/g,"").replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\s+/gu," ").trim();}
describe.skipIf(process.env["MINDCARE_DOCUMENTS_CHECKPOINT"]!=="1")("active four certificate wording compatibility",()=>{
 it("preserves all current body text and bound values when converting to closed JSON",()=>{
 const templates=JSON.parse(sql("mindcare","SELECT coalesce(jsonb_agg(jsonb_build_object('doc_type',doc_type,'body_html',body_html)),'[]') FROM app.document_templates t WHERE is_active AND doc_type::text<>'ordonnance' AND version=(SELECT max(version) FROM app.document_templates x WHERE x.cabinet_id=t.cabinet_id AND x.doc_type=t.doc_type)")) as Template[];
 expect(new Set(templates.map(t=>t.doc_type)).size).toBe(4);
 for(const template of templates){const nested:Record<string,Record<string,string>>={},flat:Record<string,string>={};
 for(const match of template.body_html.matchAll(/\{\{([a-zA-Z0-9_.]+)\}\}/g)){const path=match[1]!.split("."),root=path[0]!,key=path[1]!,value="VALEUR_"+match[1];(nested[root]??={})[key]=value;flat[path.join("_")]=value;}
 const old=sql("mindcare_documents_test_20261007","SELECT app.render_template("+literal(template.body_html)+","+literal(JSON.stringify(nested))+"::jsonb)");
 const current=sql("mindcare_documents_test_20261007","SELECT app.render_document_content(app.document_template_json("+literal(template.body_html)+"),"+literal(JSON.stringify(flat))+"::jsonb)");
 expect(normalized(current),template.doc_type).toBe(normalized(old.replace(/<h1[^>]*>.*?<\/h1>/gs,"")));
 }
 });
});
