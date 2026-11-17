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
const med = { aberto: false };

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
  const campo = ([c, rot, un]) => `<label>${rot} <span class="muted">(${un})</span><input inputmode="decimal" class="input-texto" id="med-${c}" placeholder="${u[c] ? fmtMed(u[c].v) : ''}"></label>`;
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
  const ind = indicadoresCorporais();
  if (ind.length) {
    h += `<div class="indicadores">${ind.map(([n, v, obs]) => `<div class="linha entre small" style="padding:6px 0;border-top:1px solid var(--line)">
      <span>${n}${obs ? `<br><span class="muted">${obs}</span>` : ''}</span><b>${v}</b></div>`).join('')}</div>`;
  }

  h += `<details class="med-form" ${med.aberto || !lista.length ? 'open' : ''}><summary class="linha entre"><b>${lista.length ? '+ Registrar novas medidas' : 'Registrar medidas'}</b><span class="seta">▾</span></summary>
    <div class="form">
      <label>Data<input type="date" class="input-texto" id="med-data" value="${isoDia()}" max="${isoDia()}"></label>
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
  if (!Object.keys(novo).length) return toast('Preencha pelo menos uma medida');
  const medidas = db.perfil.medidas || [];
  const existente = medidas.find((m) => m.data === data);
  if (existente) Object.assign(existente, novo);
  else medidas.push({ data, ...novo });
  db.perfil.medidas = medidas;
  med.aberto = false;
  salvar(); render(); toast('Medidas salvas');
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acao^="med-"]');
  if (!el) return;
  if (el.dataset.acao === 'med-salvar') salvarMedidas();
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
