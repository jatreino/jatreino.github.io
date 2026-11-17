'use strict';

// Medidas corporais (Ajustes → Meus dados). Tudo opcional; cada registro é datado para acompanhar a evolução.
// db.perfil.medidas = [{ data, gordura, musculo, visceral, pescoco, torax, braco, cintura, abdomen, quadril, coxa, panturrilha }]

const CAMPOS_MEDIDA = [
  // [campo, rótulo, unidade, mín, máx, grupo]
  ['gordura', 'Gordura corporal', '%', 2, 70, 'comp'],
  ['musculo', 'Massa muscular', 'kg', 10, 150, 'comp'],
  ['visceral', 'Gordura visceral', 'nível', 1, 60, 'comp'],
  ['pescoco', 'Pescoço', 'cm', 20, 70, 'circ'],
  ['torax', 'Tórax', 'cm', 50, 200, 'circ'],
  ['braco', 'Braço (contraído)', 'cm', 15, 80, 'circ'],
  ['cintura', 'Cintura', 'cm', 40, 200, 'circ'],
  ['abdomen', 'Abdômen (umbigo)', 'cm', 40, 200, 'circ'],
  ['quadril', 'Quadril', 'cm', 50, 200, 'circ'],
  ['coxa', 'Coxa', 'cm', 25, 120, 'circ'],
  ['panturrilha', 'Panturrilha', 'cm', 20, 70, 'circ'],
];
const med = { aberto: false, pre: null, lendo: false }; // pre: valores lidos de um PDF, aguardando conferência

const fmtMed = (v, casas = 1) => (v === null || v === undefined || v === '' ? '–'
  : (casas === 2 ? v.toFixed(2) : String(Math.round(v * 10 ** casas) / 10 ** casas)).replace('.', ','));
const medidasOrdenadas = () => [...(db.perfil.medidas || [])].sort((a, b) => b.data.localeCompare(a.data));

// Valor mais recente de cada campo (pode vir de registros diferentes)
function ultimasMedidas() {
  const r = {};
  for (const m of medidasOrdenadas()) for (const [c] of CAMPOS_MEDIDA) if (r[c] === undefined && m[c] != null) r[c] = { v: m[c], data: m.data };
  return r;
}

// % de gordura estimado pelo método da Marinha dos EUA (fita métrica), quando não foi informado
function gorduraEstimada(u) {
  const altura = num(db.perfil.altura), sexo = db.perfil.sexo;
  if (!altura || !u.pescoco) return null;
  const log = Math.log10;
  if (sexo === 'M') {
    const barriga = (u.abdomen || u.cintura)?.v;
    if (!barriga || barriga <= u.pescoco.v) return null;
    return 495 / (1.0324 - 0.19077 * log(barriga - u.pescoco.v) + 0.15456 * log(altura)) - 450;
  }
  if (sexo === 'F') {
    if (!u.cintura || !u.quadril) return null;
    const soma = u.cintura.v + u.quadril.v - u.pescoco.v;
    if (soma <= 0) return null;
    return 495 / (1.29579 - 0.35004 * log(soma) + 0.221 * log(altura)) - 450;
  }
  return null;
}

function indicadoresCorporais() {
  const u = ultimasMedidas();
  const altura = num(db.perfil.altura), peso = pesoEm(), sexo = db.perfil.sexo;
  const itens = [];
  let gord = u.gordura?.v ?? null, estimada = false;
  if (gord === null) { const e = gorduraEstimada(u); if (e !== null && e > 2 && e < 70) { gord = e; estimada = true; } }
  if (gord !== null) {
    itens.push(['Gordura corporal', `${fmtMed(gord)}%`, estimada ? 'estimada pela fita (método da Marinha dos EUA)' : '']);
    if (peso) {
      const gordaKg = peso * gord / 100;
      itens.push(['Massa gorda / magra', `${fmtMed(gordaKg)} kg / ${fmtMed(peso - gordaKg)} kg`, '']);
    }
  }
  if (u.cintura && u.quadril) {
    const rcq = u.cintura.v / u.quadril.v;
    const limite = sexo === 'F' ? 0.85 : sexo === 'M' ? 0.9 : null;
    itens.push(['Relação cintura/quadril', fmtMed(rcq, 2), limite ? (rcq >= limite ? `acima da referência (${fmtMed(limite, 2)})` : `dentro da referência (< ${fmtMed(limite, 2)})`) : 'informe o sexo para ver a referência']);
  }
  if (u.cintura && altura) {
    const rce = u.cintura.v / altura;
    itens.push(['Relação cintura/altura', fmtMed(rce, 2), rce >= 0.5 ? 'acima da referência (0,50)' : 'dentro da referência (< 0,50)']);
  }
  return itens;
}

function cartaoMedidas() {
  const lista = medidasOrdenadas();
  const u = ultimasMedidas();
  const anterior = (campo, data) => lista.find((m) => m.data < data && m[campo] != null)?.[campo];
  const pre = med.pre || {};
  const campo = ([c, rot, un]) => `<label>${rot} <span class="muted">(${un})</span><input inputmode="decimal" class="input-texto ${pre[c] != null ? 'do-pdf' : ''}" id="med-${c}" placeholder="${u[c] ? fmtMed(u[c].v) : ''}" value="${pre[c] != null ? fmtMed(pre[c], 2).replace(/,?0+$/, '') : ''}"></label>`;
  let h = `<div class="card"><h2>Medidas corporais</h2>
    <p class="muted small">Todas opcionais. Registre quando quiser (por exemplo, uma vez por mês) para acompanhar a evolução. Meça sempre do mesmo lado e no mesmo horário.</p>`;

  const comValor = CAMPOS_MEDIDA.filter(([c]) => u[c]);
  if (comValor.length) {
    h += `<div class="medidas-atuais">${comValor.map(([c, rot, un]) => {
      const ant = anterior(c, u[c].data);
      const dif = ant != null ? u[c].v - ant : null;
      return `<div class="medida"><span class="muted small">${rot}</span><b>${fmtMed(u[c].v)} ${un === 'nível' ? '' : un}</b>
        <span class="small muted">${fmtData(u[c].data)}${dif ? ` · <span class="${dif < 0 ? 'desce' : 'sobe'}">${dif > 0 ? '+' : ''}${fmtMed(dif)}</span>` : ''}</span></div>`;
    }).join('')}</div>`;
  }
  if (lista.length || (db.perfil.pesos || []).length > 1) h += '<a class="btn sec" href="#/progresso/corpo" style="margin:4px 0 10px">📈 Ver gráficos de evolução</a>';
  const ind = indicadoresCorporais();
  if (ind.length) {
    h += `<div class="indicadores">${ind.map(([n, v, obs]) => `<div class="linha entre small" style="padding:6px 0;border-top:1px solid var(--line)">
      <span>${n}${obs ? `<br><span class="muted">${obs}</span>` : ''}</span><b>${v}</b></div>`).join('')}</div>`;
  }

  const qtdPre = Object.keys(pre).filter((k) => k !== 'data' && k !== 'altura').length;
  h += `<details class="med-form" ${med.aberto || med.pre || !lista.length ? 'open' : ''}><summary class="linha entre"><b>${lista.length ? '+ Registrar novas medidas' : 'Registrar medidas'}</b><span class="seta">▾</span></summary>
    <div class="form">
      <label class="btn sec">${med.lendo ? 'Lendo o PDF...' : '📄 Importar de um PDF'}<input type="file" accept="application/pdf,.pdf" id="med-pdf" hidden ${med.lendo ? 'disabled' : ''}></label>
      ${med.pre ? `<div class="card destaque small" style="margin:0">Encontramos <b>${qtdPre} ${qtdPre === 1 ? 'valor' : 'valores'}</b> no PDF (destacados abaixo).
        Confira com o documento, corrija se precisar e toque em <b>Salvar medidas</b>.${pre.altura ? `<br>Altura no PDF: ${fmtMed(pre.altura)} cm${db.perfil.altura ? '' : ' (será salva em Meus dados)'}.` : ''}
        <button class="link-btn small" data-acao="med-descartar">Descartar valores do PDF</button></div>`
      : '<p class="muted small" style="margin:0">Avaliação física ou bioimpedância em PDF: o app tenta ler os valores e você confere antes de salvar.</p>'}
      <label>Data<input type="date" class="input-texto" id="med-data" value="${pre.data || isoDia()}" max="${isoDia()}"></label>
      <label>Peso <span class="muted">(kg)</span><input inputmode="decimal" class="input-texto ${pre.peso != null ? 'do-pdf' : ''}" id="med-peso" placeholder="${pesoEm() ? fmtKg(pesoEm()) : ''}" value="${pre.peso != null ? fmtMed(pre.peso) : ''}"></label>
      <p class="muted small" style="margin:0">Composição (balança de bioimpedância ou avaliação física)</p>
      <div class="grade-2">${CAMPOS_MEDIDA.filter((x) => x[5] === 'comp').map(campo).join('')}</div>
      <p class="muted small" style="margin:0">Circunferências (fita métrica)</p>
      <div class="grade-2">${CAMPOS_MEDIDA.filter((x) => x[5] === 'circ').map(campo).join('')}</div>
      <button class="btn" data-acao="med-salvar">Salvar medidas</button>
    </div></details>`;

  if (lista.length) {
    h += `<details style="margin-top:6px"><summary class="small muted">Histórico de medidas (${lista.length}) ▾</summary>
      ${lista.map((m) => `<div class="small" style="padding:8px 0;border-top:1px solid var(--line)">
        <div class="linha entre"><b>${fmtData(m.data)}/${m.data.slice(0, 4)}</b>
          <button class="btn-mini" data-acao="med-apagar" data-data="${m.data}" aria-label="Apagar medidas de ${fmtData(m.data)}">✕</button></div>
        <span class="muted">${CAMPOS_MEDIDA.filter(([c]) => m[c] != null).map(([c, rot, un]) => `${rot}: ${fmtMed(m[c])}${un === 'nível' ? '' : ` ${un}`}`).join(' · ')}</span></div>`).join('')}</details>`;
  }
  return h + '</div>';
}

function salvarMedidas() {
  const data = $('#med-data').value || isoDia();
  if (data > isoDia()) return toast('A data não pode ser no futuro');
  const novo = {};
  for (const [c, rot, , min, max] of CAMPOS_MEDIDA) {
    const bruto = $(`#med-${c}`).value.trim();
    if (!bruto) continue;
    const v = num(bruto);
    if (v === null || v < min || v > max) return toast(`${rot}: valor fora do esperado (${min} a ${max})`);
    novo[c] = v;
  }
  const brutoPeso = $('#med-peso').value.trim();
  const kg = brutoPeso ? num(brutoPeso) : null;
  if (brutoPeso && (kg === null || kg < 30 || kg > 300)) return toast('Peso: valor fora do esperado (30 a 300)');
  if (!Object.keys(novo).length && kg === null) return toast('Preencha pelo menos uma medida');
  if (Object.keys(novo).length) {
    const medidas = db.perfil.medidas || [];
    const existente = medidas.find((m) => m.data === data);
    if (existente) Object.assign(existente, novo);
    else medidas.push({ data, ...novo });
    db.perfil.medidas = medidas;
  }
  if (kg !== null) db.perfil.pesos = (db.perfil.pesos || []).filter((x) => x.data !== data).concat({ data, kg });
  if (med.pre?.altura && !db.perfil.altura) db.perfil.altura = String(Math.round(med.pre.altura));
  med.aberto = false; med.pre = null;
  salvar(); render(); toast('Medidas salvas');
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acao^="med-"]');
  if (!el) return;
  if (el.dataset.acao === 'med-salvar') salvarMedidas();
  else if (el.dataset.acao === 'med-descartar') { med.pre = null; render(); }
  else if (el.dataset.acao === 'med-apagar') {
    if (el.dataset.confirmando !== '1') { // confirmação no próprio botão (o aviso nativo falha em apps instalados no iPhone)
      el.dataset.confirmando = '1'; el.textContent = 'Apagar?';
      setTimeout(() => { if (el.isConnected) { el.dataset.confirmando = ''; el.textContent = '✕'; } }, 3000);
      return;
    }
    db.perfil.medidas = (db.perfil.medidas || []).filter((m) => m.data !== el.dataset.data);
    salvar(); render();
  }
});
document.addEventListener('toggle', (e) => { if (e.target.classList?.contains('med-form')) med.aberto = e.target.open; }, true);

// ---------- Progresso → Corpo: evolução do peso e das medidas ----------
// Série de um campo ao longo do tempo, no formato do grafico() de app.js ({ data, kg })
function serieCorpo(campo) {
  if (campo === 'peso') return [...(db.perfil.pesos || [])].sort((a, b) => a.data.localeCompare(b.data)).map((p) => ({ data: p.data, kg: p.kg }));
  const lista = [...(db.perfil.medidas || [])].sort((a, b) => a.data.localeCompare(b.data));
  if (campo === 'gordura') {
    // informada; se não houver no dia, estimada pela fita com as medidas daquele registro
    return lista.map((m) => {
      if (m.gordura != null) return { data: m.data, kg: m.gordura };
      const u = Object.fromEntries(CAMPOS_MEDIDA.filter(([c]) => m[c] != null).map(([c]) => [c, { v: m[c] }]));
      const e = gorduraEstimada(u);
      return e !== null && e > 2 && e < 70 ? { data: m.data, kg: Math.round(e * 10) / 10, estimada: true } : null;
    }).filter(Boolean);
  }
  return lista.filter((m) => m[campo] != null).map((m) => ({ data: m.data, kg: m[campo] }));
}

function cartaoEvolucao(nome, un, pts, obs = '') {
  const ult = pts[pts.length - 1], pri = pts[0];
  const dif = pts.length > 1 ? ult.kg - pri.kg : 0;
  const u = un === 'nível' ? '' : un === '%' ? '%' : ` ${un}`;
  return `<div class="card"><div class="linha entre"><b>${nome}</b><span class="muted small">${pts.length} registro${pts.length > 1 ? 's' : ''}</span></div>
    <div class="linha entre small"><span class="muted">Atual: <b style="color:var(--text)">${fmtMed(ult.kg)}${u}</b> em ${fmtData(ult.data)}</span>
      ${dif ? `<span class="muted">${dif > 0 ? '+' : ''}${fmtMed(dif)}${u} desde ${fmtData(pri.data)}/${pri.data.slice(2, 4)}</span>` : ''}</div>
    ${grafico(pts)}${obs ? `<p class="muted small" style="margin:6px 0 0">${obs}</p>` : ''}</div>`;
}

function telaProgressoCorpo() {
  const blocos = [];
  const peso = serieCorpo('peso');
  if (peso.length) blocos.push(cartaoEvolucao('Peso', 'kg', peso));
  const gord = serieCorpo('gordura');
  if (gord.length) blocos.push(cartaoEvolucao('Gordura corporal', '%', gord, gord.some((p) => p.estimada) ? 'Alguns pontos estimados pela fita (método da Marinha dos EUA).' : ''));
  for (const [c, rot, un] of CAMPOS_MEDIDA) {
    if (c === 'gordura') continue;
    const pts = serieCorpo(c);
    if (pts.length) blocos.push(cartaoEvolucao(rot, un, pts));
  }
  if (somenteLeitura) { // personal vendo o aluno
    return blocos.join('') || '<div class="vazio">O aluno ainda não registrou peso nem medidas.</div>';
  }
  if (!blocos.length) {
    return `<div class="vazio">Registre seu peso e suas medidas para acompanhar a evolução do corpo.
      <a class="btn" href="#/ajustes/dados">Registrar peso e medidas</a></div>`;
  }
  return `${blocos.join('')}<a class="btn sec" href="#/ajustes/dados">Registrar peso ou medidas</a>
    <p class="muted small">O gráfico aparece a partir do segundo registro.</p>`;
}

// ---------- Importar de PDF (avaliação física, bioimpedância) ----------
const semAcento = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// [campo, rótulos aceitos, rótulos a ignorar, mín, máx]
const ROTULOS_PDF = [
  ['peso', /\bpeso\b|peso corporal|massa corporal|\bweight\b/, /ideal|alvo|meta|controle|magr|livre|osse|residual|gordura|muscul|agua|perda|ganho|minimo|maximo/, 30, 300],
  ['altura', /\b(altura|estatura|height)\b/, /sentad|joelho|tronco/, 100, 230],
  ['gordura', /percentual de gordura|% ?(de )?gordura|gordura corporal|gordura \(%\)|\bpgc\b|\bbf\b|body fat|\bgordura\b/, /visceral|massa de gordura|massa gorda|controle|alvo|ideal/, 2, 70],
  ['musculo', /massa muscular|musculo esqueletico|massa musc|\bmme\b|\bsmm\b|skeletal muscle/, /controle|alvo|ideal|percentual|%/, 10, 150],
  ['visceral', /gordura visceral|nivel visceral|visceral fat|\bvisceral\b/, /area|cm2|cm²/, 1, 60],
  ['pescoco', /pescoco|\bneck\b/, null, 20, 70],
  ['torax', /torax|peitoral|\bpeito\b|\bchest\b/, null, 50, 200],
  ['braco', /\bbraco\b|\barm\b/, /antebraco/, 15, 80],
  ['cintura', /\bcintura\b|\bwaist\b/, /quadril|rcq|relacao|estatura|altura/, 40, 200],
  ['abdomen', /abdomen|abdominal|\babdome\b/, /quadril|relacao/, 40, 200],
  ['quadril', /\bquadril\b|\bhip\b/, /cintura|rcq|relacao/, 50, 200],
  ['coxa', /\bcoxa\b|\bthigh\b/, null, 25, 120],
  ['panturrilha', /panturrilha|\bperna\b|\bcalf\b/, null, 20, 70],
];
const RE_NUM = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(%|kg|cm|m\b)?/g;

function numerosDaLinha(texto) {
  const r = [];
  for (const m of texto.matchAll(RE_NUM)) {
    // ignora números grudados em letras (ex.: "T1", "cm2") e datas
    const antes = texto[m.index - 1] || ' ', depois = texto[m.index + m[0].length] || ' ';
    if (/[a-z/]/.test(antes) || /[/a-z]/.test(depois) && !m[2]) continue;
    r.push({ v: parseFloat(m[1].replace(',', '.')), un: m[2] || '' });
  }
  return r;
}

function lerMedidasDoTexto(textoOriginal) {
  const linhas = semAcento(textoOriginal).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const achado = {};
  for (const [campo, aceita, ignora, min, max] of ROTULOS_PDF) {
    const preferidas = [];
    linhas.forEach((l, i) => {
      const m = l.match(aceita);
      if (!m) return;
      // o que vem perto do rótulo decide se é a medida certa (a linha pode ter várias medidas)
      // trecho entre o número anterior e o próximo número
      const antes = l.slice(0, m.index), depois = l.slice(m.index + m[0].length);
      const iniAntes = Math.max(antes.search(/[\d%][^\d%]*$/) + 1, antes.length - 18, 0);
      const fimDepois = depois.search(/\d/);
      const perto = antes.slice(iniAntes) + m[0] + (fimDepois < 0 ? depois : depois.slice(0, fimDepois));
      if (ignora && ignora.test(perto)) return;
      if (/dobra|\bmm\b|skinfold/.test(perto)) return; // dobras cutâneas não são circunferência
      preferidas.push(i);
    });
    // braço: prefere o contraído; demais: a primeira ocorrência
    if (campo === 'braco') preferidas.sort((a, b) => /contra/.test(linhas[b]) - /contra/.test(linhas[a]));
    for (const i of preferidas) {
      const rotulo = linhas[i].match(aceita);
      const resto = linhas[i].slice(rotulo.index + rotulo[0].length);
      let nums = numerosDaLinha(resto);
      if (!nums.length) nums = numerosDaLinha(`${linhas[i + 1] || ''}`); // valor na linha de baixo (tabelas)
      let escolha = null;
      for (const n of nums) {
        let v = n.v;
        if (campo === 'altura' && (n.un === 'm' || v < 3)) v *= 100;
        if (campo === 'gordura' && n.un === 'kg') continue;
        if (campo === 'musculo' && n.un === '%') continue;
        if (v >= min && v <= max) { escolha = v; break; }
      }
      if (escolha !== null) { achado[campo] = Math.round(escolha * 10) / 10; break; }
    }
  }
  // Data da avaliação: a mais recente (até hoje) — a de nascimento fica de fora por ser antiga
  const datas = [...textoOriginal.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)].map(([, d, m, a]) => {
    const ano = a.length === 2 ? 2000 + +a : +a;
    return `${ano}-${pad(+m)}-${pad(+d)}`;
  }).filter((d) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d) && d <= isoDia() && d >= '2000-01-01').sort();
  if (datas.length) achado.data = datas[datas.length - 1];
  return achado;
}

async function importarMedidasPdf(arquivo) {
  med.lendo = true; render();
  let texto = '';
  try { texto = await textoDoPdf(arquivo); } catch (e) { texto = null; }
  med.lendo = false;
  if (texto === null) { render(); return toast('Não foi possível abrir este PDF.'); }
  if (texto.replace(/\s/g, '').length < 20) { render(); return toast('Este PDF parece ser uma imagem (escaneado). Digite os valores abaixo.'); }
  const achado = lerMedidasDoTexto(texto);
  const valores = Object.keys(achado).filter((k) => k !== 'data' && k !== 'altura');
  if (!valores.length) { render(); return toast('Não encontramos medidas neste PDF. Digite os valores abaixo.'); }
  med.pre = achado; med.aberto = true;
  render();
  $('.med-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('change', (e) => {
  if (e.target.id !== 'med-pdf') return;
  const arquivo = e.target.files?.[0];
  e.target.value = '';
  if (arquivo) importarMedidasPdf(arquivo);
});
