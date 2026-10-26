// ══════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════
const CARD_W  = 185;
const CARD_H  = 72;
const COL_GAP = 44;
const SLOT_H  = CARD_H + 8;   // base slot height (card + gap between cards in R0)
const HDR_H   = 32;            // space above cards for round header

// Bracket templates: 8 / 16 / 32 teams.
const BRACKET_TEMPLATES={
  8:{names:['Quarterfinal','Semifinal','Final'],formats:['Best of 3','Best of 5','Best of 5'],wins:[2,3,3]},
  16:{names:['Round of 16','Quarterfinal','Semifinal','Final'],formats:['Best of 3','Best of 3','Best of 5','Best of 5'],wins:[2,2,3,3]},
  32:{names:['Round of 32','Round of 16','Quarterfinal','Semifinal','Final'],formats:['Best of 3','Best of 3','Best of 3','Best of 5','Best of 5'],wins:[2,2,2,3,3]}
};
let bracketSize=Number(localStorage.getItem('mlBracketSize'))||32;
function bracketConfig(){return BRACKET_TEMPLATES[bracketSize]||BRACKET_TEMPLATES[32];}
function finalRoundIndex(){return bracketConfig().names.length-1;}
function semifinalRoundIndex(){return finalRoundIndex()-1;}
function bracketRoundCount(){return bracketConfig().names.length;}
function updateBracketTemplateUI(){
  const sel=document.getElementById('bracket-template'); if(sel)sel.value=String(bracketSize);
  const info=document.getElementById('format-info');
  if(info)info.textContent=bracketConfig().names.slice(0,-1).join(' · ')+' = Best of 3 · Final = Best of 5';
}
const RNAMES=BRACKET_TEMPLATES[32].names;
const RFMTS=BRACKET_TEMPLATES[32].formats;
const RWIN=BRACKET_TEMPLATES[32].wins;
const WIN_3RD=3;

// Standard 32-team seeding — slot index → seed number
// Slots 0,1 = match 0 in R0; slots 2,3 = match 1, etc.
const BRACKET_SEEDS = [
   1,32, 16,17,  8,25,  9,24,
   5,28, 12,21,  4,29, 13,20,
   3,30, 14,19,  6,27, 11,22,
   7,26, 10,23,  2,31, 15,18
];

const DEF_NAMES = [
  'EL FAMILIYA','TLIP','Mie sedaap','Licik Esport',
  'KINGSTONE 2.0','Asepsap','TOPI MIRING SMADA','Amnesia'
];
const DEF_COLORS = [
  '#00d4ff','#7c3aed','#10b981','#f59e0b','#ef4444','#ec4899',
  '#06b6d4','#8b5cf6','#14b8a6','#f97316','#6366f1','#84cc16',
  '#22c55e','#3b82f6','#a855f7','#fb923c','#f43f5e','#2dd4bf',
  '#60a5fa','#c084fc','#34d399','#fbbf24','#818cf8','#4ade80',
  '#38bdf8','#e879f9','#a3e635','#fdba74','#fb7185','#67e8f9',
  '#d8b4fe','#bbf7d0'
];

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let teams = [];

/*
  matches[0..4][i] = main bracket (R32→Final)
  matches[5][0]    = 3rd place match (losers of both SF matches)

  Each match object:
    t1, t2  : team index into teams[] or null
    s1, s2  : scores or null
    win     : winning team index or null
    lose    : losing team index or null (tracked for SF→3rd place)
*/
let matches = [];
let activeR = null, activeI = null;

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
function initMatches(){
  matches=Array.from({length:6},()=>[]);
  const firstRoundMatches=bracketSize/2;
  for(let r=0;r<bracketRoundCount();r++){
    matches[r]=Array.from({length:firstRoundMatches/Math.pow(2,r)},()=>({t1:null,t2:null,s1:null,s2:null,win:null,lose:null}));
  }
  matches[5]=[{t1:null,t2:null,s1:null,s2:null,win:null,lose:null}];
  updateBracketTemplateUI();
}
async function setBracketTemplate(value){
  if(!isAdmin)return;
  const next=Number(value); if(!BRACKET_TEMPLATES[next]||next===bracketSize)return;
  const oldSize=bracketSize;
  if(!confirm(`Ganti template dari ${oldSize} Besar ke ${next} Besar?\n\nBracket dan hasil pertandingan saat ini akan dikosongkan. Data Team Pool tetap aman.`)){
    updateBracketTemplateUI();return;
  }
  bracketSize=next;localStorage.setItem('mlBracketSize',String(next));
  initMatches();renderBracket();renderStandings();
  try{
    setSyncState('syncing');
    const {error}=await sb.from('matches').delete().not('id','is',null);
    if(error)throw error;
    setSyncState('synced');toast(`Template ${next} Besar diterapkan ✓`,'ok');
  }catch(e){
    setSyncState('err');toast('Template lokal berubah, tetapi database gagal dibersihkan: '+(e.message||'unknown error'),'err');
  }
}

// ══════════════════════════════════════════════
// PROPAGATE
//   Winners advance up the main bracket (r0→r4).
//   Losers of SF (r3) go to 3rd place match (r5).
// ══════════════════════════════════════════════
function propagate(){
  const finalR=finalRoundIndex(),sfR=semifinalRoundIndex();
  for(let r=0;r<finalR;r++){
    matches[r].forEach((m,i)=>{
      const nm=matches[r+1][Math.floor(i/2)];
      if(i%2===0)nm.t1=m.win;else nm.t2=m.win;
    });
  }
  const sf0=matches[sfR][0],sf1=matches[sfR][1],m3=matches[5][0];
  m3.t1=sf0?sf0.lose:null;m3.t2=sf1?sf1.lose:null;
}

// ══════════════════════════════════════════════
// CLEAR DOWNSTREAM
// ══════════════════════════════════════════════
function clearDown(r,i){
  const finalR=finalRoundIndex(),sfR=semifinalRoundIndex();
  if(r<=finalR-1){
    let ci=i;
    for(let cr=r+1;cr<=finalR;cr++){
      ci=Math.floor(ci/2);const nm=matches[cr][ci];
      nm.s1=null;nm.s2=null;nm.win=null;nm.lose=null;
    }
    if(r===sfR){const m3=matches[5][0];m3.s1=null;m3.s2=null;m3.win=null;m3.lose=null;}
  }
}

// ══════════════════════════════════════════════
// LAYOUT MATH
//   Canvas uses 16 base slots (SLOT_H each).
//   cardTop(r,i): vertical center of match i in round r
//   cardLeft(r):  horizontal position of round r column
// ══════════════════════════════════════════════
function canvasHeight(){return bracketSize*SLOT_H;}
function cardTop(r,i){const spm=Math.pow(2,r);return HDR_H+i*spm*SLOT_H+(spm-1)*SLOT_H/2;}
function cardLeft(r){return r*(CARD_W+COL_GAP);}
function thirdPlaceLeft(){return cardLeft(semifinalRoundIndex());}

function thirdPlaceTop() {
  // Below the bracket canvas, with some margin
  return canvasHeight()+HDR_H+40;
}

// ══════════════════════════════════════════════
// RENDER BRACKET
// ══════════════════════════════════════════════
function renderBracket(){
  propagate();updateBracketTemplateUI();
  const canvas=document.getElementById('bcanvas');canvas.innerHTML='';
  const finalR=finalRoundIndex(),cfg=bracketConfig(),totalH=canvasHeight()+HDR_H+CARD_H+80,totalW=cardLeft(finalR+2)+175;
  canvas.style.width=totalW+'px';canvas.style.height=totalH+'px';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','bsvg');svg.setAttribute('width',totalW);svg.setAttribute('height',totalH);canvas.appendChild(svg);
  for(let r=0;r<=finalR;r++){
    const hdr=el('div','rhdr');hdr.style.cssText=`left:${cardLeft(r)}px;top:0`;
    hdr.innerHTML=`${cfg.names[r]}<span class="rfmt">${cfg.formats[r]}</span>`;canvas.appendChild(hdr);
    matches[r].forEach((m,i)=>{
      const card=buildCard(m,r,i,false);card.style.cssText=`left:${cardLeft(r)}px;top:${cardTop(r,i)}px`;
      canvas.appendChild(card);if(r<finalR)drawConnector(svg,r,i,false);
    });
  }
  const tp3=thirdPlaceTop(),tl3=thirdPlaceLeft(),m3=matches[5][0];
  const sep=el('div','rhdr bronze-hdr');sep.style.cssText=`left:${tl3}px;top:${tp3-28}px;width:auto;white-space:nowrap`;
  sep.innerHTML='🥉 Perebutan Juara 3<span class="rfmt">Best of 5</span>';canvas.appendChild(sep);
  const card3=buildCard(m3,5,0,true);card3.style.cssText=`left:${tl3}px;top:${tp3}px`;canvas.appendChild(card3);drawThirdPlaceConnectors(svg,tp3);
  const finalM=matches[finalR][0],champ=finalM.win!==null?teams[finalM.win]:null;
  const runner=finalM.lose!==null?teams[finalM.lose]:(finalM.win!==null?teams[finalM.win===finalM.t1?finalM.t2:finalM.t1]:null),third=m3.win!==null?teams[m3.win]:null;
  const cx=cardLeft(finalR+1),cy=cardTop(finalR,0)+CARD_H/2-65;
  const cc=el('div','podium-card champ-card');cc.style.cssText=`left:${cx}px;top:${cy}px`;
  const cl=champ&&champ.logo?`<img src="${champ.logo}" alt="${h(champ.name)}" style="width:40px;height:40px;object-fit:contain;border-radius:8px;margin-bottom:5px">`:'<div class="pc-crown">1</div>';
  cc.innerHTML=`${cl}<div class="pc-lbl">Champion</div><div class="pc-name">${champ?h(champ.name):'???'}</div>`;canvas.appendChild(cc);
  const rc=el('div','podium-card runner-card');rc.style.cssText=`left:${cx}px;top:${cy+98}px`;
  const rl=runner&&runner.logo?`<img src="${runner.logo}" alt="${h(runner.name)}" style="width:36px;height:36px;object-fit:contain;border-radius:8px;margin-bottom:5px">`:'<div class="pc-crown">2</div>';
  rc.innerHTML=`${rl}<div class="pc-lbl">Runner Up</div><div class="pc-name">${runner?h(runner.name):'???'}</div>`;canvas.appendChild(rc);
  const bc=el('div','podium-card bronze-card');bc.style.cssText=`left:${tl3+CARD_W+COL_GAP}px;top:${tp3+CARD_H/2-55}px`;
  const bl=third&&third.logo?`<img src="${third.logo}" alt="${h(third.name)}" style="width:36px;height:36px;object-fit:contain;border-radius:8px;margin-bottom:5px">`:'<div class="pc-crown">3</div>';
  bc.innerHTML=`${bl}<div class="pc-lbl">Juara 3</div><div class="pc-name">${third?h(third.name):'???'}</div>`;canvas.appendChild(bc);
}

// ══════════════════════════════════════════════
// BUILD MATCH CARD
// ══════════════════════════════════════════════
function buildCard(m, r, i, isBronze) {
  const t1   = m.t1 !== null ? teams[m.t1] : null;
  const t2   = m.t2 !== null ? teams[m.t2] : null;

  const w1   = m.win !== null && m.win === m.t1;
  const w2   = m.win !== null && m.win === m.t2;
  const done = m.s1 !== null;

  const card = el('div', 'mc' + (done?' done':'') + (isBronze?' bronze-match':''));
  card.addEventListener('click', () => { if(isAdmin) openModal(r, i); });

  if (done) {
    const cb = el('button','clrbtn');
    cb.title = 'Hapus hasil';
    cb.textContent = '✕';
    cb.addEventListener('click', e => { e.stopPropagation(); clearResult(r,i); });
    card.appendChild(cb);
  }

  const lbl = el('div','mid-lbl');
  lbl.textContent = isBronze ? 'M32 · 3RD PLACE' : `M${matchNum(r,i)}`;
  card.appendChild(lbl);

  card.appendChild(slotEl(t1, m.s1, w1, w2, isBronze, r, i, 1));
  card.appendChild(divEl());
  card.appendChild(slotEl(t2, m.s2, w2, w1, isBronze, r, i, 2));
  return card;
}

function matchNum(r,i){
  const starts={8:[0,4,6],16:[0,8,12,14],32:[0,16,24,28,30]};
  return (starts[bracketSize]||starts[32])[r]+i+1;
}

function slotEl(team, score, isW, isL, isBronze, r=0, matchIndex=0, side=1) {
  if (!team && r === 0 && isAdmin) {
    const d = el('div','tslot empty-slot');
    d.innerHTML = '<span class="empty-slot-plus">+</span><span class="empty-slot-label">Tambah Tim</span>';
    d.addEventListener('click', e => { e.stopPropagation(); openAddTeamModal(r, matchIndex, side); });
    return d;
  }
  const color  = team ? (team.color || '#64748b') : '#475569';
  const name   = team ? h(team.name) : 'TBD';
  const sc     = score !== null ? score : '–';
  const winCls = isBronze ? 'wbr' : 'w';
  const cls    = 'tslot' + (isW?' '+winCls:'') + (isL?' l':'');

  // Logo: image if uploaded, else initials
  let logoHTML;
  if (team && team.logo) {
    logoHTML = `<div class="tlogo" style="background:#0004;border:1px solid ${color}40;padding:1px">
      <img src="${team.logo}" style="width:100%;height:100%;object-fit:contain;border-radius:50%">
    </div>`;
  } else {
    const init = team ? team.name.split(' ').map(w=>w[0]).join('').slice(0,3).toUpperCase() : '?';
    logoHTML = `<div class="tlogo" style="background:${color}20;border:1px solid ${color}50;color:${color}">${init}</div>`;
  }

  const d = el('div', cls);
  d.innerHTML = `${logoHTML}<div class="tn">${name}</div><div class="ts">${sc}</div>`;
  return d;
}

function divEl() { const d=el('div','tdiv'); return d; }

// ══════════════════════════════════════════════
// SVG CONNECTORS
// ══════════════════════════════════════════════
function drawConnector(svg, r, i, _unused) {
  const x1 = cardLeft(r) + CARD_W;
  const y1 = cardTop(r, i) + CARD_H / 2;
  const ni = Math.floor(i / 2);
  const nx = cardLeft(r+1);
  const ny = cardTop(r+1, ni) + CARD_H / 2;
  const mx = x1 + COL_GAP / 2;
  svgPath(svg, `M${x1},${y1} H${mx} V${ny} H${nx}`, '#1e3a5f', 1.5, false);
}

function drawThirdPlaceConnectors(svg,tp3){
  const sfR=semifinalRoundIndex();
  [0,1].forEach(i=>{
    const sx=cardLeft(sfR)+CARD_W/2,sy=cardTop(sfR,i)+CARD_H,ty=tp3+CARD_H/2;
    const tx=thirdPlaceLeft()+(i===0?CARD_W*.25:CARD_W*.75);
    svgPath(svg,`M${sx},${sy} V${ty} H${tx}`,'#3d2a0a',1.5,true);
  });
}

function svgPath(svg, d, stroke, width, dashed) {
  const p = document.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d', d);
  p.setAttribute('stroke', stroke);
  p.setAttribute('stroke-width', width);
  p.setAttribute('fill', 'none');
  if (dashed) p.setAttribute('stroke-dasharray', '4 3');
  svg.appendChild(p);
}

// ══════════════════════════════════════════════
// MODAL
// ══════════════════════════════════════════════
function openModal(r, i) {
  if (!isAdmin) return;
  const m  = matches[r][i];
  const t1 = m.t1 !== null ? teams[m.t1] : null;
  const t2 = m.t2 !== null ? teams[m.t2] : null;
  if (!t1 && !t2) return;

  activeR = r; activeI = i;
  const isBronze = (r === 5);
  const isSF     = (r === 3);

  const title = document.getElementById('mtitle');
  title.textContent = isBronze ? 'PEREBUTAN JUARA 3' : 'INPUT SKOR';
  title.className   = isBronze ? 'bronze' : '';

  const wn = r === 5 ? WIN_3RD : bracketConfig().wins[r];
  document.getElementById('msub').textContent  = isBronze ? 'Best of 5 · 3rd Place Match' : `${bracketConfig().names[r]} · ${bracketConfig().formats[r]}`;
  document.getElementById('mn1').textContent   = t1 ? t1.name : 'TBD';
  document.getElementById('mn2').textContent   = t2 ? t2.name : 'TBD';
  document.getElementById('si1').value         = m.s1 !== null ? m.s1 : 0;
  document.getElementById('si2').value         = m.s2 !== null ? m.s2 : 0;
  document.getElementById('mhint').textContent = `Menang jika skor ≥ ${wn}`;
  document.getElementById('merr').textContent  = '';
  document.getElementById('overlay').classList.add('on');
  document.getElementById('si1').focus();
}

function closeModal() {
  document.getElementById('overlay').classList.remove('on');
  activeR = null; activeI = null;
}

function submitScore() {
  const m  = matches[activeR][activeI];
  const s1 = Math.max(0, parseInt(document.getElementById('si1').value)||0);
  const s2 = Math.max(0, parseInt(document.getElementById('si2').value)||0);
  const wn = activeR <= 4 ? RWIN[activeR] : WIN_3RD;
  const err = document.getElementById('merr');

  if (s1 > wn || s2 > wn)     { err.textContent='Skor melebihi batas seri'; return; }
  if (s1===wn && s2===wn)      { err.textContent='Tidak bisa keduanya menang'; return; }

  m.s1  = s1; m.s2  = s2;
  m.win = s1 >= wn ? m.t1 : s2 >= wn ? m.t2 : null;
  // Track loser (needed for SF → 3rd place)
  if (m.win !== null) {
    m.lose = (m.win === m.t1) ? m.t2 : m.t1;
  } else {
    m.lose = null;
  }

  clearDown(activeR, activeI);
  closeModal();
  renderBracket();
  renderStandings();
}

function clearResult(r, i) {
  const m = matches[r][i];
  m.s1=null; m.s2=null; m.win=null; m.lose=null;
  clearDown(r, i);
  renderBracket();
  renderStandings();
}

// ══════════════════════════════════════════════
// TEAM EDITOR
// ══════════════════════════════════════════════
function renderTeamEditor() {
  const g = document.getElementById('tgrid');
  g.innerHTML = '';
  const count=document.getElementById('team-count'); if(count) count.textContent=teams.length;
  teams.forEach((t,i) => {
    const c = el('div','tecard');

    const logoContent = t.logo
      ? `<img src="${t.logo}" alt="logo">`
      : `<span class="upload-hint">LOGO</span>`;

    const removeBtn = t.logo
      ? `<button class="logo-remove" title="Hapus logo" onclick="event.stopPropagation();removeLogo(${i})">✕</button>`
      : '';

    c.innerHTML = `
      <div class="sbadge">#${t.seed}</div>
      <div class="logo-upload">
        <div class="logo-preview" onclick="document.getElementById('lf${i}').click()" title="Upload logo tim">
          ${logoContent}
        </div>
        ${removeBtn}
        <input type="file" id="lf${i}" accept="image/*" onchange="uploadLogo(${i},this)">
      </div>
      <input class="ninp" type="text" value="${h(t.name)}"
        oninput="setName(${i},this.value)" onblur="saveTeamField(${i})" placeholder="Nama Tim">
      <button class="team-delete-btn" type="button" onclick="event.stopPropagation();removeTeam(${i})" title="Hapus tim">Hapus</button>`;
    g.appendChild(c);
  });
}

async function removeTeam(i) {
  if (!isAdmin) {
    toast('Login admin diperlukan untuk menghapus tim','err');
    return;
  }

  const t = teams[i];
  if (!t) return;

  const affected = [];
  matches.forEach((round, r) => round.forEach((m, j) => {
    if (m.t1 === i || m.t2 === i || m.win === i || m.lose === i) {
      affected.push({ r, i:j, dbId:m.dbId });
    }
  }));

  const warning = affected.length
    ? '\n\nTim ini sudah dipakai di ' + affected.length + ' match. Slot dan hasil match terkait akan dikosongkan.'
    : '';

  if (!confirm('Hapus tim "' + t.name + '" dari Team Pool?' + warning)) return;

  const deleted = await dbDeleteTeam(t.id || null, affected);
  if (!deleted) return;

  matches.forEach(round => round.forEach(m => {
    const remap = key => {
      if (m[key] === i) return null;
      if (typeof m[key] === 'number' && m[key] > i) return m[key] - 1;
      return m[key];
    };

    const hadDeletedTeam = [m.t1,m.t2,m.win,m.lose].some(v => v === i);
    m.t1 = remap('t1');
    m.t2 = remap('t2');
    m.win = remap('win');
    m.lose = remap('lose');

    if (hadDeletedTeam) {
      m.s1 = null;
      m.s2 = null;
      m.win = null;
      m.lose = null;
    }
  }));

  teams.splice(i, 1);
  teams.forEach((team, idx) => { team.seed = idx + 1; });

  renderTeamEditor();
  renderBracket();
  renderStandings();
  refreshExistingTeamOptions();
  toast('Tim "' + t.name + '" berhasil dihapus', 'ok');
}

async function removeAllTeams() {
  if (!isAdmin) {
    toast('Login admin diperlukan untuk menghapus semua tim','err');
    return;
  }

  if (teams.length === 0) {
    toast('Team Pool sudah kosong','info');
    return;
  }

  const ok = confirm(
    'HAPUS SEMUA TIM?\n\nSemua tim akan dihapus dari Team Pool dan semua slot/hasil bracket akan dikosongkan. Tindakan ini tidak bisa dibatalkan.'
  );
  if (!ok) return;

  const deleted = await dbDeleteAllTeams();
  if (!deleted) return;

  teams = [];
  initMatches();
  renderTeamEditor();
  renderBracket();
  renderStandings();
  refreshExistingTeamOptions();
  toast('Semua tim berhasil dihapus ✓','ok');
}
function uploadLogo(i, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    alert('Ukuran file maksimal 2MB'); return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    teams[i].logo = e.target.result;
    renderTeamEditor();
    renderBracket();
    dbSaveTeams();
  };
  reader.readAsDataURL(file);
}

function removeLogo(i) {
  teams[i].logo = null;
  renderTeamEditor();
  renderBracket();
  dbSaveTeams();
}

async function setName(i,v){ teams[i].name=v||`Tim ${i+1}`; renderBracket(); renderStandings(); }
async function saveTeamField(i){ const ok=await dbSaveTeams(); if(ok) toast('Perubahan tim tersimpan','ok'); }



// ══════════════════════════════════════════════
// MANUAL TEAM DRAW / BRACKET SETUP
// ══════════════════════════════════════════════
let addTeamRound = 0;
let addTeamPosition = 0;
let addTeamSide = 1;
let addTeamPoolMode = false;

function assignedTeamIndexes() {
  const set = new Set();
  matches.forEach(round => round.forEach(m => {
    if (m.t1 !== null) set.add(m.t1);
    if (m.t2 !== null) set.add(m.t2);
  }));
  return set;
}

function refreshExistingTeamOptions() {
  const sel = document.getElementById('existing-team-select');
  if (!sel) return;
  const used = assignedTeamIndexes();
  sel.innerHTML = '<option value="">— Pilih tim —</option>';

  teams.forEach((t,i) => {
    if (used.has(i)) return;
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = t.name || ('Tim ' + (i+1));
    sel.appendChild(opt);
  });
}

function openTeamPoolModal() {
  if (!isAdmin) {
    toast('Login admin diperlukan untuk menambah tim','err');
    return;
  }
  addTeamPoolMode = true;
  document.getElementById('existing-team-select').closest('.add-team-section').style.display = 'none';
  document.getElementById('add-team-manage-note').style.display = 'none';
  document.getElementById('new-team-section').style.display = '';
  document.getElementById('add-team-sub').textContent = 'Buat tim baru yang nanti bisa dipilih dari setiap slot bracket.';
  document.getElementById('new-team-name').value = '';
  document.getElementById('add-team-error').textContent = '';
  document.getElementById('add-team-overlay').classList.add('on');
  document.getElementById('new-team-name').focus();
}

function openAddTeamModal(r=0, i=null, side=null) {
  if (!isAdmin) {
    toast('Login admin diperlukan untuk menambah tim','err');
    return;
  }
  addTeamPoolMode = false;
  document.getElementById('existing-team-select').closest('.add-team-section').style.display = '';
  document.getElementById('add-team-manage-note').style.display = '';
  document.getElementById('new-team-section').style.display = 'none';

  if (i === null) {
    i = matches[0].findIndex(m => m.t1 === null || m.t2 === null);
    if (i < 0) {
      toast('Semua 32 slot ronde pertama sudah terisi','info');
      return;
    }
  }

  addTeamRound = r;
  addTeamPosition = i;
  addTeamSide = side || (matches[r][i].t1 === null ? 1 : 2);
  refreshExistingTeamOptions();

  document.getElementById('existing-team-select').value = '';
  document.getElementById('new-team-name').value = '';
  document.getElementById('add-team-error').textContent = '';
  document.getElementById('add-team-sub').textContent = 'Match ' + matchNum(r,i) + ' · ' + (addTeamSide === 1 ? 'Team 1' : 'Team 2') + ' — pilih tim yang sudah ada atau buat baru.';

  document.getElementById('add-team-overlay').classList.add('on');
  document.getElementById('existing-team-select').focus();
}

function closeAddTeamModal() {
  addTeamPoolMode = false;
  document.getElementById('existing-team-select').closest('.add-team-section').style.display = '';
  document.getElementById('add-team-manage-note').style.display = '';
  document.getElementById('add-team-overlay').classList.remove('on');
  document.getElementById('add-team-error').textContent = '';
}

async function confirmAddTeam() {
  if (!isAdmin) return;

  const err = document.getElementById('add-team-error');
  const existing = document.getElementById('existing-team-select').value;
  const newName = document.getElementById('new-team-name').value.trim();

  if (addTeamPoolMode) {
    if (!newName) {
      err.textContent = 'Masukkan nama tim.';
      document.getElementById('new-team-name').focus();
      return;
    }
    if (teams.some(t => (t.name || '').trim().toLowerCase() === newName.toLowerCase())) {
      err.textContent = 'Nama tim itu sudah ada.';
      return;
    }
    teams.push({name:newName, seed:teams.length+1, logo:null, color:'#64748b'});
    const saved = await dbSaveTeams();
    if (!saved) { teams.pop(); return; }
    closeAddTeamModal();
    renderTeamEditor();
    renderBracket();
    renderStandings();
    toast(newName + ' ditambahkan ke Team Pool', 'ok');
    return;
  }

  const m = matches[addTeamRound][addTeamPosition];

  if ((addTeamSide === 1 && m.t1 !== null) || (addTeamSide === 2 && m.t2 !== null)) {
    err.textContent = 'Slot ini sudah terisi.';
    return;
  }

  let teamIndex = null;

  if (existing !== '') {
    teamIndex = Number(existing);
    if (!Number.isInteger(teamIndex) || !teams[teamIndex]) {
      err.textContent = 'Tim yang dipilih tidak valid.';
      return;
    }
  } else {
    err.textContent = 'Pilih tim dari Team Management terlebih dahulu.';
    return;
  }

  if (addTeamSide === 1) m.t1 = teamIndex;
  else m.t2 = teamIndex;
  m.s1 = null;
  m.s2 = null;
  m.win = null;
  m.lose = null;

  closeAddTeamModal();
  renderBracket();
  renderTeamEditor();
  renderStandings();

  const saved = await dbSaveMatch(addTeamRound, addTeamPosition);
  if (saved) {
    toast(teams[teamIndex].name + ' ditambahkan ke bracket ✓', 'ok');
  }
}

async function clearBracketSetup() {
  if (!isAdmin) {
    toast('Login admin diperlukan untuk mengosongkan bracket','err');
    return;
  }

  if (!confirm('Kosongkan semua slot bracket dan hasil pertandingan? Data tim tetap disimpan.')) return;

  initMatches();
  renderBracket();
  renderStandings();

  let ok = true;
  for (let r=0; r<matches.length; r++) {
    for (let i=0; i<matches[r].length; i++) {
      if (!(await dbSaveMatch(r,i))) ok = false;
    }
  }

  toast(
    ok ? 'Bracket dikosongkan ✓' : 'Bracket lokal dikosongkan, tapi ada data yang gagal disimpan',
    ok ? 'ok' : 'err'
  );
}

// ══════════════════════════════════════════════
// STANDINGS
// ══════════════════════════════════════════════
function renderStandings() {
  const finalM = matches[finalRoundIndex()][0];
  const m3     = matches[5][0];

  const stats = teams.map((t,i) => {
    let w=0, l=0, gw=0, maxR=-1;
    let isChamp=false, isRunner=false, is3rd=false, isElim=false;

    for(let r=0; r<=5; r++) {
      matches[r].forEach(m => {
        if(m.s1===null) return;
        if(m.t1!==i && m.t2!==i) return;
        // Total individual games won across completed BO3/BO5 series.
        gw += m.t1 === i ? (Number(m.s1) || 0) : (Number(m.s2) || 0);
        // 3rd place is displayed at semifinal level.
        const rLabel = (r===5) ? semifinalRoundIndex() : r;
        maxR = Math.max(maxR, rLabel);
        if(m.win===i) {
          w++;
          if(r===4) isChamp  = true;
          if(r===5) is3rd    = true;
        } else if(m.win!==null) {
          l++;
          if(r===4) isRunner = true;       // lost the Final → Runner Up 🥈
          else if(r!==3 && r!==5) isElim = true; // lost R32-QF → eliminated
          // r===3 losers go to 3rd place match, not yet eliminated
          // r===5 losers → 4th place, eliminated after 3rd place
          if(r===5) isElim = true;
        }
      });
    }

    const status = isChamp  ? 'champ'
                 : isRunner ? 'runner'
                 : is3rd    ? '3rd'
                 : isElim   ? 'elim'
                 : maxR>=0  ? 'active'
                 : 'wait';

    return {t, i, w, l, gw, maxR, status};
  });

  // Sort: 1st Champion, 2nd Runner-up, 3rd 3rd-place, then active by round, then eliminated, then waiting
  const ORDER = {champ:0, runner:1, '3rd':2, active:3, wait:4, elim:5};
  stats.sort((a,b) => {
    if(a.status!==b.status) return ORDER[a.status]-ORDER[b.status];
    if(b.maxR!==a.maxR) return b.maxR-a.maxR;
    return a.t.seed-b.t.seed;
  });

  const RSHORT=bracketConfig().names.map(n=>n==='Round of 32'?'R32':n==='Round of 16'?'R16':n==='Quarterfinal'?'QF':n==='Semifinal'?'SF':'Final');
  const MEDAL  = {champ:'1',runner:'2','3rd':'3'};
  const PCLS   = {champ:'p1',runner:'p2','3rd':'p3'};
  const SCLS   = {champ:'sa',runner:'sa','3rd':'sa',active:'sa',elim:'se',wait:'sw'};
  const STXT   = {champ:'Champion',runner:'Runner Up','3rd':'Juara 3',
                  active:'Aktif',elim:'Gugur',wait:'Menunggu'};

  document.getElementById('stbody').innerHTML = stats.map((s,pos) => {
    const rl    = s.maxR>=0 ? RSHORT[s.maxR] : '–';
    const medal = MEDAL[s.status] ? `<span class="rank-mark ${PCLS[s.status]}">${MEDAL[s.status]}</span>` : '';
    const nb    = pos===0?'p1':pos===1?'p2':pos===2?'p3':'';
    return `<tr>
      <td><span class="pb ${nb}">${pos+1}</span></td>
      <td><div style="display:flex;align-items:center;gap:7px">
        <div class="team-avatar" style="--team-color:${s.t.color || '#64748b'}">${s.t.logo ? `<img src="${s.t.logo}" alt="">` : h((s.t.name||"?").slice(0,1).toUpperCase())}</div>
        <span class="standing-team">${h(s.t.name)}</span>${medal}
      </div></td>
      <td style="color:var(--muted);font-size:11px">${rl}</td>
      <td style="color:var(--win)">${s.w}</td>
      <td style="color:var(--win);font-weight:700">${s.gw}</td>
      <td style="color:var(--lose)">${s.l}</td>
      <td><span class="sb ${SCLS[s.status]}">${STXT[s.status]}</span></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════
function showTab(name, el_) {
  if (name === 'teams' && !isAdmin) return;
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('panel-'+name).classList.add('on');
  el_.classList.add('on');
  if(name==='teams')     renderTeamEditor();
  if(name==='standings') renderStandings();
}

// ══════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════
function el(tag, cls) {
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  return e;
}

function h(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}



async function exportData() {
  try {
    if (typeof XLSX === 'undefined') {
      toast('Library Excel belum siap. Coba lagi.', 'err');
      return;
    }

    setSyncState('syncing');
    await dbLoadTeams();
    initMatches();
    await dbLoadMatches();
    propagate();

    const exportedAt = new Date();
    const results = [];
    for (let r = 0; r <= 5; r++) {
      matches[r].forEach((m, i) => {
        if (m.s1 === null && m.s2 === null) return;
        results.push({
          'Babak': r === 5 ? 'Perebutan Juara 3' : bracketConfig().names[r],
          'Format': r === 5 ? 'Best of 5' : bracketConfig().formats[r],
          'Match': r === 5 ? 'M32' : 'M' + matchNum(r, i),
          'Tim 1': m.t1 !== null ? teams[m.t1].name : 'TBD',
          'Skor 1': m.s1 ?? '',
          'Tim 2': m.t2 !== null ? teams[m.t2].name : 'TBD',
          'Skor 2': m.s2 ?? '',
          'Pemenang': m.win !== null ? teams[m.win].name : '',
          'Tanggal Export': exportedAt.toLocaleString('id-ID')
        });
      });
    }

    const teamRows = teams.slice().sort((a,b) => a.seed - b.seed).map(t => ({
      'Seed': t.seed,
      'Tim': t.name,
      'Logo': t.logo || ''
    }));

    const wb = XLSX.utils.book_new();
    const wsResults = XLSX.utils.json_to_sheet(results.length ? results : [{'Babak':'Belum ada pertandingan selesai'}]);
    const wsTeams = XLSX.utils.json_to_sheet(teamRows);
    const wsStandings = XLSX.utils.table_to_sheet(document.querySelector('#panel-standings table'));

    wsResults['!cols'] = [
      {wch:22},{wch:14},{wch:10},{wch:24},{wch:10},
      {wch:24},{wch:10},{wch:24},{wch:22}
    ];
    wsTeams['!cols'] = [{wch:8},{wch:28},{wch:14},{wch:55}];

    XLSX.utils.book_append_sheet(wb, wsResults, 'Hasil Pertandingan');
    XLSX.utils.book_append_sheet(wb, wsTeams, 'Tim');
    XLSX.utils.book_append_sheet(wb, wsStandings, 'Standings');

    const date = exportedAt.toISOString().slice(0,10);
    XLSX.writeFile(wb, 'ML-Tournament-' + date + '.xlsx', {compression:true});

    setSyncState('synced');
    toast('File Excel berhasil diunduh ✓', 'ok');
  } catch (e) {
    console.error('Export Excel error:', e);
    setSyncState('err');
    toast('Gagal export Excel: ' + (e.message || 'unknown error'), 'err');
  }
}

document.getElementById('overlay').addEventListener('click',function(e){if(e.target===this)closeModal();});
document.getElementById('add-team-overlay').addEventListener('click',function(e){if(e.target===this)closeAddTeamModal();});
document.getElementById('tournament-overlay').addEventListener('click',function(e){if(e.target===this)closeTournamentModal();});
document.addEventListener('keydown',e=>{
  if(activeR===null) return;
  if(e.key==='Enter') submitScore();
  if(e.key==='Escape') closeModal();
});

// ══════════════════════════════════════════════
// SUPABASE CONFIG
// ══════════════════════════════════════════════
const SUPABASE_URL = 'https://gjivbsvukpepxpajmvyw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqaXZic3Z1a3BlcHhwYWptdnl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDM5ODYsImV4cCI6MjA5ODA3OTk4Nn0.lBiToMkZnXVj63TthgwlpMsR0tA13urHLlJYVIYaHy8';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ══════════════════════════════════════════════
// TOAST & SYNC UI
// ══════════════════════════════════════════════
let toastTimer = null;
function toast(msg, type='info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function setSyncState(state) {
  // state: 'syncing' | 'synced' | 'err'
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-txt');
  dot.className = 'sync-dot ' + state;
  txt.textContent = state==='syncing' ? 'Menyimpan...' : state==='synced' ? 'Tersimpan' : 'Gagal sync';
}

function hideLoading() {
  document.getElementById('loading-screen').classList.add('hidden');
}

// ══════════════════════════════════════════════
// DB — TEAMS
// ══════════════════════════════════════════════
async function dbLoadTeams() {
  const { data, error } = await sb.from('teams').select('*').order('seed');
  if (error) { console.error(error); return false; }
  if (data && data.length > 0) {
    teams = data.map(row => ({
      id:    row.id,
      name:  row.name,
      color: row.color,
      seed:  row.seed,
      logo:  row.logo_url || null
    }));
    return true;
  }

  // Team Pool kosong: tampilkan data pendaftaran HMC sebagai seed lokal.
  // Jika admin sedang login, seed ini langsung dipersist ke Supabase.
  const registeredTeams = [
    {name:'EL FAMILIYA', color:'#00d4ff', seed:1, logo:'https://drive.google.com/uc?export=view&id=1P-LHnaxIOHjtcqck-ZZlLSj4IIxuX5Bf'},
    {name:'TLIP', color:'#7c3aed', seed:2, logo:'https://drive.google.com/uc?export=view&id=1Ny0Ji0InJf4mIYq-36bno-affsVyc2Qp'},
    {name:'Mie sedaap', color:'#10b981', seed:3, logo:'https://drive.google.com/uc?export=view&id=1_VQMubkxjT4DDTkLNxXXyztV8QSZvt5h'},
    {name:'Licik Esport', color:'#f59e0b', seed:4, logo:'https://drive.google.com/uc?export=view&id=1_Dqf1e7xVqzOGruMnhAXjtm5knEvLZb_'},
    {name:'KINGSTONE 2.0', color:'#ef4444', seed:5, logo:'https://drive.google.com/uc?export=view&id=1GnHEStb97qUrempDBLV_bZxfYZMnOx52'},
    {name:'Asepsap', color:'#ec4899', seed:6, logo:'https://drive.google.com/uc?export=view&id=1X3tDAOq3tPNdJdPf7a-xI5Svr81eZvoC'},
    {name:'TOPI MIRING SMADA', color:'#06b6d4', seed:7, logo:null},
    {name:'Amnesia', color:'#8b5cf6', seed:8, logo:'https://drive.google.com/uc?export=view&id=1RoTXE8MCEeXZvS_z8b25YufkJ8i5As19'}
  ];
  teams = registeredTeams.map(t => ({...t, id:null}));
  if (isAdmin) {
    const saved = await dbSaveTeams();
    if (saved) return true;
  }
  return true;
}

async function dbLoadMatches() {
  const { data, error } = await sb
    .from('matches')
    .select('*')
    .order('round')
    .order('position');

  if (error) {
    console.error('Load matches error:', error);
    return false;
  }
  if (!data || data.length === 0) return true;

  // Rebuild local bracket from Supabase.
  // Database enforces one row per (round, position).
  initMatches();

  data.forEach(row => {
    const r = row.round;
    const i = row.position;
    if (r > 5 || !matches[r] || !matches[r][i]) return;

    const t1idx   = row.team1_id  !== null ? teams.findIndex(t => t.id === row.team1_id)  : null;
    const t2idx   = row.team2_id  !== null ? teams.findIndex(t => t.id === row.team2_id)  : null;
    const winIdx  = row.winner_id !== null ? teams.findIndex(t => t.id === row.winner_id) : null;
    const loseIdx = row.loser_id  !== null ? teams.findIndex(t => t.id === row.loser_id)  : null;

    matches[r][i] = {
      dbId: row.id,
      t1: t1idx !== null && t1idx >= 0 ? t1idx : null,
      t2: t2idx !== null && t2idx >= 0 ? t2idx : null,
      s1: row.score1 !== null ? row.score1 : null,
      s2: row.score2 !== null ? row.score2 : null,
      win: winIdx !== null && winIdx >= 0 ? winIdx : null,
      lose: loseIdx !== null && loseIdx >= 0 ? loseIdx : null
    };
  });

  return true;
}

function getTournamentSnapshot() {
  propagate();
  const finalM = matches[finalRoundIndex()][0];
  const m3 = matches[5][0];
  const champion = finalM.win !== null ? teams[finalM.win] : null;
  const runnerUp = finalM.lose !== null
    ? teams[finalM.lose]
    : (finalM.win !== null ? teams[finalM.win === finalM.t1 ? finalM.t2 : finalM.t1] : null);
  const third = m3.win !== null ? teams[m3.win] : null;

  return {
    version: 1,
    saved_at: new Date().toISOString(),
    teams: teams.map(t => ({name:t.name, seed:t.seed, logo:t.logo || null})),
    matches: matches.map(round => round.map(m => ({
      t1:m.t1, t2:m.t2, s1:m.s1, s2:m.s2, win:m.win, lose:m.lose
    }))),
    podium: {
      champion: champion ? champion.name : null,
      runner_up: runnerUp ? runnerUp.name : null,
      third_place: third ? third.name : null
    }
  };
}

function openTournamentSave() {
  if (!isAdmin) {
    toast('Login admin diperlukan untuk menyimpan turnamen','err');
    return;
  }
  document.getElementById('tournament-modal-title').textContent = 'SIMPAN TURNAMEN';
  document.getElementById('tournament-modal-sub').textContent = 'Simpan snapshot tim, bracket, skor, dan hasil akhir ke database.';
  document.getElementById('tournament-save-view').style.display = '';
  document.getElementById('tournament-history-view').style.display = 'none';
  const input = document.getElementById('tournament-name-input');
  input.value = 'ML Tournament — ' + new Date().toLocaleDateString('id-ID');
  document.getElementById('tournament-overlay').classList.add('on');
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function closeTournamentModal() {
  document.getElementById('tournament-overlay').classList.remove('on');
}

async function confirmSaveTournament() {
  if (!isAdmin) return;
  const input = document.getElementById('tournament-name-input');
  const name = input.value.trim();
  if (!name) {
    toast('Nama turnamen wajib diisi','err');
    input.focus();
    return;
  }

  try {
    setSyncState('syncing');
    const snapshot = getTournamentSnapshot();
    const { error } = await sb.from('tournaments').insert({name, snapshot});
    if (error) throw error;

    setSyncState('synced');
    closeTournamentModal();
    toast('Turnamen berhasil disimpan ✓','ok');
  } catch (e) {
    console.error('Save tournament error:', e);
    setSyncState('err');
    toast('Gagal simpan turnamen: ' + (e.message || 'unknown error'),'err');
  }
}

async function openTournamentHistory() {
  document.getElementById('tournament-modal-title').textContent = 'RIWAYAT TURNAMEN';
  document.getElementById('tournament-modal-sub').textContent = 'Arsip turnamen yang sudah disimpan di Supabase.';
  document.getElementById('tournament-save-view').style.display = 'none';
  document.getElementById('tournament-history-view').style.display = '';
  const list = document.getElementById('tournament-list');
  list.innerHTML = '<div class="tournament-empty">Memuat riwayat...</div>';
  document.getElementById('tournament-overlay').classList.add('on');

  const { data, error } = await sb
    .from('tournaments')
    .select('id,name,snapshot,created_at')
    .order('created_at', { ascending:false })
    .limit(30);

  if (error) {
    console.error('Load tournament history error:', error);
    list.innerHTML = '<div class="tournament-empty">Gagal memuat riwayat.</div>';
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<div class="tournament-empty">Belum ada turnamen tersimpan.</div>';
    return;
  }

  list.innerHTML = data.map(row => {
    const p = row.snapshot?.podium || {};
    const dt = new Date(row.created_at).toLocaleString('id-ID');
    return `<div class="tournament-item">
      <div class="tournament-item-head">
        <div class="tournament-item-name">${h(row.name)}</div>
        <div class="tournament-item-date">${h(dt)}</div>
      </div>
      <div class="tournament-podium">
        🥇 ${h(p.champion || '???')} · 🥈 ${h(p.runner_up || '???')} · 🥉 ${h(p.third_place || '???')}<br>
        ${Array.isArray(row.snapshot?.teams) ? row.snapshot.teams.length : 0} tim · data bracket tersimpan
      </div>
    </div>`;
  }).join('');
}

async function dbSaveTeams() {
  setSyncState('syncing');
  // Separate teams that already have DB id (update) vs new ones (insert)
  const toUpdate = teams.filter(t => t.id);
  const toInsert = teams.filter(t => !t.id);

  if (toUpdate.length > 0) {
    for (const t of toUpdate) {
      const { error } = await sb.from('teams').update({
        name: t.name, seed: t.seed, logo_url: t.logo || null
      }).eq('id', t.id);
      if (error) { setSyncState('err'); toast('Gagal simpan tim: '+error.message,'err'); return false; }
    }
  }

  if (toInsert.length > 0) {
    const rows = toInsert.map(t => ({
      name: t.name, seed: t.seed, logo_url: t.logo || null
    }));
    const { data, error } = await sb.from('teams').insert(rows).select();
    if (error) { setSyncState('err'); toast('Gagal simpan tim: '+error.message,'err'); return false; }
    // Assign returned IDs back to teams
    if (data) {
      data.forEach((row, i) => { toInsert[i].id = row.id; });
    }
  }

  setSyncState('synced');
  return true;
}

async function dbDeleteTeam(teamId, affected) {
  setSyncState('syncing');

  try {
    if (teamId) {
      // Jangan bergantung pada state bracket browser.
      // Cari langsung semua match di database yang masih mereferensikan tim ini.
      const refFilter = [
        'team1_id.eq.' + teamId,
        'team2_id.eq.' + teamId,
        'winner_id.eq.' + teamId,
        'loser_id.eq.' + teamId
      ].join(',');

      const { data: refs, error: findError } = await sb
        .from('matches')
        .select('id')
        .or(refFilter);

      if (findError) throw findError;

      if (refs && refs.length > 0) {
        const { error: clearError } = await sb
          .from('matches')
          .update({
            team1_id: null,
            team2_id: null,
            score1: null,
            score2: null,
            winner_id: null,
            loser_id: null
          })
          .or(refFilter);

        if (clearError) throw clearError;
      }

      // Pastikan tidak ada foreign-key reference yang tertinggal.
      const { data: remaining, error: verifyError } = await sb
        .from('matches')
        .select('id')
        .or(refFilter);

      if (verifyError) throw verifyError;
      if (remaining && remaining.length > 0) {
        throw new Error('Masih ada match yang mereferensikan tim ini.');
      }

      const { error: deleteError } = await sb
        .from('teams')
        .delete()
        .eq('id', teamId);

      if (deleteError) throw deleteError;
    }

    setSyncState('synced');
    return true;
  } catch (e) {
    console.error('Delete team error:', e);
    setSyncState('err');
    toast('Gagal hapus tim: ' + (e.message || 'unknown error'), 'err');
    return false;
  }
}

async function dbDeleteAllTeams() {
  setSyncState('syncing');

  try {
    // Lepaskan semua foreign-key references dari matches terlebih dahulu.
    const { error: clearError } = await sb
      .from('matches')
      .update({
        team1_id: null,
        team2_id: null,
        score1: null,
        score2: null,
        winner_id: null,
        loser_id: null
      })
      .not('id', 'is', null);

    if (clearError) throw clearError;

    // Setelah semua reference aman, hapus seluruh Team Pool.
    const { error: deleteError } = await sb
      .from('teams')
      .delete()
      .not('id', 'is', null);

    if (deleteError) throw deleteError;

    setSyncState('synced');
    return true;
  } catch (e) {
    console.error('Delete all teams error:', e);
    setSyncState('err');
    toast('Gagal hapus semua tim: ' + (e.message || 'unknown error'), 'err');
    return false;
  }
}
async function dbSaveMatch(r, i) {
  const m  = matches[r][i];
  const t1 = m.t1 !== null ? teams[m.t1] : null;
  const t2 = m.t2 !== null ? teams[m.t2] : null;
  const winner = m.win  !== null ? teams[m.win]  : null;
  const loser  = m.lose !== null ? teams[m.lose] : null;

  const row = {
    round:      r,
    position:   i,
    team1_id:   t1     ? t1.id     : null,
    team2_id:   t2     ? t2.id     : null,
    score1:     m.s1,
    score2:     m.s2,
    winner_id:  winner ? winner.id : null,
    loser_id:   loser  ? loser.id  : null,
  };

  setSyncState('syncing');

  // Satu slot bracket = satu row DB.
  // UNIQUE(round, position) + upsert mencegah duplicate match rows,
  // termasuk saat data lama belum punya dbId di browser.
  const { data, error } = await sb
    .from('matches')
    .upsert(row, { onConflict: 'round,position' })
    .select()
    .single();

  if (error) {
    console.error('Save match error:', error);
    setSyncState('err');
    toast('Gagal simpan match: '+error.message,'err');
    return false;
  }

  if (data) matches[r][i].dbId = data.id;

  setSyncState('synced');
  return true;
}

async function dbClearMatch(r, i) {
  const m = matches[r][i];
  if (!m.dbId) return;
  setSyncState('syncing');
  const row = { score1:null, score2:null, winner_id:null, loser_id:null };
  const { error } = await sb.from('matches').update(row).eq('id', m.dbId);
  if (error) { setSyncState('err'); toast('Gagal hapus hasil: '+error.message,'err'); return; }
  setSyncState('synced');
}

// ══════════════════════════════════════════════
// DB — LOGO UPLOAD
// ══════════════════════════════════════════════
async function dbUploadLogo(teamIdx, file) {
  const t    = teams[teamIdx];
  // Semua logo sudah dinormalisasi ke PNG persegi oleh normalizeLogoFile().
  const path = `team-${t.id || teamIdx}.png`;

  setSyncState('syncing');
  const { error: upErr } = await sb.storage.from('team-logos').upload(path, file, { upsert: true });
  if (upErr) { setSyncState('err'); toast('Gagal upload logo: '+upErr.message,'err'); return null; }

  const { data } = sb.storage.from('team-logos').getPublicUrl(path);
  const url = data.publicUrl;

  // Save URL to teams table
  const { error: dbErr } = await sb.from('teams').update({ logo_url: url }).eq('id', t.id);
  if (dbErr) { setSyncState('err'); toast('Gagal simpan URL logo','err'); return null; }

  setSyncState('synced');
  toast('Logo berhasil diupload ✓', 'ok');
  return url;
}

async function dbRemoveLogo(teamIdx) {
  const t = teams[teamIdx];
  setSyncState('syncing');
  const { error } = await sb.from('teams').update({ logo_url: null }).eq('id', t.id);
  if (error) { setSyncState('err'); toast('Gagal hapus logo','err'); return; }
  setSyncState('synced');
}

// ══════════════════════════════════════════════
// OVERRIDE uploadLogo to use Supabase Storage
// ══════════════════════════════════════════════
// Auto-crop latar luar: cari area terang/berwarna yang membentuk emblem,
// lalu masukkan area tersebut ke kanvas persegi tanpa meregangkan gambar.
async function normalizeLogoFile(file) {
  const bitmap = await createImageBitmap(file);
  const work = document.createElement('canvas');
  work.width = bitmap.width;
  work.height = bitmap.height;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  if (!wctx) {
    bitmap.close();
    throw new Error('Browser tidak mendukung pemrosesan gambar.');
  }
  wctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const image = wctx.getImageData(0, 0, work.width, work.height);
  const { data, width, height } = image;
  const rowHits = new Uint32Array(height);
  const colHits = new Uint32Array(width);

  // Ambang ini mengabaikan latar gelap dan mencari detail terang pada emblem.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luminance > 112 && (max - min > 22 || luminance > 165)) {
        rowHits[y]++;
        colHits[x]++;
      }
    }
  }

  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  const rowThreshold = Math.max(2, Math.round(width * 0.012));
  const colThreshold = Math.max(2, Math.round(height * 0.012));
  while (top < bottom && rowHits[top] < rowThreshold) top++;
  while (bottom > top && rowHits[bottom] < rowThreshold) bottom--;
  while (left < right && colHits[left] < colThreshold) left++;
  while (right > left && colHits[right] < colThreshold) right--;

  // Sisakan sedikit ruang di sekitar logo setelah latar terpangkas.
  const padX = Math.round((right - left + 1) * 0.045);
  const padY = Math.round((bottom - top + 1) * 0.045);
  left = Math.max(0, left - padX);
  right = Math.min(width - 1, right + padX);
  top = Math.max(0, top - padY);
  bottom = Math.min(height - 1, bottom + padY);

  const cropW = right - left + 1;
  const cropH = bottom - top + 1;
  const square = Math.max(cropW, cropH);
  const sx = Math.max(0, Math.floor((left + right + 1 - square) / 2));
  const sy = Math.max(0, Math.floor((top + bottom + 1 - square) / 2));
  const safeW = Math.min(square, width - sx);
  const safeH = Math.min(square, height - sy);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung pemrosesan gambar.');
  ctx.clearRect(0, 0, 512, 512);
  const scale = Math.min(448 / safeW, 448 / safeH);
  const dw = safeW * scale, dh = safeH * scale;
  ctx.drawImage(work, sx, sy, safeW, safeH,
    (512 - dw) / 2, (512 - dh) / 2, dw, dh);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('Gagal memproses gambar logo.')), 'image/png');
  });
  const dot = file.name.lastIndexOf('.');
  const baseName = (dot > 0 ? file.name.slice(0, dot) : file.name) || 'logo-tim';
  return new File([blob], baseName + '-fit.png', { type: 'image/png' });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Gagal membaca gambar logo.'));
    reader.readAsDataURL(file);
  });
}

async function uploadLogo(i, input) {
  const originalFile = input.files[0];
  if (!originalFile) return;
  if (originalFile.size > 2 * 1024 * 1024) {
    toast('Maksimal ukuran file awal 2MB', 'err');
    input.value = '';
    return;
  }

  try {
    if (!isAdmin) {
      toast('Login admin diperlukan untuk mengganti logo', 'err');
      input.value = '';
      return;
    }

    setSyncState('syncing');
    toast('Menyesuaikan logo otomatis…', 'info');
    const file = await normalizeLogoFile(originalFile);
    const preview = await fileToDataURL(file);
    teams[i].logo = preview;
    renderTeamEditor();
    renderBracket();

    const url = await dbUploadLogo(i, file);
    if (url) {
      teams[i].logo = url;
      renderTeamEditor();
      renderBracket();
      toast('Logo otomatis disesuaikan dan tersimpan ✓', 'ok');
    }
  } catch (e) {
    console.error('Logo normalization/upload error:', e);
    setSyncState('err');
    toast('Gagal memproses logo: ' + (e.message || 'kesalahan tidak diketahui'), 'err');
  } finally {
    const picker = document.getElementById('lf' + i);
    if (picker) picker.value = '';
  }
}

async function removeLogo(i) {
  teams[i].logo = null;
  renderTeamEditor(); renderBracket();
  await dbRemoveLogo(i);
}

// ══════════════════════════════════════════════
// OVERRIDE submitScore to save to DB
// ══════════════════════════════════════════════
async function submitScore() {
  if (!isAdmin) {
    toast('Login admin diperlukan untuk menyimpan skor','err');
    return;
  }

  const m  = matches[activeR][activeI];
  const s1 = Math.max(0, parseInt(document.getElementById('si1').value)||0);
  const s2 = Math.max(0, parseInt(document.getElementById('si2').value)||0);
  const wn = activeR <= 4 ? RWIN[activeR] : WIN_3RD;
  const err = document.getElementById('merr');

  if (s1 > wn || s2 > wn)   { err.textContent='Skor melebihi batas seri'; return; }
  if (s1===wn && s2===wn)    { err.textContent='Tidak bisa keduanya menang'; return; }

  m.s1  = s1; m.s2 = s2;
  m.win = s1 >= wn ? m.t1 : s2 >= wn ? m.t2 : null;
  if (m.win !== null) m.lose = (m.win === m.t1) ? m.t2 : m.t1;
  else m.lose = null;

  const savedR = activeR, savedI = activeI;
  clearDown(activeR, activeI);
  closeModal();
  renderBracket();
  renderStandings();

  const saved = await dbSaveMatch(savedR, savedI);
  if (saved) {
    toast('Skor tersimpan ✓', 'ok');
  } else {
    // dbSaveMatch already shows the real database error.
    toast('Skor belum tersimpan ke database','err');
  }
}

// ══════════════════════════════════════════════
// OVERRIDE clearResult to sync DB
// ══════════════════════════════════════════════
async function clearResult(r, i) {
  const m = matches[r][i];
  m.s1=null; m.s2=null; m.win=null; m.lose=null;
  clearDown(r, i);
  renderBracket(); renderStandings();
  await dbClearMatch(r, i);
  toast('Hasil dihapus', 'info');
}

// ══════════════════════════════════════════════
// OVERRIDE setName & setColor to sync DB
// ══════════════════════════════════════════════
let nameTimer = null;
function setName(i, v) {
  teams[i].name = v || `Tim ${i+1}`;
  renderBracket(); renderStandings();
  clearTimeout(nameTimer);
  nameTimer = setTimeout(()=>dbSaveTeams(), 800); // debounce
}


// ══════════════════════════════════════════════
// OVERRIDE resetAll
// ══════════════════════════════════════════════
async function resetAll() {
  if(!isAdmin) {
    toast('Login admin diperlukan untuk reset','err');
    return;
  }

  if(!confirm('Reset semua hasil pertandingan?\nNama tim tetap tersimpan.')) return;

  setSyncState('syncing');

  try {
    const { data, error } = await sb
      .from('matches')
      .update({
        score1: null,
        score2: null,
        winner_id: null,
        loser_id: null
      })
      .not('id', 'is', null)
      .select('id');

    if (error) throw error;

    initMatches();
    renderBracket();
    renderStandings();

    setSyncState('synced');

    if (!data || data.length === 0) {
      toast('Reset selesai — belum ada hasil tersimpan di database', 'info');
    } else {
      toast(`Semua hasil direset ✓ (${data.length} match)`, 'ok');
    }
  } catch (e) {
    console.error('Reset error:', e);
    setSyncState('err');
    toast('Gagal reset: ' + (e.message || 'unknown error'), 'err');
  }
}

// ══════════════════════════════════════════════
// ADMIN AUTH — SUPABASE AUTH + RLS
// UI state is only for convenience; database security is enforced by RLS.
let isAdmin = false;
let authUser = null;

function applyAdminState(active, user = null) {
  isAdmin = !!active;
  authUser = user || authUser;

  if (isAdmin) {
    document.body.classList.remove('view-mode');
    document.getElementById('admin-btn').classList.add('active');updateBracketTemplateUI();
    document.getElementById('admin-btn').textContent = '✓';
    document.getElementById('admin-btn').title = 'Logout admin';
  } else {
    document.body.classList.add('view-mode');
    document.getElementById('admin-btn').classList.remove('active');
    document.getElementById('admin-btn').textContent = '🔐';
    document.getElementById('admin-btn').title = 'Admin Login';
    const teamsPanel = document.getElementById('panel-teams');
    if (teamsPanel.classList.contains('on')) {
      document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
      document.getElementById('panel-bracket').classList.add('on');
      document.querySelector('.tab').classList.add('on');
    }
  }
}

async function refreshAdminState() {
  const { data: { user } } = await sb.auth.getUser();
  authUser = user || null;

  if (!user) {
    applyAdminState(false, null);
    return false;
  }

  const { data, error } = await sb
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Admin check error:', error);
    applyAdminState(false, user);
    return false;
  }

  const active = !!data && data.user_id === user.id;
  applyAdminState(active, user);
  return active;
}

function toggleAdminLogin() {
  if (isAdmin) {
    logoutAdmin();
    return;
  }

  document.getElementById('login-overlay').classList.add('on');
  document.getElementById('auth-err').textContent = '';
  document.getElementById('auth-email').focus();
}

function closeLogin() {
  document.getElementById('login-overlay').classList.remove('on');
}

async function submitLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const err = document.getElementById('auth-err');
  const btn = document.getElementById('auth-submit-btn');

  err.textContent = '';
  if (!email || !password) {
    err.textContent = 'Email dan password wajib diisi';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Masuk...';

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const ok = await refreshAdminState();
    if (!ok) {
      await sb.auth.signOut();
      throw new Error('Akun ini belum terdaftar sebagai admin.');
    }

    closeLogin();
    document.getElementById('auth-password').value = '';
    toast('Login admin berhasil ✓', 'ok');
  } catch (e) {
    console.error('Login error:', e);
    err.textContent = e.message || 'Login gagal';
    applyAdminState(false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Masuk';
  }
}

async function logoutAdmin() {
  if (!confirm('Keluar dari mode admin?')) return;
  const { error } = await sb.auth.signOut();
  if (error) {
    toast('Gagal logout: ' + error.message, 'err');
    return;
  }
  applyAdminState(false, null);
  toast('Keluar dari mode admin', 'info');
}

sb.auth.onAuthStateChange((event, session) => {
  authUser = session?.user || null;
  // Avoid awaiting Supabase calls inside the auth callback.
  setTimeout(() => refreshAdminState(), 0);
});

async function boot() {
  // Public viewer by default. Admin access comes from Supabase Auth + admin_users.
  document.body.classList.add('view-mode');updateBracketTemplateUI();

  try {
    await refreshAdminState();

    // 1. Load teams
    // Empty Team Pool is valid: admin can start from 0 teams.
    await dbLoadTeams();

    // 2. Init match structure
    initMatches();

    // 3. Load bracket assignments and match results
    await dbLoadMatches();

    // 4. Render everything
    renderBracket();
    renderStandings();

    setSyncState('synced');
    hideLoading();
    toast('Data berhasil dimuat ✓','ok');
  } catch(e) {
    console.error(e);
    initMatches();
    renderBracket();
    renderStandings();
    hideLoading();
    toast(e.message || 'Mode offline — tidak terhubung ke database','err');
    setSyncState('err');
  }
}
boot();
