import { Message } from '@arco-design/web-react';
import { configService } from '@/common/config/configService';
import {
  buildKnowledgeAugmentedPrompt,
  hasKnowledgeContextBlock,
  retrieveKnowledgeContext,
} from '@/renderer/services/knowledgeBaseSearch';
import { inferKnowledgeRetrievalIntent } from '@/renderer/services/knowledgeRetrievalIntent';

const CHOICE_TIMEOUT_MS = 15_000;

type KnowledgeRetrievalChoice = {
  action: 'retrieve' | 'direct';
  query: string;
};

const clipText = (value: string, maxLength: number): string => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const escapeHtml = (value: string): string =>
  String(value || '').replace(/[<>&"]/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    return '&quot;';
  });

const ensureChoiceCardStyle = (): void => {
  if (document.getElementById('knowledge-retrieval-choice-card-style')) return;

  const style = document.createElement('style');
  style.id = 'knowledge-retrieval-choice-card-style';
  style.textContent =
    '.knowledge-retrieval-choice-wrap{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:2147483000;width:min(600px,calc(100vw - 32px));font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.knowledge-retrieval-choice-card{background:var(--bg-1);border:1px solid var(--aou-3);box-shadow:0 20px 56px rgba(78,44,32,.18);border-radius:10px;padding:16px;color:var(--color-text-1,#1d2129)}.knowledge-retrieval-choice-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}.knowledge-retrieval-choice-title{font-size:14px;font-weight:650;margin:0 0 4px}.knowledge-retrieval-choice-desc{font-size:12px;line-height:18px;color:var(--color-text-2,#4e5969);margin:0}.knowledge-retrieval-choice-close{appearance:none;border:0;background:transparent;color:var(--color-text-3,#86909c);font-size:18px;line-height:18px;padding:2px 4px;cursor:pointer}.knowledge-retrieval-choice-query{display:flex;gap:8px;align-items:center;margin:12px 0}.knowledge-retrieval-choice-query label{font-size:12px;color:var(--color-text-2,#4e5969);white-space:nowrap}.knowledge-retrieval-choice-query input{flex:1;min-width:0;border:1px solid var(--aou-3);border-radius:8px;background:var(--bg-1);color:var(--color-text-1,#1d2129);font-size:12px;padding:8px 10px;outline:none}.knowledge-retrieval-choice-query input:focus{border-color:var(--brand);box-shadow:0 0 0 2px rgba(192,117,90,.14)}.knowledge-retrieval-choice-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.knowledge-retrieval-choice-card button.knowledge-retrieval-choice-option{appearance:none;border:1px solid var(--aou-3);background:var(--aou-1);color:var(--color-text-1,#1d2129);border-radius:8px;padding:8px 12px;text-align:center;cursor:pointer;font-size:12px;font-weight:650}.knowledge-retrieval-choice-card button.knowledge-retrieval-choice-option[data-action=retrieve]{border-color:var(--brand);background:var(--brand-light)}.knowledge-retrieval-choice-card button.knowledge-retrieval-choice-option:hover{border-color:var(--brand);background:var(--brand-light)}.knowledge-retrieval-choice-foot{margin-top:10px;font-size:11px;color:var(--color-text-3,#86909c)}.knowledge-retrieval-choice-busy{padding:10px 0 2px;font-size:12px;color:var(--brand)}@media(max-width:560px){.knowledge-retrieval-choice-wrap{bottom:76px}.knowledge-retrieval-choice-card{padding:14px}.knowledge-retrieval-choice-query{align-items:stretch;flex-direction:column}.knowledge-retrieval-choice-actions{display:grid;grid-template-columns:1fr}}';
  document.head.appendChild(style);
};

const showKnowledgeRetrievalChoice = (question: string): Promise<KnowledgeRetrievalChoice> =>
  new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.body) {
      resolve({ action: 'direct', query: question });
      return;
    }

    ensureChoiceCardStyle();
    document.querySelectorAll('.knowledge-retrieval-choice-wrap').forEach((node) => node.remove());

    const wrapper = document.createElement('div');
    wrapper.className = 'knowledge-retrieval-choice-wrap';
    wrapper.innerHTML =
      '<div class="knowledge-retrieval-choice-card"><div class="knowledge-retrieval-choice-head"><div><div class="knowledge-retrieval-choice-title">是否检索知识库？</div><p class="knowledge-retrieval-choice-desc">检测到你可能希望基于知识库或企业资料回答。确认后会使用与手动勾选相同的知识库检索上下文。</p></div><button class="knowledge-retrieval-choice-close" data-action="direct" title="直接发送">×</button></div><div class="knowledge-retrieval-choice-query"><label>检索词</label><input value="' +
      escapeHtml(clipText(question, 160)) +
      '" /></div><div class="knowledge-retrieval-choice-actions"><button class="knowledge-retrieval-choice-option" data-action="direct">直接发送</button><button class="knowledge-retrieval-choice-option" data-action="retrieve">检索并发送</button></div><div class="knowledge-retrieval-choice-foot">15 秒未选择将直接发送，不会自动检索。</div></div>';

    document.body.appendChild(wrapper);

    const input = wrapper.querySelector('input');
    let settled = false;
    const timeout = window.setTimeout(() => settle('direct'), CHOICE_TIMEOUT_MS);

    function settle(action: KnowledgeRetrievalChoice['action']) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);

      const query = input?.value.trim() || question;
      wrapper.querySelectorAll('button,input').forEach((node) => {
        (node as HTMLButtonElement | HTMLInputElement).disabled = true;
      });

      if (action === 'retrieve') {
        const busy = document.createElement('div');
        busy.className = 'knowledge-retrieval-choice-busy';
        busy.textContent = '正在检索知识库...';
        wrapper.querySelector('.knowledge-retrieval-choice-card')?.appendChild(busy);
      }

      window.setTimeout(() => wrapper.remove(), action === 'retrieve' ? 220 : 80);
      resolve({ action, query });
    }

    wrapper.addEventListener('click', (event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-action]');
      if (button) settle(button.dataset.action === 'retrieve' ? 'retrieve' : 'direct');
    });

    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        settle('retrieve');
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        settle('direct');
      }
    });
  });

export const maybeAttachKnowledgeRetrievalContext = async (question: string, backend?: string): Promise<string> => {
  void backend;
  try {
    if (typeof question !== 'string' || !question.trim() || hasKnowledgeContextBlock(question)) {
      return question;
    }

    if (configService.get('vectorDB.enabled') !== true) {
      return question;
    }

    const intent = inferKnowledgeRetrievalIntent(question);
    if (!intent.shouldOffer) {
      return question;
    }

    const choice = await showKnowledgeRetrievalChoice(question);
    if (choice.action !== 'retrieve') {
      return question;
    }

    const { context, count } = await retrieveKnowledgeContext(choice.query);
    if (count > 0 && context) {
      return buildKnowledgeAugmentedPrompt(question, context);
    }

    Message.info('知识库中未找到相关内容，已按原始问题发送');
    return question;
  } catch (error) {
    console.error('[KnowledgeBase] retrieval failed:', error);
    Message.warning('知识库检索失败，请确认向量库服务已启动');
    return question;
  }
};
