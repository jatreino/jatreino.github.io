'use strict';

// Segurança: limpeza dos dados que chegam de fora antes de irem para a tela.
// Os textos livres (nomes, dicas, mensagens) já são escapados na hora de desenhar (esc). Aqui o cuidado é com
// os campos que o app usa como identificadores e números (ids de ficha, de exercício, de sessão, cargas e repetições),
// que entram em atributos e links. Vale para: dados vindos do servidor (inclusive os de alunos, vistos pelo personal
// e pelo administrador), programas enviados pelo personal, backups importados e a cópia guardada no aparelho.

const RE_ID_INVALIDO = /[^\w\-.]/g;
const sanearId = (v, max = 80) => (String(v ?? '').replace(RE_ID_INVALIDO, '').slice(0, max) || 'x');
const RE_VIDEO = /^[\w-]{6,20}$/;
const RE_NUMERO_TEXTO = /^[\d.,\- ]{0,12}$/;
const CHAVES_ID = new Set(['id', 'treino', 'programa', 'programaAtivo', 'paraAluno', 'substitui', 'aluno_id', 'professor_id']);
const MAPAS_POR_ID = new Set(['fichas', 'series', 'trocas', 'trocasComp']); // objetos cujas chaves são ids
const LIMITE_TEXTO = 5000;

function sanearValor(v, chave, profundidade = 0) {
  if (profundidade > 40) return null; // estrutura absurda: corta
  if (v === null || v === undefined) return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (CHAVES_ID.has(chave)) return sanearId(v);
    if (chave === 'video') return RE_VIDEO.test(v) ? v : undefined;
    if (chave === 'kg' || chave === 'reps') return RE_NUMERO_TEXTO.test(v) ? v : '';
    return v.length > LIMITE_TEXTO ? v.slice(0, LIMITE_TEXTO) : v;
  }
  if (Array.isArray(v)) {
    return v.slice(0, 20000).map((x) => (chave === 'ordem' && typeof x !== 'object' ? sanearId(x) : sanearValor(x, undefined, profundidade + 1)));
  }
  if (typeof v === 'object') {
    const novo = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const chaveNova = MAPAS_POR_ID.has(chave) ? sanearId(k) : k;
      const limpo = sanearValor(x, chaveNova, profundidade + 1);
      if (limpo !== undefined) novo[chaveNova] = limpo;
    }
    return novo;
  }
  return undefined; // funções e outros tipos não pertencem aos dados
}
// Dados completos do app (db) ou um programa isolado
const sanearDados = (d) => (d && typeof d === 'object' ? sanearValor(d) : d);
