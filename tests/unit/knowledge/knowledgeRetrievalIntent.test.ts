import { describe, expect, it } from 'vitest';
import { inferKnowledgeRetrievalIntent } from '@/renderer/services/knowledgeRetrievalIntent';
import { buildKnowledgeAugmentedPrompt, hasKnowledgeContextBlock } from '@/renderer/services/knowledgeBaseSearch';

describe('knowledge retrieval intent', () => {
  it('does not offer retrieval from single broad keywords alone', () => {
    expect(inferKnowledgeRetrievalIntent('帮我写一篇关于知识库设计的文章').shouldOffer).toBe(false);
    expect(inferKnowledgeRetrievalIntent('这个文档应该怎么命名？').shouldOffer).toBe(false);
    expect(inferKnowledgeRetrievalIntent('帮我查一下').shouldOffer).toBe(false);
  });

  it('offers retrieval only when the user intends to use the knowledge source', () => {
    expect(inferKnowledgeRetrievalIntent('根据知识库里的销售政策回答客户折扣问题').shouldOffer).toBe(true);
    expect(inferKnowledgeRetrievalIntent('在公司制度里查一下报销标准').shouldOffer).toBe(true);
    expect(inferKnowledgeRetrievalIntent('请结合上传的文档总结一下交付风险').shouldOffer).toBe(true);
    expect(inferKnowledgeRetrievalIntent('直接用知识库里的资料回答客户问题').shouldOffer).toBe(true);
  });

  it('respects explicit no-retrieval intent', () => {
    expect(inferKnowledgeRetrievalIntent('不用检索知识库，直接根据常识回答').shouldOffer).toBe(false);
  });
});

describe('knowledge retrieval prompt wrapper', () => {
  it('uses one marker for manual and auto retrieval paths', () => {
    const prompt = buildKnowledgeAugmentedPrompt('怎么报销？', '[知识库 1] policy.md:\n按流程提交');

    expect(prompt).toContain('【知识库检索结果】');
    expect(prompt).toContain('用户问题：怎么报销？');
    expect(hasKnowledgeContextBlock(prompt)).toBe(true);
  });
});
