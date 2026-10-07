import type {Draft} from "@/shared/documents/types";
export function recoverDraft(latest:Draft,local:Draft|null,keepLocal:boolean):Draft {
 return keepLocal&&local?{...latest,content:local.content,variables:local.variables,documentDate:local.documentDate}:latest;
}
