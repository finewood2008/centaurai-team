export type KnowledgeRetrievalIntent = {
  shouldOffer: boolean;
  confidence: 'none' | 'medium' | 'high';
  reason?: string;
  query?: string;
};

const NEGATED_RETRIEVAL_RE =
  /(不要|不用|无需|不需要|别|先别|不要用|不用查|不用检索|不要检索).{0,12}(知识库|資料庫|资料库|文档|文件|资料|檔案|knowledge|docs?|documents?)/i;

const KNOWLEDGE_BASE_INTENT_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: 'base-on-knowledge-source',
    pattern:
      /(根据|基于|依据|参考|参照|结合|按照|对照|用|利用).{0,18}(知识库|資料庫|资料库|本地资料|本地資料|本地文档|本地文件|企业资料|公司资料|公司制度|内部资料|项目资料|上传的资料|上传的文档|上传的文件|uploaded\s+(docs?|documents?|files?)|knowledge\s+base|local\s+(docs?|documents?|knowledge))/i,
  },
  {
    reason: 'retrieve-from-source',
    pattern:
      /(从|在|去).{0,10}(知识库|資料庫|资料库|本地资料|本地資料|本地文档|本地文件|企业资料|公司资料|公司制度|内部资料|项目资料|上传的资料|上传的文档|上传的文件|文档里|文件里|资料里|手册里|制度里|报告里|knowledge\s+base|docs?|documents?|files?).{0,16}(查|找|搜|检索|搜尋|搜索|提取|引用|总结|回答|核对|确认|retrieve|search|find|lookup|summari[sz]e|quote)/i,
  },
  {
    reason: 'action-on-source',
    pattern:
      /(查|找|搜|检索|搜尋|搜索|翻|提取|引用|总结|核对|确认|retrieve|search|find|lookup|summari[sz]e|quote).{0,18}(知识库|資料庫|资料库|本地资料|本地資料|本地文档|本地文件|企业资料|公司资料|公司制度|内部资料|项目资料|上传的资料|上传的文档|上传的文件|文档里|文件里|资料里|手册里|制度里|报告里|knowledge\s+base|local\s+(docs?|documents?|knowledge)|uploaded\s+(docs?|documents?|files?))/i,
  },
  {
    reason: 'answer-from-company-material',
    pattern:
      /(公司|企业|项目|团队|内部).{0,10}(制度|规范|手册|报告|资料|文档|文件|材料).{0,18}(怎么|如何|是什么|有哪些|多少|谁|何时|标准|流程|要求|条款|政策|规定|报销|合同)/i,
  },
];

export function inferKnowledgeRetrievalIntent(input: string): KnowledgeRetrievalIntent {
  const text = String(input || '').trim();
  if (text.length < 6) return { shouldOffer: false, confidence: 'none' };
  if (NEGATED_RETRIEVAL_RE.test(text)) {
    return { shouldOffer: false, confidence: 'none', reason: 'negated' };
  }

  for (const item of KNOWLEDGE_BASE_INTENT_PATTERNS) {
    if (item.pattern.test(text)) {
      return {
        shouldOffer: true,
        confidence: 'high',
        reason: item.reason,
        query: text,
      };
    }
  }

  return { shouldOffer: false, confidence: 'none' };
}
