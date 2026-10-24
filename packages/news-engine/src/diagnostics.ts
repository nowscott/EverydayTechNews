import type { Row } from './core.ts';
export const REQUEST_STRATEGY = 'length-evidence-repair-2';
const errors = new Set(['not object','text field','non_chinese_title','empty or excessive summary','lead_summary_over_150','short_summary_missing_or_over_80','points','uncertainties','missing evidence','unsupported evidence','incomplete response','invalid_review_schema','incomplete_review_coverage','review_evidence_missing','review_evidence_insufficient','review_verdict_conflict','invalid_edition_review_schema','incomplete_edition_review','invalid_edition_finding','edition_evidence_missing','edition_finding_evidence_incomplete','duplicate_requires_related_article','edition_review_coverage','edition_review_evidence_missing']);
export function errorCode(error: unknown): string {
 if(error instanceof SyntaxError)return 'invalid_json_response';
 const message=error instanceof Error?error.message:'';
 return errors.has(message)?message.replaceAll(' ','_'):'response_validation_failed';
}
export function stageOf(a:Row):string{return a.task_kind==='edition_review'?'edition_review':a.task_kind==='review'?'review':'generation';}
export function requestConstraints(a:Row,lastError?:string):Row {
 const constraints:Row={evidence:'证据只能从text逐字复制不少于8字符的连续原文；title只作上下文，不可作为正文证据。禁止拼接或改写引用；找不到正文支持时不得补写事实。'};
 if(!a.task_kind)Object.assign(constraints,{summary:'目标80–130字符，绝不超过150字符；保留主体、范围和计划/测试限定。',short_summary:'目标30–60字符，绝不超过80字符。',points:'最多3项，只写有正文依据的新增事实。'});
 if(a.task_kind==='review')constraints.verdict='逐项检查必须覆盖全部fields。总判决必须与逐项检查一致；有疑问应将相关check标为false并说明原因，不得所有check通过却给reject。证据只能引用text，不能引用title。';
 if(lastError)constraints.previous_error=lastError;
 return constraints;
}
