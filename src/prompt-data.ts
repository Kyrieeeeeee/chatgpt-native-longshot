export interface Prompt { id: string; name: string; content: string; tags: string[]; favorite?: boolean; useCount?: number; lastUsedAt?: number }
export const PROMPT_KEY = 'nativeLongshot.prompts.v1';
export function parsePrompts(value: unknown): Prompt[] {
  const backup = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const raw = Array.isArray(value) ? value : backup?.prompts ?? (backup?.format === 'gemini-voyager.prompts.v1' ? backup.items : null);
  if (!Array.isArray(raw)) throw new Error('请选择提示词 JSON 数组、扩展备份或 Voyager 提示词备份。');
  return raw.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('提示词格式无效');
    const p = item as Record<string, unknown>;
    const content = p.content ?? p.text;
    const name = p.name ?? p.title ?? (typeof content === 'string' ? content.slice(0, 30) : '');
    if (typeof content !== 'string' || !content.trim() || typeof name !== 'string' || !name.trim()) throw new Error('提示词名称和内容不能为空');
    const tags = typeof p.tags === 'string' ? p.tags.split(/[,，]/) : Array.isArray(p.tags) ? p.tags : [];
    const usage = {
      ...(typeof p.useCount === 'number' && Number.isSafeInteger(p.useCount) && p.useCount > 0 ? {useCount:p.useCount} : {}),
      ...(typeof p.lastUsedAt === 'number' && Number.isFinite(p.lastUsedAt) && p.lastUsedAt > 0 ? {lastUsedAt:p.lastUsedAt} : {})
    };
    return { ...usage, ...(p.favorite === true ? {favorite:true} : {}), id: crypto.randomUUID(), name: name.trim(), content, tags: tags.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(Boolean) };
  });
}
export function filterPrompts(prompts: Prompt[], query: string): Prompt[] {
  const q = query.trim().toLocaleLowerCase();
  return prompts.filter(p => [p.name, p.content, ...p.tags].some(s => s.toLocaleLowerCase().includes(q)));
}

export function rankPrompts(prompts: Prompt[]): Prompt[] {
  return [...prompts].sort((a,b) => Number(!!b.favorite)-Number(!!a.favorite)
    || (b.useCount??0)-(a.useCount??0) || (b.lastUsedAt??0)-(a.lastUsedAt??0));
}

/** Rebuild only when stored data changes; keep field boundaries and stable sort. */
export function promptIndex(prompts: Prompt[]) {
  let ranked:Prompt[]|undefined,tags:string[]|undefined;
  const fields = new WeakMap<Prompt,string[]>();
  return {
    get tags(){return tags??=[...new Set(prompts.flatMap(p => p.tags))];},
    search(query: string): Prompt[] {
      const q = query.trim().toLocaleLowerCase();
      ranked??=rankPrompts(prompts);
      return q ? ranked.filter(p => {
        let values=fields.get(p);if(!values){values=[p.name,p.content,...p.tags].map(s=>s.toLocaleLowerCase());fields.set(p,values);}
        return values.some(s => s.includes(q));
      }) : ranked;
    }
  };
}

export function mergePrompts(existing:Prompt[],imported:Prompt[]):Prompt[]{
  // Preserve the existing equality and append order, including tags.join().
  const key=(p:Prompt)=>JSON.stringify([p.name,p.content,p.tags.join()]);
  const seen=new Set(existing.map(key)),next=[...existing];
  for(const p of imported){const signature=key(p);if(!seen.has(signature)){seen.add(signature);next.push(p);}}
  return next;
}
