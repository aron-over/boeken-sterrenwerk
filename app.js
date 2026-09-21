// ==========================================================================
// Boeken Sterrenwerk — Applicatielogica & Supabase Koppeling
// ==========================================================================

// Omgeving detecteren: lokaal (localhost/127.0.0.1) gebruikt de testdatabase, elders productie
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Productie-database (GitHub Pages)
const PROD_URL = 'https://ggdosqodohmvxselzxtv.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnZG9zcW9kb2htdnhzZWx6eHR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MDE1MjksImV4cCI6MjEwNDk3NzUyOX0.ypQXHhp6emH_o84eWwHNtumd2Q7oa2bIut46bvVQ8s0';

// Test-database (lokaal)
const TEST_URL = 'https://avhssvksvuebmhufmrzq.supabase.co';
const TEST_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2aHNzdmtzdnVlYm1odWZtcnpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0Nzc5ODAsImV4cCI6MjEwNTA1Mzk4MH0.jme6g6w5QDbPF4H07fhFQctOuN7EfnLAmic9n4Sj3yQ';

const SUPABASE_URL = IS_LOCAL ? TEST_URL : PROD_URL;
const SUPABASE_ANON_KEY = IS_LOCAL ? TEST_KEY : PROD_KEY;
const realClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allBooksCache = [];
let pristineBaselineData = null;
let initialBaselineLoaded = false;

// Lokale cache (Stale-While-Revalidate) voor directe weergave (< 20ms) bij paginabezoek
const CACHE_KEY = IS_LOCAL ? 'boeken_cache_test_v1' : 'boeken_cache_prod_v1';
const CACHE_TIME_KEY = IS_LOCAL ? 'boeken_cache_test_time' : 'boeken_cache_prod_time';

function loadCachedBooks(){
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0){
      return parsed;
    }
  } catch (e) {
    console.warn('Fout bij uitlezen lokale cache:', e);
  }
  return null;
}

function saveCachedBooks(books){
  try {
    if (Array.isArray(books)){
      localStorage.setItem(CACHE_KEY, JSON.stringify(books));
      localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
    }
  } catch (e) {
    console.warn('Fout bij opslaan in lokale cache:', e);
  }
}

// Supabase/PostgREST geeft standaard maximaal 1000 rijen per query terug, ongeacht select('*').
// We halen pagina 1 op met count: 'exact', en als er meer rijen zijn halen we de overige pagina's
// parallel op via Promise.all() in plaats van sequentieel.
const FETCH_PAGE_SIZE = 1000;
async function fetchAllRows(table, orderCol = 'titel', ascending = true){
  // 1. Eerste pagina en exact totaalaantal tegelijk ophalen
  const { data: firstPage, count, error: firstErr } = await realClient
    .from(table)
    .select('*', { count: 'exact' })
    .order(orderCol, { ascending })
    .range(0, FETCH_PAGE_SIZE - 1);

  if (firstErr) return { data: null, error: firstErr };
  if (!firstPage) return { data: [], error: null };

  // Als alle rijen al binnen zijn (bijv. totaal <= 1000)
  if (count === null || count <= FETCH_PAGE_SIZE || firstPage.length < FETCH_PAGE_SIZE){
    return { data: firstPage, error: null };
  }

  // 2. Resterende pagina's gelijktijdig ophalen met Promise.all
  const remainingRanges = [];
  for (let from = FETCH_PAGE_SIZE; from < count; from += FETCH_PAGE_SIZE){
    remainingRanges.push([from, Math.min(from + FETCH_PAGE_SIZE - 1, count - 1)]);
  }

  const pagePromises = remainingRanges.map(([from, to]) =>
    realClient
      .from(table)
      .select('*')
      .order(orderCol, { ascending })
      .range(from, to)
  );

  const results = await Promise.all(pagePromises);
  let allRows = [...firstPage];
  for (const res of results){
    if (res.error) return { data: null, error: res.error };
    if (res.data) allRows = allRows.concat(res.data);
  }
  return { data: allRows, error: null };
}

function resetTestData(){
  if (!pristineBaselineData) return;
  allBooksCache = JSON.parse(JSON.stringify(pristineBaselineData));
  saveCachedBooks(allBooksCache);
  const activeBtn = document.querySelector('nav.tabs button.active');
  const activeTab = activeBtn ? activeBtn.dataset.tab : 'zoeken';
  if (activeTab === 'zoeken') renderZoekLijst();
  if (activeTab === 'coordinator' && coordUnlocked) refreshCoordinatorData(true);
  const infoEl = document.getElementById('test-reset-info');
  if (infoEl){
    infoEl.textContent = 'Data hersteld!';
    setTimeout(() => { infoEl.textContent = ''; }, 2500);
  }
}

// In de testomgeving vangen we alle mutaties in-memory op zodat Supabase nooit gewijzigd wordt:
const client = (!IS_LOCAL) ? realClient : {
  from(table){
    if (table !== 'boeken'){
      return realClient.from(table);
    }
    return {
      select(columns = '*'){
        const executeSelect = async (orderCol = 'titel', ascending = true) => {
          if (!initialBaselineLoaded){
            const res = await fetchAllRows('boeken', orderCol, ascending);
            if (!res.error && res.data){
              pristineBaselineData = JSON.parse(JSON.stringify(res.data));
              allBooksCache = JSON.parse(JSON.stringify(res.data));
              initialBaselineLoaded = true;
            }
            return res;
          }
          const sorted = [...allBooksCache].sort((a, b) => {
            const va = a[orderCol] || '';
            const vb = b[orderCol] || '';
            return ascending ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
          });
          return { data: sorted, error: null };
        };
        return {
          order(col = 'titel', { ascending = true } = {}){
            return executeSelect(col, ascending);
          },
          then(resolve, reject){
            return executeSelect().then(resolve, reject);
          }
        };
      },
      insert(rows){
        return (async () => {
          const arr = Array.isArray(rows) ? rows : [rows];
          arr.forEach(row => {
            const copy = Object.assign({}, row);
            if (!copy.id){
              copy.id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            }
            allBooksCache.push(copy);
          });
          allBooksCache.sort((a, b) => (a.titel || '').localeCompare(b.titel || ''));
          return { data: arr, error: null };
        })();
      },
      update(fields){
        return {
          eq(col, val){
            return (async () => {
              if (col === 'id'){
                const book = allBooksCache.find(b => String(b.id) === String(val));
                if (book) Object.assign(book, fields);
                return { data: book ? [book] : [], error: null };
              }
              allBooksCache.forEach(b => {
                if (String(b[col]) === String(val)) Object.assign(b, fields);
              });
              return { data: [], error: null };
            })();
          },
          in(col, vals){
            return (async () => {
              const strVals = vals.map(String);
              const updated = [];
              allBooksCache.forEach(b => {
                if (strVals.includes(String(b[col]))){
                  Object.assign(b, fields);
                  updated.push(b);
                }
              });
              return { data: updated, error: null };
            })();
          }
        };
      },
      delete(){
        return {
          eq(col, val){
            return (async () => {
              allBooksCache = allBooksCache.filter(b => String(b[col]) !== String(val));
              return { data: null, error: null };
            })();
          }
        };
      }
    };
  }
};

if (IS_LOCAL){
  const badge = document.getElementById('test-badge');
  if (badge) badge.style.display = 'inline-block';
  const resetBtn = document.getElementById('test-reset-btn');
  if (resetBtn){
    resetBtn.style.display = 'inline-block';
    resetBtn.addEventListener('click', resetTestData);
  }
  const stijlgidsLink = document.getElementById('stijlgids-link');
  if (stijlgidsLink) stijlgidsLink.style.display = 'inline-flex';
  console.info('%c[Boeken Sterrenwerk] Actief in TESTOMGEVING (in-memory sandbox: mutaties worden niet opgeslagen in Supabase)', 'color: #A9821E; font-weight: bold;');
}

const COORD_PASSWORD = 'sterrenwerk2026';

const GROEPEN = ['Groep 3','Groep 4','Groep 5','Groep 6','Groep 7','Groep 8'];
const KLEUTERS_THEMAS = ['Baby familie','Beroepen','Boerderij','Bouwen','Carnaval','Dieren','Dikkie Dik',"Draken & Dino's",'Emoties','Gezondheid','Herfst','Jarig & Feest','Kermis','Kerst','Kikker','Koken en bakken','Koningshuis','Kunst','Lente','Liedjes & Versjes','Natuur','Pasen','Rekenen','Ruimte','Seizoenen','Sinterklaas','Sociaal emotioneel','Sporten','Sprookjes','Taal','Vakantie','Verkeer','Voorlezen','Vriendschap','Winter','Zoekboek'].sort((a, b) => a.localeCompare(b, 'nl'));
const JEELO_THEMAS = ['Omgaan met elkaar','Maken van je eigen product','Leren voor later','Zorgen voor dieren','Bebeleven van onze planeet','Veilig in het verkeer','Zorgen voor jezelf en anderen','Omgaan met geld','Leren van personen van vroeger','Inrichten van je eigen omgeving','Omgaan met natuur','Veilig helpen'];
const OVERIGE_THEMAS = ['Lessen taal','Gedichten',"Sprookjes (verhalen, legenden, mythen)",'Bekende personen','Engelse boeken','Andere talen','Geschiedenis','Oorlog','Aardrijkskunde','Burgerschap','Relaties en Seksualiteit','Gedrag','Kunst','Digitale geletterdheid','Hoogbegaafdheid','Voorleesboeken'];
const ANDERS = '__anders__';

function veldVoorCategorie(cat){
  if (cat === 'Groep') return 'groep';
  if (cat === 'Kleuters') return 'kleuters_thema';
  if (cat === 'Jeelo') return 'jeelo_thema';
  return 'overig_thema';
}

function fillSelect(id, options){
  const el = document.getElementById(id);
  if (el) el.innerHTML = options.map(o => `<option value="${o}">${o}</option>`).join('');
}
fillSelect('groep', GROEPEN);
const kleuterEl = document.getElementById('kleuters_thema');
if (kleuterEl){
  kleuterEl.innerHTML =
    `<option value="" selected></option>` +
    KLEUTERS_THEMAS.map(o => `<option value="${o}">${o}</option>`).join('') +
    `<option value="${ANDERS}">Anders, namelijk…</option>`;
}
fillSelect('jeelo_thema', JEELO_THEMAS);
const overigEl = document.getElementById('overig_thema');
if (overigEl){
  overigEl.innerHTML =
    OVERIGE_THEMAS.map(o => `<option value="${o}">${o}</option>`).join('') +
    `<option value="${ANDERS}">Anders, namelijk…</option>`;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function bevestigVerwijderen(titel){
  return confirm(`"${titel || 'dit boek'}" definitief verwijderen?\n\nDit kan NIET ongedaan worden gemaakt (geen back-up).`);
}

function parsePrijs(val){
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let str = String(val).replace(/[^0-9.,-]/g, '').trim();
  if (!str) return 0;
  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1){
    if (lastComma > lastDot){
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (lastComma !== -1){
    str = str.replace(',', '.');
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function formatBedrag(n){
  const num = parsePrijs(n);
  return num.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function euro(n){
  return '€ ' + formatBedrag(n);
}

function themaVan(b){
  return b[veldVoorCategorie(b.categorie)];
}

function themaLabel(b){
  const thema = themaVan(b);
  if (b.categorie === 'Groep') return thema || 'Groep';
  return thema ? (b.categorie || '') + ' · ' + thema : (b.categorie || '');
}

// ---------- Boekentips: Data, Sanitization & Modal Dialog ----------
function parseBoekentips(raw){
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')){
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)){
        return parsed.map((item, idx) => {
          if (typeof item === 'string'){
            return { id: 'tip-' + idx, html: item, author: '', created_at: '' };
          }
          return {
            id: item.id || ('tip-' + idx + '-' + Date.now()),
            html: item.html || item.text || '',
            author: item.author || '',
            created_at: item.created_at || ''
          };
        }).filter(t => t.html && t.html.trim().length > 0);
      }
    } catch (e) {
      console.warn('Fout bij parsen van boekentip JSON, val terug op platte tekst', e);
    }
  }
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.map((line, idx) => {
    const cleanLine = line.replace(/^-\s*/, '');
    return {
      id: 'legacy-' + idx,
      html: `<p>${escapeHtml(cleanLine)}</p>`,
      author: '',
      created_at: ''
    };
  });
}

function serializeBoekentips(tips){
  if (!tips || !tips.length) return null;
  return JSON.stringify(tips);
}

function formatBoekentipBtnLabel(count){
  if (!count || count <= 0) return '+ Boekentip';
  return count === 1 ? '💡 1 boekentip' : `💡 ${count} boekentips`;
}

function formatBoekentipBtnTitle(count){
  if (!count || count <= 0) return 'Boekentip toevoegen';
  return count === 1 ? '1 boekentip bekijken' : `${count} boekentips bekijken`;
}

function boekentipZoekTekst(raw){
  if (!raw) return '';
  const tips = parseBoekentips(raw);
  return tips.map(t => {
    const textOnly = t.html ? t.html.replace(/<[^>]*>/g, ' ') : '';
    return textOnly + ' ' + (t.author || '');
  }).join(' ');
}

function formatTipDatum(isoStr){
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch(e){
    return '';
  }
}

function sanitizeTipHtml(dirtyHtml){
  if (!dirtyHtml) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(dirtyHtml, 'text/html');

  const allowedTags = new Set([
    'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE',
    'P', 'BR', 'UL', 'OL', 'LI', 'A',
    'H2', 'H3', 'H4', 'BLOCKQUOTE'
  ]);

  function cleanNode(node){
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType !== Node.ELEMENT_NODE){
      node.remove();
      return;
    }

    const tagName = node.tagName.toUpperCase();
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'META', 'LINK'].includes(tagName)){
      node.remove();
      return;
    }

    const children = Array.from(node.childNodes);
    for (const child of children){
      cleanNode(child);
    }

    if (!allowedTags.has(tagName)){
      const parent = node.parentNode;
      if (parent){
        while (node.firstChild){
          parent.insertBefore(node.firstChild, node);
        }
        parent.removeChild(node);
      }
      return;
    }

    const attrs = Array.from(node.attributes);
    for (const attr of attrs){
      const attrName = attr.name.toLowerCase();
      if (tagName === 'A' && attrName === 'href'){
        const val = attr.value.trim();
        if (/^https?:\/\/|^mailto:/i.test(val)){
          node.setAttribute('href', val);
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        } else {
          node.removeAttribute('href');
        }
      } else {
        node.removeAttribute(attr.name);
      }
    }
  }

  Array.from(doc.body.childNodes).forEach(cleanNode);

  let clean = doc.body.innerHTML.trim();
  clean = clean.replace(/^(<p>(\s|&nbsp;|<br>)*<\/p>)+/gi, '')
               .replace(/(<p>(\s|&nbsp;|<br>)*<\/p>)+$/gi, '');
  return clean;
}

let activeModalBookId = null;
let editingTipId = null;
let modalInitialized = false;

function openBoekentipModal(bookId){
  const book = allBooksCache.find(x => String(x.id) === String(bookId));
  if (!book) return;

  activeModalBookId = bookId;
  editingTipId = null;

  const titleEl = document.getElementById('modal-book-title');
  if (titleEl) titleEl.textContent = book.titel || 'Geen titel';

  const metaEl = document.getElementById('modal-book-meta');
  if (metaEl){
    const parts = [];
    if (book.auteur) parts.push(book.auteur);
    const thema = themaLabel(book);
    if (thema) parts.push(thema);
    if (book.isbn) parts.push('ISBN: ' + book.isbn);
    metaEl.textContent = parts.join(' · ');
  }

  hideModalEditor();
  renderModalTipsList(bookId);

  const modalEl = document.getElementById('boekentip-modal');
  if (modalEl){
    modalEl.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  initBoekentipModal();
}

function getTipSnippet(html){
  if (!html) return '';
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 55 ? text.slice(0, 52) + '…' : text;
}

function showModalEditor(isEdit = false){
  const addWrap = document.getElementById('modal-add-tip-wrap');
  if (addWrap) addWrap.style.display = 'none';

  const editorSection = document.getElementById('modal-editor-section');
  if (editorSection) editorSection.style.display = 'flex';

  const heading = document.getElementById('modal-editor-heading');
  if (heading) heading.textContent = isEdit ? '✏️ Boekentip bewerken' : '💡 Boekentip toevoegen';

  const saveBtn = document.getElementById('modal-save-tip-btn');
  if (saveBtn) saveBtn.textContent = isEdit ? 'Wijziging opslaan' : 'Boekentip opslaan';

  const authorInp = document.getElementById('modal-tip-author');
  const editor = document.getElementById('modal-rich-editor');

  if (!isEdit && authorInp && !authorInp.value){
    authorInp.value = localStorage.getItem('boeken_leerkracht_naam') || '';
  }

  if (!authorInp?.value){
    authorInp?.focus();
  } else {
    editor?.focus();
  }
  editorSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideModalEditor(){
  const addWrap = document.getElementById('modal-add-tip-wrap');
  if (addWrap) addWrap.style.display = '';

  const editorSection = document.getElementById('modal-editor-section');
  if (editorSection) editorSection.style.display = 'none';

  resetModalEditor();
}

function closeBoekentipModal(){
  const editor = document.getElementById('modal-rich-editor');
  const editorSection = document.getElementById('modal-editor-section');
  if (editorSection && editorSection.style.display !== 'none' && editor && editor.innerText.trim()){
    if (!confirm('Je hebt nog tekst in de editor staan die niet is opgeslagen. Weet je zeker dat je wilt sluiten?')){
      return;
    }
  }
  const modalEl = document.getElementById('boekentip-modal');
  if (modalEl){
    modalEl.classList.remove('open');
    document.body.style.overflow = '';
  }
  activeModalBookId = null;
  editingTipId = null;
  hideModalEditor();
}

function resetModalEditor(){
  editingTipId = null;
  const authorInp = document.getElementById('modal-tip-author');
  if (authorInp){
    authorInp.value = localStorage.getItem('boeken_leerkracht_naam') || '';
  }

  const editor = document.getElementById('modal-rich-editor');
  if (editor) editor.innerHTML = '';

  const heading = document.getElementById('modal-editor-heading');
  if (heading) heading.textContent = '💡 Boekentip toevoegen';

  const saveBtn = document.getElementById('modal-save-tip-btn');
  if (saveBtn) saveBtn.textContent = 'Boekentip opslaan';
}

function renderModalTipsList(bookId, openTargetTipId = null){
  const container = document.getElementById('modal-tips-list');
  if (!container) return;

  const book = allBooksCache.find(x => String(x.id) === String(bookId));
  if (!book){
    container.innerHTML = '';
    return;
  }

  const tips = parseBoekentips(book.boekentip);

  const addBtn = document.getElementById('modal-show-add-btn');
  if (addBtn){
    addBtn.innerHTML = tips.length > 0
      ? '<span style="font-size:16px; font-weight:700; line-height:1;">+</span> Boekentip toevoegen'
      : '<span style="font-size:16px; font-weight:700; line-height:1;">+</span> De eerste boekentip toevoegen';
  }

  if (!tips.length){
    container.innerHTML = `
      <div class="modal-no-tips">
        Nog geen boekentips of lesideeën voor dit boek.<br>
        Klik hieronder om als eerste een boekentip of lesidee toe te voegen!
      </div>
    `;
    return;
  }

  const activeTabBtn = document.querySelector('nav.tabs button.active');
  const isCoordTab = activeTabBtn && activeTabBtn.dataset.tab === 'coordinator';
  const canManageTips = isCoordTab && coordUnlocked;

  container.innerHTML = tips.map((tip, idx) => {
    const datum = formatTipDatum(tip.created_at);
    const authorLabel = tip.author ? ('Boekentip van: ' + escapeHtml(tip.author)) : 'Boekentip';
    const snippet = getTipSnippet(tip.html);

    let isOpen = false;
    if (tips.length === 1){
      isOpen = true;
    } else if (openTargetTipId){
      isOpen = (tip.id === openTargetTipId);
    } else if (idx === 0){
      isOpen = true;
    }

    return `
      <div class="modal-tip-card ${isOpen ? 'is-open' : ''}" data-tip-id="${escapeHtml(tip.id)}">
        <div class="modal-tip-header" title="Klik om open of dicht te klappen">
          <div class="modal-tip-meta">
            <span class="modal-tip-author">💡 <strong>${authorLabel}</strong></span>
            ${datum ? `<span class="modal-tip-date">· ${datum}</span>` : ''}
            <span class="modal-tip-snippet">${escapeHtml(snippet)}</span>
          </div>
          <div class="modal-tip-header-right">
            ${canManageTips ? `
              <div class="modal-tip-actions">
                <button type="button" class="btn btn-ghost btn-sm tip-edit-btn" data-tip-id="${escapeHtml(tip.id)}">Wijzigen</button>
                <button type="button" class="btn btn-ghost btn-sm tip-del-btn" data-tip-id="${escapeHtml(tip.id)}" style="color:var(--red);">Verwijderen</button>
              </div>
            ` : ''}
            <span class="modal-tip-chevron" title="Open/dichtklappen">▼</span>
          </div>
        </div>
        <div class="modal-tip-body">
          ${tip.html}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.modal-tip-header').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('.tip-edit-btn') || e.target.closest('.tip-del-btn')) return;
      const card = hdr.closest('.modal-tip-card');
      if (card){
        card.classList.toggle('is-open');
      }
    });
  });

  if (canManageTips){
    container.querySelectorAll('.tip-del-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const tipId = btn.dataset.tipId;
        if (!confirm('Weet je zeker dat je deze boekentip wilt verwijderen?')) return;
        const currentTips = parseBoekentips(book.boekentip).filter(t => t.id !== tipId);
        const serialized = serializeBoekentips(currentTips);
        btn.disabled = true;
        btn.textContent = 'Verwijderen…';
        const ok = await dbUpdate(bookId, { boekentip: serialized });
        if (ok){
          book.boekentip = serialized;
          renderModalTipsList(bookId);
          syncTipTriggersOutsideModal(bookId, currentTips.length);
        } else {
          btn.disabled = false;
          btn.textContent = 'Verwijderen';
        }
      });
    });

    container.querySelectorAll('.tip-edit-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const tipId = btn.dataset.tipId;
        const currentTips = parseBoekentips(book.boekentip);
        const tip = currentTips.find(t => t.id === tipId);
        if (!tip) return;

        editingTipId = tip.id;
        const authorInp = document.getElementById('modal-tip-author');
        if (authorInp) authorInp.value = tip.author || '';

        const editor = document.getElementById('modal-rich-editor');
        if (editor){
          editor.innerHTML = tip.html;
        }

        showModalEditor(true);
      });
    });
  }
}

function syncTipTriggersOutsideModal(bookId, tipCount){
  const buttons = document.querySelectorAll(`[data-id="${bookId}"] .boekentip-toggle`);
  buttons.forEach(toggleBtn => {
    toggleBtn.dataset.tipsCount = tipCount;
    toggleBtn.textContent = formatBoekentipBtnLabel(tipCount);
    toggleBtn.title = formatBoekentipBtnTitle(tipCount);
    if (tipCount > 0){
      toggleBtn.classList.add('has-tips');
    } else {
      toggleBtn.classList.remove('has-tips');
    }
  });

  const coordRow = document.querySelector(`.alle-row[data-id="${bookId}"]`);
  if (coordRow){
    const book = allBooksCache.find(x => String(x.id) === String(bookId));
    if (book) updateSummaryHeader(coordRow, book);

    const countText = coordRow.querySelector('.coord-tip-count-text');
    if (countText){
      countText.textContent = tipCount > 0
        ? (tipCount === 1 ? '1 boekentip aanwezig' : `${tipCount} boekentips aanwezig`)
        : 'Nog geen boekentips voor dit boek';
    }
    const tipBtn = coordRow.querySelector('.open-coord-tip-btn');
    if (tipBtn){
      if (tipCount > 0){
        tipBtn.classList.add('has-tips');
        tipBtn.textContent = '💡 Bekijken & Beheren';
      } else {
        tipBtn.classList.remove('has-tips');
        tipBtn.textContent = '+ Boekentip toevoegen';
      }
    }
  }
}

function initBoekentipModal(){
  if (modalInitialized) return;
  modalInitialized = true;

  const modalEl = document.getElementById('boekentip-modal');
  const backdropEl = document.getElementById('modal-backdrop');
  const closeXBtn = document.getElementById('modal-close-x-btn');
  const closeBottomBtn = document.getElementById('modal-close-bottom-btn');
  const cancelTopBtn = document.getElementById('modal-editor-cancel-btn');
  const cancelBottomBtn = document.getElementById('modal-editor-cancel-bottom-btn');
  const showAddBtn = document.getElementById('modal-show-add-btn');
  const saveBtn = document.getElementById('modal-save-tip-btn');
  const editorEl = document.getElementById('modal-rich-editor');
  const toolbar = document.getElementById('modal-editor-toolbar');

  backdropEl?.addEventListener('click', closeBoekentipModal);
  closeXBtn?.addEventListener('click', closeBoekentipModal);
  closeBottomBtn?.addEventListener('click', closeBoekentipModal);

  showAddBtn?.addEventListener('click', () => {
    showModalEditor(false);
  });
  cancelTopBtn?.addEventListener('click', hideModalEditor);
  cancelBottomBtn?.addEventListener('click', hideModalEditor);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalEl?.classList.contains('open')){
      closeBoekentipModal();
    }
  });

  // Zorg dat de opmaakknoppen overgeslagen worden met TAB
  toolbar?.querySelectorAll('button').forEach(btn => {
    btn.setAttribute('tabindex', '-1');
  });

  // Met Tab of Enter in het naamveld direct naar het tekstveld springen
  const authorInp = document.getElementById('modal-tip-author');
  authorInp?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)){
      e.preventDefault();
      editorEl?.focus();
    }
  });

  // Met Shift+Tab in het tekstveld terugkeren naar het naamveld
  editorEl?.addEventListener('keydown', e => {
    if (e.key === 'Tab' && e.shiftKey){
      e.preventDefault();
      authorInp?.focus();
    }
  });

  if (toolbar && editorEl){
    toolbar.querySelectorAll('button[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
      });
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        if (cmd === 'h3'){
          const isH3 = document.queryCommandValue('formatBlock') === 'h3';
          document.execCommand('formatBlock', false, isH3 ? '<p>' : '<h3>');
        } else if (cmd === 'link'){
          let url = prompt('Voer de web- of Teams-koppeling in (bijv. https://...):');
          if (url){
            url = url.trim();
            if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)){
              url = 'https://' + url;
            }
            document.execCommand('createLink', false, url);
            const sel = window.getSelection();
            if (sel && sel.anchorNode){
              const a = sel.anchorNode.parentElement?.closest('a') || sel.anchorNode.closest?.('a');
              if (a){
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
              }
            }
          }
        } else {
          document.execCommand(cmd, false, null);
        }
        editorEl.focus();
      });
    });

    editorEl.addEventListener('paste', e => {
      e.preventDefault();
      const clipboard = e.clipboardData || window.clipboardData;
      if (!clipboard) return;

      const html = clipboard.getData('text/html');
      const text = clipboard.getData('text/plain');

      if (html){
        const clean = sanitizeTipHtml(html);
        document.execCommand('insertHTML', false, clean);
      } else if (text){
        const textHtml = escapeHtml(text).replace(/\r?\n/g, '<br>');
        document.execCommand('insertHTML', false, textHtml);
      }
    });
  }

  saveBtn?.addEventListener('click', async () => {
    if (!activeModalBookId) return;
    const book = allBooksCache.find(x => String(x.id) === String(activeModalBookId));
    if (!book) return;

    const rawHtml = editorEl ? editorEl.innerHTML : '';
    const cleanHtml = sanitizeTipHtml(rawHtml);
    const textOnly = cleanHtml.replace(/<[^>]*>/g, '').trim();

    if (!textOnly){
      alert('Typ of plak eerst een boekentip of lesidee.');
      editorEl?.focus();
      return;
    }

    const authorInp = document.getElementById('modal-tip-author');
    const author = authorInp ? authorInp.value.trim() : '';
    if (author){
      try { localStorage.setItem('boeken_leerkracht_naam', author); } catch(e){}
    }

    const currentTips = parseBoekentips(book.boekentip);
    let savedTipId = null;

    if (editingTipId){
      const tipIdx = currentTips.findIndex(t => t.id === editingTipId);
      if (tipIdx >= 0){
        currentTips[tipIdx].html = cleanHtml;
        currentTips[tipIdx].author = author;
        currentTips[tipIdx].updated_at = new Date().toISOString();
        savedTipId = editingTipId;
      }
    } else {
      savedTipId = 'tip-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      currentTips.push({
        id: savedTipId,
        html: cleanHtml,
        author: author,
        created_at: new Date().toISOString()
      });
    }

    const serialized = serializeBoekentips(currentTips);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Opslaan…';

    const ok = await dbUpdate(activeModalBookId, { boekentip: serialized });
    saveBtn.disabled = false;
    saveBtn.textContent = 'Boekentip opslaan';

    if (ok){
      book.boekentip = serialized;
      hideModalEditor();
      renderModalTipsList(activeModalBookId, savedTipId);
      syncTipTriggersOutsideModal(activeModalBookId, currentTips.length);
    }
  });
}

function boekZoekTekst(b){
  return [b.titel, b.auteur, b.isbn, themaVan(b), b.naam_aanvrager, b.opmerking, boekentipZoekTekst(b.boekentip)]
    .filter(Boolean).join(' ').toLowerCase();
}

async function dbUpdate(id, fields){
  const { error } = await client.from('boeken').update(fields).eq('id', id);
  if (error){
    console.error('Update mislukt', error);
    alert('Opslaan is mislukt: ' + error.message);
    return false;
  }
  const item = allBooksCache.find(b => String(b.id) === String(id));
  if (item) Object.assign(item, fields);
  saveCachedBooks(allBooksCache);
  return true;
}

// ---------- Tabs ----------
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'zoeken') renderZoekLijst();
    if (btn.dataset.tab === 'coordinator' && coordUnlocked) refreshCoordinatorData(true);
  });
});

// Houd de hoogte van de sticky topbar bij voor een meescrollende tabelheader
function updateTopbarHeightVar(){
  const topbar = document.querySelector('header.topbar');
  if (topbar){
    const h = topbar.offsetHeight;
    if (h > 0){
      document.documentElement.style.setProperty('--topbar-height', h + 'px');
    }
  }
}
window.addEventListener('resize', updateTopbarHeightVar);
window.addEventListener('orientationchange', updateTopbarHeightVar);
window.addEventListener('load', updateTopbarHeightVar);
updateTopbarHeightVar();

// ---------- Categorie-velden in aanvraagformulier ----------
const categorieSelect = document.getElementById('categorie');
if (categorieSelect){
  categorieSelect.addEventListener('change', updateCategorieVelden);
}
function updateCategorieVelden(){
  if (!categorieSelect) return;
  const val = categorieSelect.value;
  document.getElementById('groep-veld').style.display = val === 'Groep' ? '' : 'none';
  document.getElementById('kleuters-veld').style.display = val === 'Kleuters' ? '' : 'none';
  document.getElementById('jeelo-veld').style.display = val === 'Jeelo' ? '' : 'none';
  document.getElementById('overig-veld').style.display = val === 'Overig' ? '' : 'none';
}
updateCategorieVelden();

document.getElementById('kleuters_thema')?.addEventListener('change', e => {
  const andersEl = document.getElementById('kleuters_thema_anders');
  if (andersEl) andersEl.style.display = e.target.value === ANDERS ? '' : 'none';
});
document.getElementById('overig_thema')?.addEventListener('change', e => {
  const andersEl = document.getElementById('overig_thema_anders');
  if (andersEl) andersEl.style.display = e.target.value === ANDERS ? '' : 'none';
});

// ---------- Herbruikbaar zoekveld met suggesties ----------
function wireThemaZoekveld(inputEl, suggestiesEl, opties, onSelect){
  if (!inputEl || !suggestiesEl) return;
  function render(filterTekst){
    const q = filterTekst.trim().toLowerCase();
    const matches = q ? opties.filter(o => o.label.toLowerCase().includes(q)) : opties;
    suggestiesEl.innerHTML = matches.length
      ? matches.map(o => `<div class="thema-suggestie" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`).join('')
      : `<div class="thema-suggestie-leeg">Geen thema gevonden</div>`;
    suggestiesEl.style.display = 'block';
  }
  inputEl.addEventListener('focus', () => render(inputEl.value));
  inputEl.addEventListener('input', () => render(inputEl.value));
  inputEl.addEventListener('blur', () => setTimeout(() => { suggestiesEl.style.display = 'none'; }, 150));
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape'){
      suggestiesEl.style.display = 'none';
    } else if (e.key === 'Enter'){
      e.preventDefault();
      const eerste = suggestiesEl.querySelector('.thema-suggestie');
      if (eerste){
        const opt = opties.find(o => o.value === eerste.dataset.value);
        if (opt) onSelect(opt);
        suggestiesEl.style.display = 'none';
      }
    }
  });
  suggestiesEl.addEventListener('mousedown', e => {
    const item = e.target.closest('.thema-suggestie');
    if (!item) return;
    e.preventDefault();
    const opt = opties.find(o => o.value === item.dataset.value);
    if (opt) onSelect(opt);
    suggestiesEl.style.display = 'none';
  });
}

const kleutersThemaOpties = KLEUTERS_THEMAS.map(t => ({ value: t, label: t }))
  .concat([{ value: ANDERS, label: 'Anders, namelijk…' }]);
const kleuterZoekInput = document.getElementById('kleuters_thema_zoek');
const kleuterSuggesties = document.getElementById('kleuters_thema_suggesties');
if (kleuterZoekInput && kleuterSuggesties){
  wireThemaZoekveld(
    kleuterZoekInput,
    kleuterSuggesties,
    kleutersThemaOpties,
    opt => {
      document.getElementById('kleuters_thema_zoek').value = opt.label;
      const select = document.getElementById('kleuters_thema');
      if (select){
        select.value = opt.value;
        select.dispatchEvent(new Event('change'));
      }
    }
  );
}

// ---------- Dubbele-aanvraag check & Boeken laden ----------
let isFetchingBooks = false;
async function fetchAllBooks(forceReload = false){
  if (IS_LOCAL && initialBaselineLoaded && !forceReload){
    return true;
  }
  if (isFetchingBooks) return true;
  isFetchingBooks = true;

  try {
    const { data, error } = IS_LOCAL
      ? await client.from('boeken').select('*').order('titel', { ascending: true })
      : await fetchAllRows('boeken', 'titel', true);

    if (!error && data){
      // Snelle controle of de ontvangen data verschilt van wat we in het geheugen hebben
      const isDifferent = allBooksCache.length !== data.length ||
        (allBooksCache.length > 0 && data.length > 0 && (
          allBooksCache[0].id !== data[0].id ||
          allBooksCache[allBooksCache.length - 1].id !== data[data.length - 1].id ||
          allBooksCache[0].titel !== data[0].titel
        )) ||
        JSON.stringify(allBooksCache) !== JSON.stringify(data);

      allBooksCache = data;
      saveCachedBooks(data);

      if (IS_LOCAL && !pristineBaselineData){
        pristineBaselineData = JSON.parse(JSON.stringify(data));
        initialBaselineLoaded = true;
      }

      // Indien de data gewijzigd is (bijv. op achtergrond gesynchroniseerd), update de actieve weergave
      if (isDifferent){
        const activeTab = document.querySelector('nav.tabs button.active')?.dataset.tab || 'zoeken';
        if (activeTab === 'zoeken') renderZoekLijst();
        if (activeTab === 'coordinator' && coordUnlocked) refreshCoordinatorData(true);
      }
    }
    return !error;
  } catch (err){
    console.error('Fout bij ophalen boeken:', err);
    return false;
  } finally {
    isFetchingBooks = false;
  }
}

function debounce(fn, wait){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function showMatches(containerId, matches){
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!matches.length){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = 'Lijkt al op de lijst te staan:<br>' + matches.slice(0,4).map(b =>
    `<div class="match-item match-item-link" data-titel="${escapeHtml(b.titel)}">• ${escapeHtml(b.titel)}</div>`
  ).join('');
  el.querySelectorAll('.match-item-link').forEach(item => {
    item.addEventListener('click', () => goToZoekenMetTitel(item.dataset.titel));
  });
}

function goToZoekenMetTitel(titel){
  document.querySelector('nav.tabs button[data-tab="zoeken"]')?.click();
  const input = document.getElementById('zoek-input');
  if (input){
    input.value = titel;
    renderZoekLijst();
  }
}

const checkTitelMatch = debounce(() => {
  const el = document.getElementById('titel');
  if (!el) return;
  const val = el.value.trim().toLowerCase();
  if (val.length < 3){ showMatches('titel-match', []); return; }
  showMatches('titel-match', allBooksCache.filter(b => b.titel && b.titel.toLowerCase().includes(val)));
}, 350);

const checkIsbnMatch = debounce(() => {
  const el = document.getElementById('isbn');
  if (!el) return;
  const val = el.value.trim().toLowerCase();
  if (val.length < 3){ showMatches('isbn-match', []); return; }
  showMatches('isbn-match', allBooksCache.filter(b => b.isbn && b.isbn.toLowerCase().includes(val)));
}, 350);

// Automatisch ISBN opzoeken via Google Books API (met Open Library fallback)
const GOOGLE_BOOKS_API_KEY = 'AIzaSyCbxR69LAkdar7fdAXphsg5vs9e_QxWBY0';

async function lookupIsbnGoogleBooks(isbn){
  if (!isbn || isbn.length !== 13) return;
  const statusEl = document.getElementById('isbn-lookup-status');
  if (statusEl){
    statusEl.textContent = 'Gegevens ophalen voor ISBN ' + isbn + '…';
    statusEl.style.color = 'var(--ink-soft)';
    statusEl.style.display = 'block';
  }

  function applyBookInfo(title, author){
    const titelInput = document.getElementById('titel');
    const auteurInput = document.getElementById('auteur');
    if (titelInput && (!titelInput.value || titelInput.value.trim() === '')){
      titelInput.value = title;
      checkTitelMatch();
    }
    if (auteurInput && (!auteurInput.value || auteurInput.value.trim() === '') && author){
      auteurInput.value = author;
    }
    if (statusEl){
      statusEl.textContent = `✓ Boek gevonden: "${title}"` + (author ? ` door ${author}` : '');
      statusEl.style.color = 'var(--green)';
      setTimeout(() => { statusEl.style.display = 'none'; }, 6000);
    }
  }

  // 1. Probeer eerst Google Books met API key
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${GOOGLE_BOOKS_API_KEY}`);
    if (res.ok){
      const data = await res.json();
      if (data.items && data.items.length > 0){
        const info = data.items[0].volumeInfo;
        const title = info.title || '';
        const author = (info.authors && info.authors.length) ? info.authors.join(', ') : '';
        if (title){
          applyBookInfo(title, author);
          return;
        }
      }
    }
  } catch(e){
    console.warn('Google Books lookup fout:', e);
  }

  // 2. Fallback: Open Library
  try {
    const olRes = await fetch(`https://openlibrary.org/search.json?isbn=${isbn}`);
    if (olRes.ok){
      const olData = await olRes.json();
      if (olData.docs && olData.docs.length > 0){
        const doc = olData.docs[0];
        const title = doc.title || '';
        const author = (doc.author_name && doc.author_name.length) ? doc.author_name.join(', ') : '';
        if (title){
          applyBookInfo(title, author);
          return;
        }
      }
    }
  } catch(olErr){
    console.warn('OpenLibrary lookup fout:', olErr);
  }

  if (statusEl){
    statusEl.textContent = 'Geen titel online gevonden voor dit ISBN; vul titel en auteur handmatig in.';
    statusEl.style.color = 'var(--ink-soft)';
    setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
  }
}

document.getElementById('isbn')?.addEventListener('input', e => {
  const cijfers = e.target.value.replace(/\D/g, '').slice(0, 13);
  if (cijfers !== e.target.value) e.target.value = cijfers;
  if (/^\d{13}$/.test(cijfers)){
    document.getElementById('isbn-error').style.display = 'none';
    lookupIsbnGoogleBooks(cijfers);
  }
});
document.getElementById('titel')?.addEventListener('input', checkTitelMatch);
document.getElementById('isbn')?.addEventListener('input', checkIsbnMatch);

// ---------- Camera Barcode Scanner ----------
let html5QrCodeScanner = null;

function openBarcodeScanner(){
  const modal = document.getElementById('scanner-modal');
  if (!modal) return;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (typeof Html5Qrcode === 'undefined'){
    alert('Barcode scanner bibliotheek is nog aan het laden. Probeer het over enkele seconden opnieuw.');
    closeBarcodeScanner();
    return;
  }

  const readerDiv = document.getElementById('scanner-reader');
  if (!readerDiv) return;

  try {
    html5QrCodeScanner = new Html5Qrcode('scanner-reader');
    const config = { fps: 10, qrbox: { width: 250, height: 160 } };

    html5QrCodeScanner.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => {
        // Barcode gevonden
        const cleanDigits = decodedText.replace(/\D/g, '');
        if (cleanDigits.length === 13){
          const isbnInp = document.getElementById('isbn');
          if (isbnInp){
            isbnInp.value = cleanDigits;
            isbnInp.dispatchEvent(new Event('input'));
          }
          closeBarcodeScanner();
        }
      },
      (errorMessage) => {
        // Scan poging zonder match (normaal bij continu scannen)
      }
    ).catch(err => {
      console.warn('Camera kon niet starten:', err);
      // Toon melding maar laat het dialoogvenster netjes open zodat de gebruiker zelf kan sluiten
      const reader = document.getElementById('scanner-reader');
      if (reader){
        reader.innerHTML = `<div style="padding:20px; text-align:center; color:#fff; font-size:13px;">Camera niet beschikbaar of geen toestemming gegeven.<br><br>Sluit dit venster om het ISBN handmatig in te voeren.</div>`;
      }
    });
  } catch(e) {
    console.error('Fout bij initialiseren van scanner:', e);
  }
}

function closeBarcodeScanner(){
  // 1. Sluit altijd DIRECT het dialoogvenster
  const modal = document.getElementById('scanner-modal');
  if (modal){
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  // 2. Stop en ruim de scanner veilig op
  if (html5QrCodeScanner){
    try {
      html5QrCodeScanner.stop().catch(() => {}).finally(() => {
        try { html5QrCodeScanner.clear(); } catch(e){}
        html5QrCodeScanner = null;
      });
    } catch(err){
      try { html5QrCodeScanner.clear(); } catch(e){}
      html5QrCodeScanner = null;
    }
  }
}

document.getElementById('btn-scan-isbn')?.addEventListener('click', openBarcodeScanner);
document.getElementById('scanner-close-btn')?.addEventListener('click', closeBarcodeScanner);
document.getElementById('scanner-backdrop')?.addEventListener('click', closeBarcodeScanner);
document.getElementById('scanner-cancel-btn')?.addEventListener('click', closeBarcodeScanner);

// Sluiten via Escape-toets
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    const scannerModal = document.getElementById('scanner-modal');
    if (scannerModal && scannerModal.classList.contains('open')){
      closeBarcodeScanner();
    }
  }
});

// ---------- Boek aanvragen & Groene Succesbanner ----------
document.getElementById('book-form')?.addEventListener('submit', async e => {
  e.preventDefault();

  const isbnWaarde = document.getElementById('isbn').value.trim();
  const isbnFout = document.getElementById('isbn-error');
  if (!/^\d{13}$/.test(isbnWaarde)){
    isbnFout.style.display = '';
    document.getElementById('isbn').focus();
    return;
  }
  isbnFout.style.display = 'none';

  const categorie = categorieSelect.value;
  let overigWaarde = null;
  if (categorie === 'Overig'){
    const sel = document.getElementById('overig_thema').value;
    overigWaarde = sel === ANDERS ? document.getElementById('overig_thema_anders').value.trim() : sel;
    if (!overigWaarde){
      alert('Vul het overige thema in.');
      return;
    }
  }
  let kleutersWaarde = null;
  if (categorie === 'Kleuters'){
    const sel = document.getElementById('kleuters_thema').value;
    kleutersWaarde = sel === ANDERS ? document.getElementById('kleuters_thema_anders').value.trim() : sel;
    if (!kleutersWaarde){
      alert('Vul het kleuterthema in.');
      return;
    }
  }

  const ingediendeTitel = document.getElementById('titel').value.trim();
  const ingediendeAuteur = document.getElementById('auteur').value.trim() || null;
  const ingediendeAanvrager = document.getElementById('naam_aanvrager').value.trim();

  const nieuwBoek = {
    naam_aanvrager: ingediendeAanvrager,
    titel: ingediendeTitel,
    auteur: ingediendeAuteur,
    isbn: isbnWaarde,
    prijs: document.getElementById('prijs').value ? parsePrijs(document.getElementById('prijs').value) : null,
    categorie: categorie,
    groep: categorie === 'Groep' ? document.getElementById('groep').value : null,
    jeelo_thema: categorie === 'Jeelo' ? document.getElementById('jeelo_thema').value : null,
    overig_thema: categorie === 'Overig' ? overigWaarde : null,
    kleuters_thema: categorie === 'Kleuters' ? kleutersWaarde : null,
    klas_of_kast: null,
    aantal: 1,
    status: 'aangevraagd',
    opmerking: document.getElementById('opmerking').value.trim() || null
  };

  const submitBtn = document.querySelector('#book-form button[type="submit"]');
  if (submitBtn){
    submitBtn.disabled = true;
    submitBtn.textContent = 'Aanvraag versturen…';
  }

  const { error } = await client.from('boeken').insert(nieuwBoek);
  if (submitBtn){
    submitBtn.disabled = false;
    submitBtn.textContent = 'Boek aanvragen';
  }

  const bannerEl = document.getElementById('form-success-banner');
  if (error){
    alert('Opslaan mislukt: ' + error.message);
    return;
  }

  // Toon duidelijke groene succes-banner met samenvatting (Keuze 11)
  if (bannerEl){
    document.getElementById('success-book-title').textContent = ingediendeTitel;
    document.getElementById('success-book-meta').textContent = [
      ingediendeAuteur,
      `Aangevraagd door ${ingediendeAanvrager}`,
      `ISBN ${isbnWaarde}`,
      `Categorie: ${categorie}`
    ].filter(Boolean).join(' · ');
    bannerEl.style.display = 'block';
    document.getElementById('book-form').style.display = 'none';
    bannerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.getElementById('book-form').reset();
  updateCategorieVelden();
  document.getElementById('overig_thema_anders').style.display = 'none';
  document.getElementById('kleuters_thema_anders').style.display = 'none';
  document.getElementById('kleuters_thema_suggesties').style.display = 'none';
  showMatches('titel-match', []);
  showMatches('isbn-match', []);

  await fetchAllBooks();
});

// Knop "Nog een boek aanvragen" in succesbanner
document.getElementById('btn-reset-form')?.addEventListener('click', () => {
  const bannerEl = document.getElementById('form-success-banner');
  if (bannerEl) bannerEl.style.display = 'none';
  const formEl = document.getElementById('book-form');
  if (formEl){
    formEl.style.display = 'block';
    document.getElementById('isbn').focus();
  }
});

document.getElementById('prijs')?.addEventListener('blur', e => {
  const val = e.target.value.trim();
  if (val !== '') e.target.value = formatBedrag(val);
});

// ---------- Tab 2: Boeken zoeken & Weergaveschakelaar (Cards / List / Table) ----------
let zoekCategorie = '';
let zoekThema = '';
let catalogViewMode = localStorage.getItem('catalogus_weergave_v2') || 'table'; // 'table' | 'cards' | 'list'

// Weergave schakelaar knoppen
document.querySelectorAll('.view-toggle-btn').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.view === catalogViewMode);
  btn.addEventListener('click', () => {
    catalogViewMode = btn.dataset.view;
    localStorage.setItem('catalogus_weergave_v2', catalogViewMode);
    document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderZoekLijst(true);
  });
});

const debouncedRenderZoekLijst = debounce(() => renderZoekLijst(true), 150);
document.getElementById('zoek-input')?.addEventListener('input', debouncedRenderZoekLijst);

document.getElementById('zoek-cat-pills')?.addEventListener('click', e => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  zoekCategorie = btn.dataset.cat;
  zoekThema = '';
  document.querySelectorAll('#zoek-cat-pills .pill').forEach(p => p.classList.toggle('active', p === btn));
  populateZoekThemaPills();
  renderZoekLijst(true);
});

function populateZoekThemaPills(){
  const container = document.getElementById('zoek-thema-pills');
  if (!container) return;
  if (!zoekCategorie){
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  const veld = veldVoorCategorie(zoekCategorie);
  const waarden = [...new Set(
    allBooksCache.filter(b => b.status === 'binnen' && b.categorie === zoekCategorie && b[veld]).map(b => b[veld])
  )].sort((a, b) => a.localeCompare(b, 'nl'));
  if (!waarden.length){
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  container.style.display = 'flex';

  if (zoekCategorie === 'Kleuters'){
    if (zoekThema){
      container.innerHTML = `<button class="pill active" id="zoek-thema-clear" type="button">${escapeHtml(zoekThema)} ✕</button>`;
      document.getElementById('zoek-thema-clear')?.addEventListener('click', () => {
        zoekThema = '';
        populateZoekThemaPills();
        renderZoekLijst(true);
      });
      return;
    }
    container.innerHTML = `
      <div class="thema-zoekveld" style="flex:1 1 100%;">
        <input type="text" id="zoek-thema-zoek" placeholder="Zoek een kleuterthema…" autocomplete="off">
        <div class="thema-suggesties" id="zoek-thema-suggesties" style="display:none"></div>
      </div>
    `;
    wireThemaZoekveld(
      document.getElementById('zoek-thema-zoek'),
      document.getElementById('zoek-thema-suggesties'),
      waarden.map(w => ({ value: w, label: w })),
      opt => {
        zoekThema = opt.value;
        populateZoekThemaPills();
        renderZoekLijst(true);
      }
    );
    return;
  }

  const allLabel = (zoekCategorie === 'Groep') ? 'Alle groepen' : "Alle thema's";
  container.innerHTML = `<button class="pill ${!zoekThema ? 'active' : ''}" data-thema="">${allLabel}</button>` +
    waarden.map(w => `<button class="pill ${zoekThema === w ? 'active' : ''}" data-thema="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('');
  container.querySelectorAll('.pill').forEach(btn => btn.addEventListener('click', () => {
    zoekThema = btn.dataset.thema;
    container.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p === btn));
    renderZoekLijst(true);
  }));
}

function renderZoekTags(b){
  let html = '';
  const cat = b.categorie;
  if (cat === 'Kleuters'){
    html += `<span class="tag cat-tag cat-Kleuters">Kleuters</span>`;
    if (b.kleuters_thema && b.kleuters_thema.trim()){
      html += `<span class="tag tag-subthema">${escapeHtml(b.kleuters_thema.trim())}</span>`;
    }
  } else if (cat === 'Groep'){
    const grp = (b.groep && b.groep.trim()) ? b.groep.trim() : 'Groep';
    html += `<span class="tag cat-tag cat-Groep">${escapeHtml(grp)}</span>`;
  } else if (cat === 'Jeelo'){
    html += `<span class="tag cat-tag cat-Jeelo">Jeelo</span>`;
    if (b.jeelo_thema && b.jeelo_thema.trim()){
      html += `<span class="tag tag-subthema">${escapeHtml(b.jeelo_thema.trim())}</span>`;
    }
  } else if (cat === 'Overig'){
    html += `<span class="tag cat-tag cat-Overig">Overig</span>`;
    if (b.overig_thema && b.overig_thema.trim()){
      html += `<span class="tag tag-subthema">${escapeHtml(b.overig_thema.trim())}</span>`;
    }
  } else {
    html += `<span class="tag cat-tag cat-Zonder">Zonder categorie</span>`;
  }

  if (b.opmerking){
    const clean = b.opmerking.trim();
    const shortOpm = clean.length > 40 ? clean.slice(0, 37) + '…' : clean;
    html += `<span class="tag tag-opm" title="${escapeHtml(clean)}">opm: ${escapeHtml(shortOpm)}</span>`;
  }
  return html;
}

// Ophalen van boekomslag (cover) via OpenLibrary / Google Books
function getCoverImgTag(isbn, titel){
  if (!isbn || isbn.length !== 13){
    return `<div class="book-card-cover-placeholder">📖</div>`;
  }
  const openLibUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
  return `
    <img src="${openLibUrl}" alt="Kaft van ${escapeHtml(titel)}" loading="lazy"
         onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'book-card-cover-placeholder\\'>📖</div>';">
  `;
}

const ZOEK_PAGE_SIZE = 36;
let zoekDisplayCount = ZOEK_PAGE_SIZE;
let zoekIntersectionObserver = null;

function renderZoekLijst(resetCount = true){
  if (resetCount){
    zoekDisplayCount = ZOEK_PAGE_SIZE;
  }
  const q = document.getElementById('zoek-input')?.value.trim().toLowerCase() || '';

  let lijst = allBooksCache.filter(b => b.status === 'binnen');
  if (q) lijst = lijst.filter(b => boekZoekTekst(b).includes(q));
  if (zoekCategorie) lijst = lijst.filter(b => b.categorie === zoekCategorie);
  if (zoekThema) lijst = lijst.filter(b => themaVan(b) === zoekThema);

  const countEl = document.getElementById('zoek-count');
  if (countEl){
    countEl.textContent = lijst.length + (lijst.length === 1 ? ' boek op school gevonden' : ' boeken op school gevonden');
  }

  const container = document.getElementById('zoek-list');
  if (!container) return;

  if (!lijst.length){
    if (zoekIntersectionObserver){ zoekIntersectionObserver.disconnect(); zoekIntersectionObserver = null; }
    container.innerHTML = `<div class="empty-state">Geen boeken gevonden.</div>`;
    return;
  }

  const zichtbaar = lijst.slice(0, zoekDisplayCount);
  const heeftMeer = lijst.length > zoekDisplayCount;
  const resterend = lijst.length - zoekDisplayCount;

  const loadMoreHtml = heeftMeer ? `
    <div class="load-more-wrap">
      <div class="load-more-info">Je bekijkt ${zichtbaar.length} van de ${lijst.length} boeken</div>
      <button type="button" class="btn btn-neutral btn-load-more" id="btn-zoek-load-more">
        Toon meer boeken (${Math.min(resterend, ZOEK_PAGE_SIZE)} van ${resterend} resterend)
      </button>
      <div id="zoek-sentinel" class="catalog-sentinel"></div>
    </div>
  ` : '';

  // Stand 1: Kaarten met Kaft (Grid)
  if (catalogViewMode === 'cards'){
    container.innerHTML = `
      <div class="books-grid">
        ${zichtbaar.map(b => {
          const tips = parseBoekentips(b.boekentip);
          const hasTips = tips.length > 0;
          const tipLabel = formatBoekentipBtnLabel(tips.length);
          const tipTitle = formatBoekentipBtnTitle(tips.length);

          return `
            <div class="book-card" data-id="${b.id}">
              <div class="book-card-cover">
                ${getCoverImgTag(b.isbn, b.titel)}
              </div>
              <div class="book-card-body">
                <div class="book-card-title">${escapeHtml(b.titel)}</div>
                <div class="book-card-author">${escapeHtml(b.auteur || '')}</div>
                <div class="book-card-tags">
                  ${renderZoekTags(b)}
                </div>
                <div class="book-card-action">
                  <button type="button" class="btn btn-secondary btn-sm boekentip-toggle ${hasTips ? 'has-tips' : ''}" data-id="${b.id}" data-tips-count="${tips.length}" title="${tipTitle}">
                    ${tipLabel}
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      ${loadMoreHtml}
    `;
  }
  // Stand 2: Tabelweergave
  else if (catalogViewMode === 'table'){
    container.innerHTML = `
      <div class="catalog-table-wrap">
        <table class="catalog-table">
          <thead>
            <tr>
              <th>Titel &amp; Auteur</th>
              <th>Categorie &amp; Thema</th>
              <th>ISBN</th>
              <th>Boekentips</th>
            </tr>
          </thead>
          <tbody>
            ${zichtbaar.map(b => {
              const tips = parseBoekentips(b.boekentip);
              const hasTips = tips.length > 0;
              const tipLabel = formatBoekentipBtnLabel(tips.length);
              const tipTitle = formatBoekentipBtnTitle(tips.length);

              return `
                <tr data-id="${b.id}">
                  <td>
                    <div class="cell-title">${escapeHtml(b.titel)}</div>
                    <div style="font-size:12px; color:var(--ink-soft);">${escapeHtml(b.auteur || 'Onbekend')}</div>
                  </td>
                  <td>${renderZoekTags(b)}</td>
                  <td style="font-size:13px; font-family:monospace; color:var(--ink-soft);">${escapeHtml(b.isbn || '—')}</td>
                  <td>
                    <button type="button" class="btn btn-secondary btn-sm boekentip-toggle ${hasTips ? 'has-tips' : ''}" data-id="${b.id}" data-tips-count="${tips.length}" title="${tipTitle}">
                      ${tipLabel}
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${loadMoreHtml}
    `;
  }
  // Stand 3: Compacte Lijst (Classic)
  else {
    container.innerHTML = `
      <div class="catalog-list-wrap">
        ${zichtbaar.map(b => {
          const tips = parseBoekentips(b.boekentip);
          const hasTips = tips.length > 0;
          const tipLabel = formatBoekentipBtnLabel(tips.length);
          const tipTitle = formatBoekentipBtnTitle(tips.length);

          return `
            <div class="result-card cat-${escapeHtml(b.categorie || '')}" data-id="${b.id}">
              <div class="result-card-main">
                <div class="result-card-content">
                  <div class="title-row">
                    <span class="titel">${escapeHtml(b.titel)}</span>
                    ${b.auteur ? `<span class="meta-inline">· ${escapeHtml(b.auteur)}</span>` : ''}
                  </div>
                  <div class="tags-row">
                    ${renderZoekTags(b)}
                  </div>
                </div>
                <div class="result-card-action">
                  <button type="button" class="btn btn-secondary btn-sm boekentip-toggle ${hasTips ? 'has-tips' : ''}" data-id="${b.id}" data-tips-count="${tips.length}" title="${tipTitle}">
                    ${tipLabel}
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      ${loadMoreHtml}
    `;
  }

  container.querySelectorAll('.boekentip-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openBoekentipModal(btn.dataset.id);
    });
  });

  if (heeftMeer){
    document.getElementById('btn-zoek-load-more')?.addEventListener('click', () => {
      zoekDisplayCount += ZOEK_PAGE_SIZE;
      renderZoekLijst(false);
    });

    if (zoekIntersectionObserver){
      zoekIntersectionObserver.disconnect();
      zoekIntersectionObserver = null;
    }
    const sentinel = document.getElementById('zoek-sentinel');
    if (sentinel && 'IntersectionObserver' in window){
      zoekIntersectionObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting){
          zoekDisplayCount += ZOEK_PAGE_SIZE;
          renderZoekLijst(false);
        }
      }, { rootMargin: '300px' });
      zoekIntersectionObserver.observe(sentinel);
    }
  } else {
    if (zoekIntersectionObserver){
      zoekIntersectionObserver.disconnect();
      zoekIntersectionObserver = null;
    }
  }
}

// ---------- Tab 3: Coördinator ----------
let coordUnlocked = sessionStorage.getItem('coord_ok') === '1';
if (coordUnlocked){
  document.getElementById('coord-lock').style.display = 'none';
  document.getElementById('coord-content').style.display = '';
}

document.getElementById('coord-password')?.addEventListener('keydown', e => {
  if (e.key === 'Enter'){ e.preventDefault(); document.getElementById('coord-unlock').click(); }
});
document.getElementById('coord-unlock')?.addEventListener('click', () => {
  const val = document.getElementById('coord-password').value;
  if (val === COORD_PASSWORD){
    coordUnlocked = true;
    sessionStorage.setItem('coord_ok', '1');
    document.getElementById('coord-lock').style.display = 'none';
    document.getElementById('coord-content').style.display = '';
    refreshCoordinatorData(true);
    fetchAllBooks(false);
  } else {
    document.getElementById('coord-lock-msg').textContent = 'Onjuist wachtwoord.';
  }
});

async function refreshCoordinatorData(skipNetwork = false){
  if (!skipNetwork){
    await fetchAllBooks();
  }
  renderBudget();
  renderTeBestellen();
  renderOnderweg();
  renderAfgewezen();
  renderAlleBoeken();
}

function renderBudget(){
  const jaar = new Date().getFullYear();
  const uitgegeven = allBooksCache
    .filter(b => (b.status === 'besteld' || b.status === 'binnen') && b.besteld_op && new Date(b.besteld_op).getFullYear() === jaar)
    .reduce((sum, b) => sum + parsePrijs(b.prijs), 0);
  const el = document.getElementById('budget-uitgegeven');
  if (el) el.textContent = euro(uitgegeven);
}

function isBekendThema(cat, val){
  if (!val) return false;
  if (cat === 'Groep') return GROEPEN.includes(val);
  if (cat === 'Jeelo') return JEELO_THEMAS.includes(val);
  if (cat === 'Kleuters') return KLEUTERS_THEMAS.includes(val);
  if (cat === 'Overig') return OVERIGE_THEMAS.includes(val);
  return false;
}

function showSaveFeedback(badgeEl){
  if (!badgeEl) return;
  badgeEl.textContent = '✓ Opgeslagen';
  badgeEl.classList.add('visible');
  setTimeout(() => badgeEl.classList.remove('visible'), 2000);
}

function renderSummaryMeta(b){
  const metaParts = [];
  if (b.auteur) metaParts.push(escapeHtml(b.auteur));
  const thema = themaLabel(b);
  if (thema) metaParts.push(escapeHtml(thema));
  if (b.prijs != null && b.prijs !== '') metaParts.push(euro(b.prijs));
  if (b.naam_aanvrager) metaParts.push('door ' + escapeHtml(b.naam_aanvrager));
  if (b.isbn) metaParts.push('ISBN ' + escapeHtml(b.isbn));
  if (b.opmerking){
    const cleanOpm = b.opmerking.trim();
    const shortOpm = cleanOpm.length > 40 ? cleanOpm.slice(0, 37) + '…' : cleanOpm;
    metaParts.push(`<span class="summary-opm" title="${escapeHtml(cleanOpm)}">opm: ${escapeHtml(shortOpm)}</span>`);
  }
  if (b.boekentip){
    const tips = parseBoekentips(b.boekentip).length;
    if (tips) metaParts.push(tips === 1 ? '💡 1 boekentip' : `💡 ${tips} boekentips`);
  }
  return metaParts.join(' &middot; ');
}

function updateSummaryHeader(row, b){
  const titelEl = row.querySelector('.summary-titel');
  if (titelEl) titelEl.textContent = b.titel;
  const statusEl = row.querySelector('.summary-status');
  if (statusEl){
    const s = b.status || 'aangevraagd';
    if (!s || s === 'binnen'){
      statusEl.style.display = 'none';
      statusEl.textContent = '';
      statusEl.className = 'tag summary-status';
    } else {
      statusEl.style.display = '';
      statusEl.className = `tag status-${s} summary-status`;
      if (s === 'aangevraagd') statusEl.textContent = 'te bestellen';
      else if (s === 'besteld') statusEl.textContent = 'onderweg';
      else if (s === 'afgewezen') statusEl.textContent = 'niet leverbaar';
      else statusEl.textContent = s;
    }
  }
  const metaEl = row.querySelector('.summary-meta');
  if (metaEl) metaEl.innerHTML = renderSummaryMeta(b);
}

function themaSelectHtml(b, idPrefix){
  const cat = b ? b.categorie : '';
  if (cat === 'Groep'){
    const current = b ? b.groep : '';
    const isLeeg = !current;
    let html = `<option value="" ${isLeeg ? 'selected' : ''}>(Geen groep)</option>`;
    html += GROEPEN.map(o => `<option value="${escapeHtml(o)}" ${o===current?'selected':''}>${escapeHtml(o)}</option>`).join('');
    return html;
  }
  if (cat === 'Jeelo'){
    const current = b ? b.jeelo_thema : '';
    const isLeeg = !current;
    let html = `<option value="" ${isLeeg ? 'selected' : ''}>(Geen Jeelo-thema)</option>`;
    html += JEELO_THEMAS.map(o => `<option value="${escapeHtml(o)}" ${o===current?'selected':''}>${escapeHtml(o)}</option>`).join('');
    return html;
  }
  if (cat === 'Kleuters'){
    const current = b ? b.kleuters_thema : '';
    const isKnown = KLEUTERS_THEMAS.includes(current);
    const isLeeg = !current;
    let html = `<option value="" ${isLeeg ? 'selected' : ''}>(Geen kleuterthema)</option>`;
    html += KLEUTERS_THEMAS.map(o => `<option value="${escapeHtml(o)}" ${o===current?'selected':''}>${escapeHtml(o)}</option>`).join('');
    html += `<option value="${ANDERS}" ${(!isKnown && current) ? 'selected' : ''}>${(!isKnown && current) ? escapeHtml(current) + ' (eigen thema)' : 'Anders, namelijk…'}</option>`;
    return html;
  }
  if (cat === 'Overig'){
    const current = b ? b.overig_thema : '';
    const isKnown = OVERIGE_THEMAS.includes(current);
    const isLeeg = !current;
    let html = `<option value="" ${isLeeg ? 'selected' : ''}>(Geen overig thema)</option>`;
    html += OVERIGE_THEMAS.map(o => `<option value="${escapeHtml(o)}" ${o===current?'selected':''}>${escapeHtml(o)}</option>`).join('');
    html += `<option value="${ANDERS}" ${(!isKnown && current) ? 'selected' : ''}>${(!isKnown && current) ? escapeHtml(current) + ' (eigen thema)' : 'Anders, namelijk…'}</option>`;
    return html;
  }
  return `<option value="" selected>(Kies eerst categorie)</option>`;
}

function editableRowHtml(b, checkboxClass){
  const prijsVal = b.prijs != null && b.prijs !== '' ? formatBedrag(b.prijs) : '';
  const isCustom = !isBekendThema(b.categorie, b[veldVoorCategorie(b.categorie)]);
  const customVal = isCustom ? (b[veldVoorCategorie(b.categorie)] || '') : '';
  return `
    <div class="book-row" data-id="${b.id}">
      <input type="checkbox" class="${checkboxClass}" data-id="${b.id}">
      <div class="row-fields">
        <div class="field-line" style="justify-content:space-between; align-items:center;">
          <input type="text" class="titel-input" data-field="titel" data-id="${b.id}" value="${escapeHtml(b.titel)}" placeholder="Titel">
          <div class="prijs-input-wrap">
            <span class="currency-prefix">€</span>
            <input type="text" inputmode="decimal" class="prijs-input" data-field="prijs" data-id="${b.id}" value="${prijsVal}" placeholder="0,00">
          </div>
          <span class="save-badge"></span>
        </div>
        <div class="field-line">
          <input type="text" data-field="auteur" data-id="${b.id}" value="${escapeHtml(b.auteur || '')}" placeholder="Auteur" style="flex:1 1 180px;">
          <input type="text" data-field="isbn" data-id="${b.id}" value="${escapeHtml(b.isbn || '')}" placeholder="ISBN" inputmode="numeric" maxlength="13" style="flex:0 1 150px;">
          <input type="text" data-field="naam_aanvrager" data-id="${b.id}" value="${escapeHtml(b.naam_aanvrager || '')}" placeholder="Aangevraagd door" style="flex:1 1 150px;">
        </div>
        <div class="field-line">
          <select data-field="categorie" data-id="${b.id}">
            <option value="Groep" ${b.categorie==='Groep'?'selected':''}>Groep</option>
            <option value="Kleuters" ${b.categorie==='Kleuters'?'selected':''}>Kleuters</option>
            <option value="Jeelo" ${b.categorie==='Jeelo'?'selected':''}>Jeelo</option>
            <option value="Overig" ${b.categorie==='Overig'?'selected':''}>Overige thema's</option>
          </select>
          <select data-field="thema" data-id="${b.id}">${themaSelectHtml(b, b.id)}</select>
          <input type="text" class="thema-anders-input" data-id="${b.id}" placeholder="Vul eigen thema in…" value="${escapeHtml(customVal)}" style="${isCustom && customVal ? '' : 'display:none;'} width:170px;">
        </div>
        <div class="field-line">
          <input type="text" data-field="opmerking" data-id="${b.id}" value="${escapeHtml(b.opmerking || '')}" placeholder="Opmerking" style="flex:1 1 200px;">
        </div>
        <div class="row-save-bar" style="display:none;">
          <button type="button" class="btn btn-primary btn-sm save-row-btn" data-id="${b.id}">💾 Opslaan</button>
          <button type="button" class="btn btn-neutral btn-sm cancel-row-btn" data-id="${b.id}">Herstellen</button>
          <span style="font-size:12px; color:var(--gold-dark); font-weight:600;">● Niet-opgeslagen wijzigingen</span>
        </div>
      </div>
      <div class="row-actions">
        <button class="btn btn-danger btn-sm reject" data-reject="${b.id}">Niet leverbaar</button>
        <button class="btn btn-ghost btn-sm" data-delete="${b.id}" style="color:var(--red);">Verwijderen</button>
      </div>
    </div>
  `;
}

function wireEditableRow(row){
  const id = row.dataset.id;
  const book = allBooksCache.find(b => String(b.id) === String(id));
  const badge = row.querySelector('.save-badge');
  const saveBar = row.querySelector('.row-save-bar');
  const saveBtn = row.querySelector('.save-row-btn');
  const cancelBtn = row.querySelector('.cancel-row-btn');

  const titelInp = row.querySelector('[data-field="titel"]');
  const prijsInp = row.querySelector('[data-field="prijs"]');
  const auteurInp = row.querySelector('[data-field="auteur"]');
  const isbnInp = row.querySelector('[data-field="isbn"]');
  const naamInp = row.querySelector('[data-field="naam_aanvrager"]');
  const catSelect = row.querySelector('[data-field="categorie"]');
  const themaSelect = row.querySelector('[data-field="thema"]');
  const andersInp = row.querySelector('.thema-anders-input');
  const opmerkingInp = row.querySelector('[data-field="opmerking"]');

  function markDirty(){
    if (saveBar) saveBar.style.display = 'flex';
    row.classList.add('has-changes');
    if (badge){
      badge.textContent = '';
      badge.classList.remove('visible');
    }
  }

  function resetToSaved(){
    const currentBook = allBooksCache.find(b => String(b.id) === String(id)) || book;
    if (!currentBook) return;

    if (titelInp) titelInp.value = currentBook.titel || '';
    if (prijsInp) prijsInp.value = currentBook.prijs != null && currentBook.prijs !== '' ? formatBedrag(currentBook.prijs) : '';
    if (auteurInp) auteurInp.value = currentBook.auteur || '';
    if (isbnInp) isbnInp.value = currentBook.isbn || '';
    if (naamInp) naamInp.value = currentBook.naam_aanvrager || '';
    if (catSelect) catSelect.value = currentBook.categorie || 'Groep';
    if (themaSelect) themaSelect.innerHTML = themaSelectHtml(currentBook, id);

    const isCustom = !isBekendThema(currentBook.categorie, currentBook[veldVoorCategorie(currentBook.categorie)]);
    const customVal = isCustom ? (currentBook[veldVoorCategorie(currentBook.categorie)] || '') : '';
    if (andersInp){
      andersInp.value = customVal;
      andersInp.style.display = (isCustom && customVal) ? '' : 'none';
    }

    if (opmerkingInp) opmerkingInp.value = currentBook.opmerking || '';
    if (saveBar) saveBar.style.display = 'none';
    row.classList.remove('has-changes');
  }

  // Luister naar invoer in velden (markeer dirty, maar sla NIET automatisch op)
  titelInp?.addEventListener('input', markDirty);
  auteurInp?.addEventListener('input', markDirty);
  isbnInp?.addEventListener('input', markDirty);
  naamInp?.addEventListener('input', markDirty);
  opmerkingInp?.addEventListener('input', markDirty);
  andersInp?.addEventListener('input', markDirty);

  if (prijsInp){
    prijsInp.addEventListener('input', markDirty);
    prijsInp.addEventListener('blur', e => {
      const val = e.target.value.trim();
      if (val !== '') e.target.value = formatBedrag(val);
    });
  }

  catSelect?.addEventListener('change', e => {
    const newCat = e.target.value;
    if (themaSelect){
      themaSelect.innerHTML = themaSelectHtml({ categorie: newCat }, id);
    }
    if (andersInp){
      andersInp.style.display = 'none';
      andersInp.value = '';
    }
    markDirty();
  });

  themaSelect?.addEventListener('change', e => {
    const val = e.target.value;
    if (val === ANDERS){
      if (andersInp){
        andersInp.style.display = '';
        andersInp.focus();
      }
    } else {
      if (andersInp){
        andersInp.style.display = 'none';
        andersInp.value = '';
      }
    }
    markDirty();
  });

  // Opslaan knop
  saveBtn?.addEventListener('click', async () => {
    const currentBook = allBooksCache.find(b => String(b.id) === String(id));
    if (!currentBook) return;

    const newTitel = titelInp ? titelInp.value.trim() : currentBook.titel;
    if (!newTitel){
      alert('Vul een titel in voor dit boek.');
      titelInp?.focus();
      return;
    }

    const newAuteur = auteurInp ? (auteurInp.value.trim() || null) : null;
    const newPrijsRaw = prijsInp ? prijsInp.value.trim() : '';
    const newPrijs = newPrijsRaw ? parsePrijs(newPrijsRaw) : null;
    const newIsbn = isbnInp ? (isbnInp.value.replace(/\D/g, '').slice(0, 13) || null) : null;
    const newNaam = naamInp ? (naamInp.value.trim() || null) : null;
    const newCat = catSelect ? catSelect.value : currentBook.categorie;

    let newThema = themaSelect ? themaSelect.value : null;
    if (newThema === ANDERS){
      newThema = andersInp ? (andersInp.value.trim() || null) : null;
    }

    const newOpmerking = opmerkingInp ? (opmerkingInp.value.trim() || null) : null;

    const veld = veldVoorCategorie(newCat);
    const updates = {
      titel: newTitel,
      auteur: newAuteur,
      prijs: newPrijs,
      isbn: newIsbn,
      naam_aanvrager: newNaam,
      categorie: newCat,
      groep: null,
      jeelo_thema: null,
      overig_thema: null,
      kleuters_thema: null,
      opmerking: newOpmerking
    };
    if (newThema){
      updates[veld] = newThema;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Opslaan…';

    const ok = await dbUpdate(id, updates);
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Opslaan';

    if (ok !== false){
      Object.assign(currentBook, updates);
      if (saveBar) saveBar.style.display = 'none';
      row.classList.remove('has-changes');
      showSaveFeedback(badge);
      renderBudget();
      updateBulkInfo('aangevraagd');
      updateBulkInfo('besteld');
    }
  });

  // Herstellen knop
  cancelBtn?.addEventListener('click', () => {
    resetToSaved();
  });

  // Knoppen voor acties
  const rejectBtn = row.querySelector('[data-reject]');
  if (rejectBtn) rejectBtn.addEventListener('click', async () => {
    const ok = await dbUpdate(id, { status: 'afgewezen' });
    if (ok) await refreshCoordinatorData(true);
  });

  row.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const boek = allBooksCache.find(x => String(x.id) === String(id));
    if (!bevestigVerwijderen(boek && boek.titel)) return;
    const { error } = await client.from('boeken').delete().eq('id', id);
    if (error){ alert('Verwijderen mislukt: ' + error.message); return; }
    allBooksCache = allBooksCache.filter(x => String(x.id) !== String(id));
    saveCachedBooks(allBooksCache);
    await refreshCoordinatorData(true);
  });
}

function renderTeBestellen(){
  const lijst = allBooksCache.filter(b => b.status === 'aangevraagd' || !b.status);
  const container = document.getElementById('lijst-aangevraagd');
  if (!container) return;
  if (!lijst.length){
    container.innerHTML = `<div class="empty-state">Niets te bestellen op dit moment.</div>`;
  } else {
    container.innerHTML = lijst.map(b => editableRowHtml(b, 'sel-aangevraagd')).join('');
    container.querySelectorAll('.book-row').forEach(wireEditableRow);
    container.querySelectorAll('.sel-aangevraagd').forEach(cb => cb.addEventListener('change', () => updateBulkInfo('aangevraagd')));
  }
  updateBulkInfo('aangevraagd');
}

function renderOnderweg(){
  const lijst = allBooksCache.filter(b => b.status === 'besteld');
  const container = document.getElementById('lijst-besteld');
  if (!container) return;
  if (!lijst.length){
    container.innerHTML = `<div class="empty-state">Niets onderweg op dit moment.</div>`;
  } else {
    container.innerHTML = lijst.map(b => editableRowHtml(b, 'sel-besteld')).join('');
    container.querySelectorAll('.book-row').forEach(wireEditableRow);
    container.querySelectorAll('.sel-besteld').forEach(cb => cb.addEventListener('change', () => updateBulkInfo('besteld')));
  }
  updateBulkInfo('besteld');
}

function renderAfgewezen(){
  const lijst = allBooksCache.filter(b => b.status === 'afgewezen');
  const container = document.getElementById('lijst-afgewezen');
  if (!container) return;
  if (!lijst.length){
    container.innerHTML = `<div class="empty-state">Geen niet leverbare boeken.</div>`;
    return;
  }
  container.innerHTML = lijst.map(b => `
    <div class="book-row" style="grid-template-columns:1fr auto;">
      <div>
        <div style="font-weight:600; font-size:14px;">${escapeHtml(b.titel)}</div>
        <div class="row-meta">
          <span class="tag">${escapeHtml(b.categorie || '')}${themaVan(b) ? ' · ' + escapeHtml(themaVan(b)) : ''}</span>
          ${b.naam_aanvrager ? 'aangevraagd door ' + escapeHtml(b.naam_aanvrager) : ''}
          ${b.opmerking ? '<br>' + escapeHtml(b.opmerking) : ''}
        </div>
      </div>
      <div class="row-actions">
        <button class="btn btn-secondary btn-sm restore" data-restore="${b.id}">Terug naar Te bestellen</button>
        <button class="btn btn-ghost btn-sm" data-delete="${b.id}" style="color:var(--red);">Verwijderen</button>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('[data-restore]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await dbUpdate(btn.dataset.restore, { status: 'aangevraagd', besteld_op: null });
    if (ok) await refreshCoordinatorData(true);
  }));
  container.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
    const boek = allBooksCache.find(x => String(x.id) === String(btn.dataset.delete));
    if (!bevestigVerwijderen(boek && boek.titel)) return;
    const { error } = await client.from('boeken').delete().eq('id', btn.dataset.delete);
    if (error){ alert('Verwijderen mislukt: ' + error.message); return; }
    allBooksCache = allBooksCache.filter(x => String(x.id) !== String(btn.dataset.delete));
    saveCachedBooks(allBooksCache);
    await refreshCoordinatorData(true);
  }));
}

function coordinatorStatusHtml(status){
  if (!status || status === 'binnen') return '<span class="tag summary-status" style="display:none;"></span>';
  let label = status;
  if (status === 'aangevraagd') label = 'te bestellen';
  else if (status === 'besteld') label = 'onderweg';
  else if (status === 'afgewezen') label = 'niet leverbaar';
  return `<span class="tag status-${escapeHtml(status)} summary-status">${escapeHtml(label)}</span>`;
}

function fullRowHtml(b){
  const prijsVal = b.prijs != null && b.prijs !== '' ? formatBedrag(b.prijs) : '';
  const isCustom = !isBekendThema(b.categorie, b[veldVoorCategorie(b.categorie)]);
  const customVal = isCustom ? (b[veldVoorCategorie(b.categorie)] || '') : '';

  return `
    <details class="book-details" data-id="${b.id}">
      <summary>
        <div class="summary-left">
          <input type="checkbox" class="sel-alle" data-id="${b.id}">
          <div class="summary-text">
            <span class="summary-titel">${escapeHtml(b.titel)}</span>
            ${coordinatorStatusHtml(b.status || 'aangevraagd')}
            <span class="summary-meta">${renderSummaryMeta(b)}</span>
          </div>
        </div>
        <span class="chevron">▶</span>
      </summary>
      <div class="book-details-body">
        <div class="edit-status-banner">
          <span style="font-size:12px; color:var(--ink-soft); font-weight:600;">Boek bewerken</span>
          <span class="save-badge"></span>
        </div>
        <div class="edit-grid">
          <div class="edit-field full-width">
            <label>Titel</label>
            <input type="text" class="titel-input" data-field="titel" data-id="${b.id}" value="${escapeHtml(b.titel)}">
          </div>

          <div class="edit-field">
            <label>Auteur</label>
            <input type="text" data-field="auteur" data-id="${b.id}" value="${escapeHtml(b.auteur || '')}" placeholder="Auteur">
          </div>

          <div class="edit-field">
            <label>Prijs (€)</label>
            <div class="prijs-input-wrap">
              <span class="currency-prefix">€</span>
              <input type="text" inputmode="decimal" class="prijs-input" data-field="prijs" data-id="${b.id}" value="${prijsVal}" placeholder="0,00">
            </div>
          </div>

          <div class="edit-field">
            <label>ISBN (13 cijfers)</label>
            <input type="text" data-field="isbn" data-id="${b.id}" value="${escapeHtml(b.isbn || '')}" placeholder="bijv. 97890..." inputmode="numeric" maxlength="13">
          </div>

          <div class="edit-field">
            <label>Aangevraagd door</label>
            <input type="text" data-field="naam_aanvrager" data-id="${b.id}" value="${escapeHtml(b.naam_aanvrager || '')}" placeholder="Naam leerkracht">
          </div>

          <div class="edit-field">
            <label>Categorie</label>
            <select data-field="categorie" data-id="${b.id}">
              <option value="Groep" ${b.categorie==='Groep'?'selected':''}>Groep</option>
              <option value="Kleuters" ${b.categorie==='Kleuters'?'selected':''}>Kleuters</option>
              <option value="Jeelo" ${b.categorie==='Jeelo'?'selected':''}>Jeelo</option>
              <option value="Overig" ${b.categorie==='Overig'?'selected':''}>Overige thema's</option>
            </select>
          </div>

          <div class="edit-field">
            <label>Thema of groep</label>
            <select data-field="thema" data-id="${b.id}">${themaSelectHtml(b, b.id)}</select>
            <input type="text" class="thema-anders-input" data-id="${b.id}" placeholder="Vul eigen thema in…" value="${escapeHtml(customVal)}" style="${isCustom && customVal ? '' : 'display:none;'} margin-top:6px;">
          </div>

          <div class="edit-field">
            <label>Status</label>
            <select data-field="status" data-id="${b.id}">
              <option value="aangevraagd" ${b.status==='aangevraagd'||!b.status?'selected':''}>Aangevraagd (te bestellen)</option>
              <option value="besteld" ${b.status==='besteld'?'selected':''}>Besteld (onderweg)</option>
              <option value="binnen" ${b.status==='binnen'?'selected':''}>Binnen (ontvangen)</option>
              <option value="afgewezen" ${b.status==='afgewezen'?'selected':''}>Niet leverbaar</option>
            </select>
          </div>

          <div class="edit-field full-width">
            <label>Opmerking</label>
            <input type="text" data-field="opmerking" data-id="${b.id}" value="${escapeHtml(b.opmerking || '')}" placeholder="Optionele opmerking">
          </div>
        </div>

        <div class="edit-save-bar" style="display:none;">
          <button type="button" class="btn btn-primary btn-sm save-book-btn" data-id="${b.id}">💾 Wijzigingen opslaan</button>
          <button type="button" class="btn btn-neutral btn-sm cancel-book-btn" data-id="${b.id}">Herstellen</button>
          <span style="font-size:12px; color:var(--gold-dark); font-weight:600;">● Niet-opgeslagen wijzigingen</span>
        </div>

        <div class="coord-boekentips-box" data-id="${b.id}" style="margin-top:14px; padding:10px 14px; background:var(--bg); border-radius:8px; border:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <div>
            <div style="font-size:13px; font-weight:600; color:var(--ink);">💡 Boekentips &amp; Lesideeën</div>
            <div class="coord-tip-count-text" style="font-size:12px; color:var(--ink-soft);">
              ${(() => {
                const count = parseBoekentips(b.boekentip).length;
                return count > 0 ? (count === 1 ? '1 boekentip aanwezig' : `${count} boekentips aanwezig`) : 'Nog geen boekentips voor dit boek';
              })()}
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm open-coord-tip-btn ${parseBoekentips(b.boekentip).length > 0 ? 'has-tips' : ''}" data-id="${b.id}">
            ${parseBoekentips(b.boekentip).length > 0 ? '💡 Bekijken &amp; Beheren' : '+ Boekentip toevoegen'}
          </button>
        </div>

        <div class="row-actions" style="align-items:flex-start; margin-top:14px; padding-top:10px; border-top:1px solid var(--line);">
          <button class="btn btn-ghost btn-sm" data-delete="${b.id}" style="color:var(--red);">Dit boek definitief verwijderen</button>
        </div>
      </div>
    </details>
  `;
}

function wireFullRow(row){
  const id = row.dataset.id;
  const book = allBooksCache.find(b => String(b.id) === String(id));
  const selCb = row.querySelector('.sel-alle');
  if (selCb){
    selCb.addEventListener('click', e => e.stopPropagation());
    selCb.addEventListener('change', () => updateAlleBulkInfo());
  }
  const badge = row.querySelector('.save-badge');
  const saveBar = row.querySelector('.edit-save-bar');
  const saveBtn = row.querySelector('.save-book-btn');
  const cancelBtn = row.querySelector('.cancel-book-btn');

  const titelInp = row.querySelector('[data-field="titel"]');
  const auteurInp = row.querySelector('[data-field="auteur"]');
  const fullPrijsInp = row.querySelector('[data-field="prijs"]');
  const isbnInp = row.querySelector('[data-field="isbn"]');
  const naamInp = row.querySelector('[data-field="naam_aanvrager"]');
  const catSelect = row.querySelector('[data-field="categorie"]');
  const themaSelect = row.querySelector('[data-field="thema"]');
  const andersInp = row.querySelector('.thema-anders-input');
  const statusSelect = row.querySelector('[data-field="status"]');
  const opmerkingInp = row.querySelector('[data-field="opmerking"]');

  function markDirty(){
    if (saveBar) saveBar.style.display = 'flex';
    row.classList.add('has-changes');
    if (badge){
      badge.textContent = '';
      badge.classList.remove('visible');
    }
  }

  function resetToSaved(){
    const currentBook = allBooksCache.find(b => String(b.id) === String(id)) || book;
    if (!currentBook) return;

    if (titelInp) titelInp.value = currentBook.titel || '';
    if (auteurInp) auteurInp.value = currentBook.auteur || '';
    if (fullPrijsInp) fullPrijsInp.value = currentBook.prijs != null && currentBook.prijs !== '' ? formatBedrag(currentBook.prijs) : '';
    if (isbnInp) isbnInp.value = currentBook.isbn || '';
    if (naamInp) naamInp.value = currentBook.naam_aanvrager || '';
    if (catSelect) catSelect.value = currentBook.categorie || 'Groep';
    if (themaSelect) themaSelect.innerHTML = themaSelectHtml(currentBook, id);

    const isCustom = !isBekendThema(currentBook.categorie, currentBook[veldVoorCategorie(currentBook.categorie)]);
    const customVal = isCustom ? (currentBook[veldVoorCategorie(currentBook.categorie)] || '') : '';
    if (andersInp){
      andersInp.value = customVal;
      andersInp.style.display = (isCustom && customVal) ? '' : 'none';
    }

    if (statusSelect) statusSelect.value = currentBook.status || 'aangevraagd';
    if (opmerkingInp) opmerkingInp.value = currentBook.opmerking || '';

    if (saveBar) saveBar.style.display = 'none';
    row.classList.remove('has-changes');
  }

  // Luister naar invoer (markeer dirty, GEEN automatische opslag)
  titelInp?.addEventListener('input', markDirty);
  auteurInp?.addEventListener('input', markDirty);
  isbnInp?.addEventListener('input', markDirty);
  naamInp?.addEventListener('input', markDirty);
  statusSelect?.addEventListener('change', markDirty);
  opmerkingInp?.addEventListener('input', markDirty);
  andersInp?.addEventListener('input', markDirty);

  if (fullPrijsInp){
    fullPrijsInp.addEventListener('input', markDirty);
    fullPrijsInp.addEventListener('blur', e => {
      const val = e.target.value.trim();
      if (val !== '') e.target.value = formatBedrag(val);
    });
  }

  catSelect?.addEventListener('change', e => {
    const newCat = e.target.value;
    if (themaSelect){
      themaSelect.innerHTML = themaSelectHtml({ categorie: newCat }, id);
    }
    if (andersInp){
      andersInp.style.display = 'none';
      andersInp.value = '';
    }
    markDirty();
  });

  themaSelect?.addEventListener('change', e => {
    const val = e.target.value;
    if (val === ANDERS){
      if (andersInp){
        andersInp.style.display = '';
        andersInp.focus();
      }
    } else {
      if (andersInp){
        andersInp.style.display = 'none';
        andersInp.value = '';
      }
    }
    markDirty();
  });

  // Opslaan knop
  saveBtn?.addEventListener('click', async () => {
    const currentBook = allBooksCache.find(b => String(b.id) === String(id));
    if (!currentBook) return;

    const newTitel = titelInp ? titelInp.value.trim() : currentBook.titel;
    if (!newTitel){
      alert('Vul een titel in voor dit boek.');
      titelInp?.focus();
      return;
    }

    const newAuteur = auteurInp ? (auteurInp.value.trim() || null) : null;
    const newPrijsRaw = fullPrijsInp ? fullPrijsInp.value.trim() : '';
    const newPrijs = newPrijsRaw ? parsePrijs(newPrijsRaw) : null;
    const newIsbn = isbnInp ? (isbnInp.value.replace(/\D/g, '').slice(0, 13) || null) : null;
    const newNaam = naamInp ? (naamInp.value.trim() || null) : null;
    const newCat = catSelect ? catSelect.value : currentBook.categorie;

    let newThema = themaSelect ? themaSelect.value : null;
    if (newThema === ANDERS){
      newThema = andersInp ? (andersInp.value.trim() || null) : null;
    }

    const newStatus = statusSelect ? statusSelect.value : (currentBook.status || 'aangevraagd');
    const newOpmerking = opmerkingInp ? (opmerkingInp.value.trim() || null) : null;

    const veld = veldVoorCategorie(newCat);
    const updates = {
      titel: newTitel,
      auteur: newAuteur,
      prijs: newPrijs,
      isbn: newIsbn,
      naam_aanvrager: newNaam,
      categorie: newCat,
      groep: null,
      jeelo_thema: null,
      overig_thema: null,
      kleuters_thema: null,
      status: newStatus,
      opmerking: newOpmerking
    };
    if (newThema){
      updates[veld] = newThema;
    }

    if (newStatus !== currentBook.status){
      if (newStatus === 'aangevraagd'){ updates.besteld_op = null; updates.binnen_op = null; }
      if (newStatus === 'besteld'){ updates.besteld_op = new Date().toISOString(); }
      if (newStatus === 'binnen'){ updates.binnen_op = new Date().toISOString(); }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Opslaan…';

    const ok = await dbUpdate(id, updates);
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Wijzigingen opslaan';

    if (ok !== false){
      Object.assign(currentBook, updates);
      if (saveBar) saveBar.style.display = 'none';
      row.classList.remove('has-changes');
      updateSummaryHeader(row, currentBook);
      showSaveFeedback(badge);
      renderBudget();
    }
  });

  // Herstellen knop
  cancelBtn?.addEventListener('click', () => {
    resetToSaved();
  });

  // Verwijderen knop
  row.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const boek = allBooksCache.find(x => String(x.id) === String(id));
    if (!bevestigVerwijderen(boek && boek.titel)) return;
    const { error } = await client.from('boeken').delete().eq('id', id);
    if (error){ alert('Verwijderen mislukt: ' + error.message); return; }
    allBooksCache = allBooksCache.filter(x => String(x.id) !== String(id));
    saveCachedBooks(allBooksCache);
    await refreshCoordinatorData(true);
  });

  const tipBtn = row.querySelector('.open-coord-tip-btn');
  if (tipBtn){
    tipBtn.addEventListener('click', e => {
      e.stopPropagation();
      openBoekentipModal(id);
    });
  }
}

// ---- Filters "Alle boeken" ----
let alleCategorieFilter = '';
let alleSubThemaFilter = '';
const alleLeegFilters = new Set();

function populateAlleSubThemaPills(){
  const container = document.getElementById('alle-sub-thema-container');
  const pillsEl = document.getElementById('alle-sub-thema-pills');
  const titleEl = document.getElementById('alle-sub-thema-title');
  if (!container || !pillsEl) return;

  if (!alleCategorieFilter || alleCategorieFilter === '__zonder_cat__'){
    container.style.display = 'none';
    pillsEl.innerHTML = '';
    alleSubThemaFilter = '';
    return;
  }

  container.style.display = '';
  if (alleCategorieFilter === 'Kleuters'){
    titleEl.textContent = "Thema's binnen Kleuters:";
    const waarden = [...new Set(allBooksCache.filter(b => b.categorie === 'Kleuters' && b.kleuters_thema).map(b => b.kleuters_thema))].sort((a,b) => a.localeCompare(b,'nl'));
    let html = `<button class="pill ${alleSubThemaFilter===''?'active':''}" data-subthema="">Alle kleuterthema's</button>`;
    html += waarden.map(w => `<button class="pill ${alleSubThemaFilter===w?'active':''}" data-subthema="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('');
    pillsEl.innerHTML = html;
  } else if (alleCategorieFilter === 'Overig'){
    titleEl.textContent = "Thema's binnen Overige thema's:";
    const waarden = [...new Set(allBooksCache.filter(b => b.categorie === 'Overig' && b.overig_thema).map(b => b.overig_thema))].sort((a,b) => a.localeCompare(b,'nl'));
    let html = `<button class="pill ${alleSubThemaFilter===''?'active':''}" data-subthema="">Alle overige thema's</button>`;
    html += waarden.map(w => `<button class="pill ${alleSubThemaFilter===w?'active':''}" data-subthema="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('');
    pillsEl.innerHTML = html;
  } else if (alleCategorieFilter === 'Groep'){
    titleEl.textContent = "Groepen:";
    let html = `<button class="pill ${alleSubThemaFilter===''?'active':''}" data-subthema="">Alle groepen</button>`;
    html += GROEPEN.map(g => `<button class="pill ${alleSubThemaFilter===g?'active':''}" data-subthema="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('');
    pillsEl.innerHTML = html;
  } else if (alleCategorieFilter === 'Jeelo'){
    titleEl.textContent = "Jeelo projecten:";
    let html = `<button class="pill ${alleSubThemaFilter===''?'active':''}" data-subthema="">Alle Jeelo thema's</button>`;
    html += JEELO_THEMAS.map(j => `<button class="pill ${alleSubThemaFilter===j?'active':''}" data-subthema="${escapeHtml(j)}">${escapeHtml(j)}</button>`).join('');
    pillsEl.innerHTML = html;
  }

  pillsEl.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      alleSubThemaFilter = p.dataset.subthema || '';
      pillsEl.querySelectorAll('.pill').forEach(btn => btn.classList.toggle('active', btn === p));
      renderAlleBoeken();
    });
  });
}

function updateResetButtonVisibility(q, statusFilter){
  const resetBtn = document.getElementById('alle-reset-filters');
  if (!resetBtn) return;
  const hasFilter = Boolean(
    q ||
    statusFilter !== '' ||
    alleCategorieFilter !== '' ||
    alleSubThemaFilter !== '' ||
    alleLeegFilters.size > 0
  );
  resetBtn.style.display = hasFilter ? 'inline-block' : 'none';
}

const ALLE_PAGE_SIZE = 40;
let alleDisplayCount = ALLE_PAGE_SIZE;

function renderAlleBoeken(resetCount = true){
  if (resetCount){
    alleDisplayCount = ALLE_PAGE_SIZE;
  }
  const openIds = new Set([...document.querySelectorAll('#lijst-alle details[open]')].map(d => d.dataset.id));
  const q = (document.getElementById('alle-zoek')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('alle-status-filter')?.value || '';

  updateResetButtonVisibility(q, statusFilter);

  let lijst = [...allBooksCache];

  if (q){
    lijst = lijst.filter(b => boekZoekTekst(b).includes(q));
  }

  if (statusFilter === ''){
    lijst = lijst.filter(b => (b.status || 'aangevraagd') !== 'afgewezen');
  } else if (statusFilter === '__alle__'){
    // Alles tonen
  } else {
    lijst = lijst.filter(b => (b.status || 'aangevraagd') === statusFilter);
  }

  if (alleCategorieFilter === '__zonder_cat__'){
    lijst = lijst.filter(b => !b.categorie || String(b.categorie).trim() === '');
  } else if (alleCategorieFilter){
    lijst = lijst.filter(b => b.categorie === alleCategorieFilter);
  }

  if (alleSubThemaFilter){
    lijst = lijst.filter(b => themaVan(b) === alleSubThemaFilter);
  }

  if (alleLeegFilters.has('zonder_kleuters_thema')){
    lijst = lijst.filter(b => b.categorie === 'Kleuters' && (!b.kleuters_thema || b.kleuters_thema.trim() === ''));
  }
  if (alleLeegFilters.has('met_kleuters_thema')){
    lijst = lijst.filter(b => b.categorie === 'Kleuters' && b.kleuters_thema && b.kleuters_thema.trim() !== '');
  }

  if (alleLeegFilters.has('zonder_overig_thema')){
    lijst = lijst.filter(b => b.categorie === 'Overig' && (!b.overig_thema || b.overig_thema.trim() === ''));
  }
  if (alleLeegFilters.has('met_overig_thema')){
    lijst = lijst.filter(b => b.categorie === 'Overig' && b.overig_thema && b.overig_thema.trim() !== '');
  }

  if (alleLeegFilters.has('zonder_groep')){
    lijst = lijst.filter(b => b.categorie === 'Groep' && (!b.groep || b.groep.trim() === ''));
  }
  if (alleLeegFilters.has('met_groep')){
    lijst = lijst.filter(b => b.categorie === 'Groep' && b.groep && b.groep.trim() !== '');
  }

  if (alleLeegFilters.has('zonder_categorie')){
    lijst = lijst.filter(b => !b.categorie || String(b.categorie).trim() === '');
  }
  if (alleLeegFilters.has('met_categorie')){
    lijst = lijst.filter(b => b.categorie && String(b.categorie).trim() !== '');
  }

  if (alleLeegFilters.has('zonder_isbn')){
    lijst = lijst.filter(b => !b.isbn || String(b.isbn).trim() === '');
  }
  if (alleLeegFilters.has('met_isbn')){
    lijst = lijst.filter(b => b.isbn && String(b.isbn).trim() !== '');
  }

  if (alleLeegFilters.has('zonder_auteur')){
    lijst = lijst.filter(b => !b.auteur || String(b.auteur).trim() === '');
  }
  if (alleLeegFilters.has('met_auteur')){
    lijst = lijst.filter(b => b.auteur && String(b.auteur).trim() !== '');
  }

  if (alleLeegFilters.has('zonder_prijs')){
    lijst = lijst.filter(b => b.prijs == null || b.prijs === '' || parsePrijs(b.prijs) === 0);
  }
  if (alleLeegFilters.has('met_prijs')){
    lijst = lijst.filter(b => b.prijs != null && b.prijs !== '' && parsePrijs(b.prijs) > 0);
  }

  if (alleLeegFilters.has('zonder_opmerking')){
    lijst = lijst.filter(b => !b.opmerking || String(b.opmerking).trim() === '');
  }
  if (alleLeegFilters.has('met_opmerking')){
    lijst = lijst.filter(b => b.opmerking && String(b.opmerking).trim() !== '');
  }

  const countEl = document.getElementById('alle-count');
  if (countEl){
    countEl.textContent = lijst.length + (lijst.length === 1 ? ' boek gevonden' : ' boeken gevonden');
  }

  const container = document.getElementById('lijst-alle');
  if (!container) return;
  if (!lijst.length){
    container.innerHTML = `<div class="empty-state">Geen boeken gevonden met de huidige filters.</div>`;
    updateAlleBulkInfo();
    return;
  }

  const zichtbaar = lijst.slice(0, alleDisplayCount);
  const heeftMeer = lijst.length > alleDisplayCount;
  const resterend = lijst.length - alleDisplayCount;

  const loadMoreHtml = heeftMeer ? `
    <div class="load-more-wrap" style="margin-top:16px;">
      <div class="load-more-info">Je bekijkt ${zichtbaar.length} van de ${lijst.length} boeken</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center;">
        <button type="button" class="btn btn-neutral btn-load-more" id="btn-alle-load-more">
          Toon nog ${Math.min(resterend, ALLE_PAGE_SIZE)} boeken (${resterend} resterend)
        </button>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-alle-load-all" style="color:var(--ink-soft);">
          Toon alle ${lijst.length} boeken
        </button>
      </div>
    </div>
  ` : '';

  container.innerHTML = zichtbaar.map(fullRowHtml).join('') + loadMoreHtml;
  container.querySelectorAll('.book-details').forEach(row => {
    wireFullRow(row);
    if (openIds.has(row.dataset.id)) row.open = true;
  });

  document.getElementById('btn-alle-load-more')?.addEventListener('click', () => {
    alleDisplayCount += ALLE_PAGE_SIZE;
    renderAlleBoeken(false);
  });

  document.getElementById('btn-alle-load-all')?.addEventListener('click', () => {
    alleDisplayCount = lijst.length;
    renderAlleBoeken(false);
  });

  updateAlleBulkInfo();
}

const debouncedRenderAlleBoeken = debounce(() => renderAlleBoeken(true), 150);
document.getElementById('alle-zoek')?.addEventListener('input', debouncedRenderAlleBoeken);
document.getElementById('alle-status-filter')?.addEventListener('change', () => renderAlleBoeken(true));

document.querySelectorAll('#alle-cat-pills .pill').forEach(btn => {
  btn.addEventListener('click', () => {
    alleCategorieFilter = btn.dataset.cat || '';
    document.querySelectorAll('#alle-cat-pills .pill').forEach(p => p.classList.toggle('active', p === btn));
    alleSubThemaFilter = '';
    populateAlleSubThemaPills();
    renderAlleBoeken(true);
  });
});

const FILTER_PAIRS = {
  'zonder_kleuters_thema': 'met_kleuters_thema',
  'met_kleuters_thema': 'zonder_kleuters_thema',
  'zonder_overig_thema': 'met_overig_thema',
  'met_overig_thema': 'zonder_overig_thema',
  'zonder_groep': 'met_groep',
  'met_groep': 'zonder_groep',
  'zonder_categorie': 'met_categorie',
  'met_categorie': 'zonder_categorie',
  'zonder_isbn': 'met_isbn',
  'met_isbn': 'zonder_isbn',
  'zonder_auteur': 'met_auteur',
  'met_auteur': 'zonder_auteur',
  'zonder_prijs': 'met_prijs',
  'met_prijs': 'zonder_prijs',
  'zonder_opmerking': 'met_opmerking',
  'met_opmerking': 'zonder_opmerking'
};

document.querySelectorAll('#alle-eigenschappen-filters .pill[data-leegfilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    const f = btn.dataset.leegfilter;
    const opposite = FILTER_PAIRS[f];
    if (alleLeegFilters.has(f)){
      alleLeegFilters.delete(f);
      btn.classList.remove('active');
    } else {
      alleLeegFilters.add(f);
      btn.classList.add('active');
      if (opposite && alleLeegFilters.has(opposite)){
        alleLeegFilters.delete(opposite);
        document.querySelector(`#alle-eigenschappen-filters .pill[data-leegfilter="${opposite}"]`)?.classList.remove('active');
      }
    }
    renderAlleBoeken(true);
  });
});

document.getElementById('alle-reset-filters')?.addEventListener('click', () => {
  document.getElementById('alle-zoek').value = '';
  document.getElementById('alle-status-filter').value = '';
  alleCategorieFilter = '';
  alleSubThemaFilter = '';
  alleLeegFilters.clear();
  document.querySelectorAll('#alle-cat-pills .pill').forEach(p => p.classList.toggle('active', p.dataset.cat === ''));
  document.querySelectorAll('#alle-eigenschappen-filters .pill').forEach(p => p.classList.remove('active'));
  populateAlleSubThemaPills();
  renderAlleBoeken(true);
});

// ---- Bulk Toolbar ----
function updateAlleBulkInfo(){
  const allCbs = [...document.querySelectorAll('.sel-alle')];
  const checked = allCbs.filter(cb => cb.checked);

  const masterCb = document.getElementById('sel-all-alle');
  if (masterCb){
    masterCb.disabled = allCbs.length === 0;
    masterCb.checked = allCbs.length > 0 && checked.length === allCbs.length;
    masterCb.indeterminate = checked.length > 0 && checked.length < allCbs.length;
  }
  const infoEl = document.getElementById('alle-bulk-info');
  if (infoEl){
    if (allCbs.length === 0){
      infoEl.textContent = '0 geselecteerd';
    } else if (checked.length === 0){
      infoEl.textContent = `0 van de ${allCbs.length} geselecteerd`;
    } else {
      infoEl.innerHTML = `<strong>${checked.length}</strong> van de <strong>${allCbs.length}</strong> geselecteerd`;
    }
  }

  const deselectBtn = document.getElementById('alle-bulk-deselect');
  if (deselectBtn){
    deselectBtn.style.display = checked.length > 0 ? 'inline-block' : 'none';
  }

  const hasSel = checked.length > 0;
  const statusBtn = document.getElementById('alle-bulk-status-apply');
  if (statusBtn) statusBtn.disabled = !hasSel;
  const themaBtn = document.getElementById('alle-bulk-thema-apply');
  if (themaBtn) themaBtn.disabled = !hasSel;
  const opmSetBtn = document.getElementById('alle-bulk-opmerking-set');
  if (opmSetBtn) opmSetBtn.disabled = !hasSel;
  const opmDelBtn = document.getElementById('alle-bulk-opmerking-delete');
  if (opmDelBtn) opmDelBtn.disabled = !hasSel;
  const deleteBtn = document.getElementById('alle-bulk-delete');
  if (deleteBtn) deleteBtn.disabled = !hasSel;
}

function populateBulkThemaSelect(cat, themaEl){
  let html = '';
  if (cat === 'Groep'){
    html = `<option value="" disabled selected>Kies groep…</option>`
      + `<option value="__leeg__">(Geen groep)</option>`
      + GROEPEN.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  } else if (cat === 'Jeelo'){
    html = `<option value="" disabled selected>Kies thema…</option>`
      + `<option value="__leeg__">(Geen Jeelo-thema)</option>`
      + JEELO_THEMAS.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  } else if (cat === 'Kleuters'){
    html = `<option value="" disabled selected>Kies kleuterthema…</option>`
      + `<option value="__leeg__">(Geen kleuterthema)</option>`
      + KLEUTERS_THEMAS.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')
      + `<option value="${ANDERS}">Anders, namelijk…</option>`;
  } else {
    html = `<option value="" disabled selected>Kies overig thema…</option>`
      + `<option value="__leeg__">(Geen overig thema)</option>`
      + OVERIGE_THEMAS.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')
      + `<option value="${ANDERS}">Anders, namelijk…</option>`;
  }
  themaEl.innerHTML = html;
}

function initAlleBulkThema(){
  const catEl = document.getElementById('alle-bulk-cat');
  const themaEl = document.getElementById('alle-bulk-thema');
  const andersEl = document.getElementById('alle-bulk-thema-anders');
  if (!catEl || !themaEl) return;
  populateBulkThemaSelect(catEl.value, themaEl);
  catEl.addEventListener('change', () => {
    populateBulkThemaSelect(catEl.value, themaEl);
    if (andersEl) andersEl.style.display = 'none';
  });
  themaEl.addEventListener('change', () => {
    if (andersEl){
      andersEl.style.display = themaEl.value === ANDERS ? 'inline-block' : 'none';
      if (themaEl.value === ANDERS) andersEl.focus();
    }
  });
}
initAlleBulkThema();

document.getElementById('sel-all-alle')?.addEventListener('change', e => {
  document.querySelectorAll('.sel-alle').forEach(cb => { cb.checked = e.target.checked; });
  updateAlleBulkInfo();
});

document.getElementById('alle-bulk-deselect')?.addEventListener('click', () => {
  document.querySelectorAll('.sel-alle').forEach(cb => { cb.checked = false; });
  const masterCb = document.getElementById('sel-all-alle');
  if (masterCb) masterCb.checked = false;
  updateAlleBulkInfo();
});

document.getElementById('alle-bulk-status-apply')?.addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.sel-alle:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  const nieuweStatus = document.getElementById('alle-bulk-status').value;
  const updates = { status: nieuweStatus };
  if (nieuweStatus === 'aangevraagd'){ updates.besteld_op = null; updates.binnen_op = null; }
  if (nieuweStatus === 'besteld'){ updates.besteld_op = new Date().toISOString(); }
  if (nieuweStatus === 'binnen'){ updates.binnen_op = new Date().toISOString(); }

  const { error } = await client.from('boeken').update(updates).in('id', ids);
  if (error){ alert('Bulk-wijziging status mislukt: ' + error.message); return; }
  allBooksCache.forEach(b => {
    if (ids.includes(String(b.id))) Object.assign(b, updates);
  });
  saveCachedBooks(allBooksCache);
  await refreshCoordinatorData(true);
});

document.getElementById('alle-bulk-thema-apply')?.addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.sel-alle:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  const cat = document.getElementById('alle-bulk-cat').value;
  const rawThema = document.getElementById('alle-bulk-thema').value;
  if (!rawThema){
    alert('Kies eerst een thema of groep uit de lijst.');
    return;
  }
  let thema = rawThema;
  if (rawThema === '__leeg__'){
    thema = null;
  } else if (rawThema === ANDERS){
    const andersInp = document.getElementById('alle-bulk-thema-anders');
    thema = (andersInp ? andersInp.value : '').trim();
    if (!thema){
      alert('Vul het eigen thema in het invoerveld in.');
      if (andersInp) andersInp.focus();
      return;
    }
  }

  const veld = veldVoorCategorie(cat);
  const updates = {
    categorie: cat,
    groep: null,
    jeelo_thema: null,
    overig_thema: null,
    kleuters_thema: null
  };
  updates[veld] = thema;

  const { error } = await client.from('boeken').update(updates).in('id', ids);
  if (error){ alert('Bulk-wijziging categorie/thema mislukt: ' + error.message); return; }
  allBooksCache.forEach(b => {
    if (ids.includes(String(b.id))) Object.assign(b, updates);
  });
  saveCachedBooks(allBooksCache);
  await refreshCoordinatorData(true);
});

document.getElementById('alle-bulk-opmerking-set')?.addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.sel-alle:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  const txt = document.getElementById('alle-bulk-opmerking-tekst').value.trim();
  if (!txt){
    if (!confirm('Er is geen tekst ingevuld. Wil je de opmerking van alle geselecteerde boeken leegmaken?')) return;
  }
  const updates = { opmerking: txt || null };
  const { error } = await client.from('boeken').update(updates).in('id', ids);
  if (error){ alert('Instellen van opmerking mislukt: ' + error.message); return; }
  allBooksCache.forEach(b => {
    if (ids.includes(String(b.id))) Object.assign(b, updates);
  });
  saveCachedBooks(allBooksCache);
  document.getElementById('alle-bulk-opmerking-tekst').value = '';
  await refreshCoordinatorData(true);
});

document.getElementById('alle-bulk-opmerking-delete')?.addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.sel-alle:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  const metOpmerking = allBooksCache.filter(b => ids.includes(String(b.id)) && b.opmerking && String(b.opmerking).trim() !== '');
  if (!metOpmerking.length){
    alert('Geen van de geselecteerde boeken heeft een opmerking.');
    return;
  }
  const vraag = metOpmerking.length === 1
    ? 'Weet je zeker dat je de opmerking van 1 geselecteerd boek wilt wissen?'
    : `Weet je zeker dat je de opmerking van ${metOpmerking.length} geselecteerde boeken wilt wissen?`;
  if (!confirm(vraag)) return;
  const idsToClear = metOpmerking.map(b => b.id);
  const { error } = await client.from('boeken').update({ opmerking: null }).in('id', idsToClear);
  if (error){ alert('Wissen van opmerkingen mislukt: ' + error.message); return; }
  allBooksCache.forEach(b => {
    if (idsToClear.includes(b.id)) b.opmerking = null;
  });
  saveCachedBooks(allBooksCache);
  await refreshCoordinatorData(true);
});

document.getElementById('alle-bulk-delete')?.addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.sel-alle:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  if (!confirm(`${ids.length} boek(en) definitief verwijderen?\n\nDit kan NIET ongedaan worden gemaakt (geen back-up).`)) return;
  const resultaten = await Promise.all(ids.map(id => client.from('boeken').delete().eq('id', id)));
  const mislukt = resultaten.filter(r => r.error).length;
  if (mislukt) alert(`Verwijderen van ${mislukt} boek(en) mislukt.`);
  const mislukteIds = resultaten.filter(r => r.error).map((r, i) => ids[i]);
  allBooksCache = allBooksCache.filter(b => !ids.includes(String(b.id)) || mislukteIds.includes(String(b.id)));
  saveCachedBooks(allBooksCache);
  await refreshCoordinatorData(true);
});

function updateBulkInfo(groep){
  const checkboxClass = groep === 'aangevraagd' ? '.sel-aangevraagd' : '.sel-besteld';
  const infoId = groep === 'aangevraagd' ? 'te-bestellen-info' : 'onderweg-info';
  const buttonId = groep === 'aangevraagd' ? 'bulk-besteld' : 'bulk-binnen';
  const allCheckboxId = groep === 'aangevraagd' ? 'sel-all-aangevraagd' : 'sel-all-besteld';

  const allCbs = [...document.querySelectorAll(checkboxClass)];
  const checked = allCbs.filter(cb => cb.checked);

  const masterCb = document.getElementById(allCheckboxId);
  if (masterCb){
    masterCb.disabled = allCbs.length === 0;
    masterCb.checked = allCbs.length > 0 && checked.length === allCbs.length;
    masterCb.indeterminate = checked.length > 0 && checked.length < allCbs.length;
  }

  const total = checked.reduce((sum, cb) => {
    const b = allBooksCache.find(x => String(x.id) === String(cb.dataset.id));
    return sum + (b ? parsePrijs(b.prijs) : 0);
  }, 0);
  const infoEl = document.getElementById(infoId);
  if (infoEl){
    if (allCbs.length === 0){
      infoEl.textContent = '0 geselecteerd';
    } else if (checked.length === 0){
      infoEl.textContent = `0 van de ${allCbs.length} geselecteerd`;
    } else {
      infoEl.innerHTML = `<strong>${checked.length}</strong> van de <strong>${allCbs.length}</strong> geselecteerd &middot; totaal <strong>${euro(total)}</strong>`;
    }
  }
  const btn = document.getElementById(buttonId);
  if (btn) btn.disabled = checked.length === 0;
}

document.getElementById('sel-all-aangevraagd')?.addEventListener('change', e => {
  document.querySelectorAll('.sel-aangevraagd').forEach(cb => { cb.checked = e.target.checked; });
  updateBulkInfo('aangevraagd');
});

document.getElementById('sel-all-besteld')?.addEventListener('change', e => {
  document.querySelectorAll('.sel-besteld').forEach(cb => { cb.checked = e.target.checked; });
  updateBulkInfo('besteld');
});

document.getElementById('bulk-besteld')?.addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.sel-aangevraagd:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  const now = new Date().toISOString();
  const { error } = await client.from('boeken').update({ status: 'besteld', besteld_op: now }).in('id', ids);
  if (error){ console.error(error); alert('Markeren als besteld is mislukt: ' + error.message); return; }
  allBooksCache.forEach(b => {
    if (ids.includes(String(b.id))) { b.status = 'besteld'; b.besteld_op = now; }
  });
  saveCachedBooks(allBooksCache);
  await refreshCoordinatorData(true);
});

document.getElementById('bulk-binnen')?.addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.sel-besteld:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  const now = new Date().toISOString();
  const { error } = await client.from('boeken').update({ status: 'binnen', binnen_op: now }).in('id', ids);
  if (error){ console.error(error); alert('Markeren als binnengekomen is mislukt: ' + error.message); return; }
  allBooksCache.forEach(b => {
    if (ids.includes(String(b.id))) { b.status = 'binnen'; b.binnen_op = now; }
  });
  saveCachedBooks(allBooksCache);
  await refreshCoordinatorData(true);
});

// ---------- Export: CSV & Printbare Bestelbon (Keuze 18) ----------
function exportBestellingenCsv(){
  const checked = [...document.querySelectorAll('.sel-aangevraagd:checked')].map(cb => cb.dataset.id);
  let boeken = checked.length
    ? allBooksCache.filter(b => checked.includes(String(b.id)))
    : allBooksCache.filter(b => b.status === 'aangevraagd' || !b.status);

  if (!boeken.length){
    alert('Geen boeken om te exporteren.');
    return;
  }

  const header = ['Titel', 'Auteur', 'ISBN', 'Prijs', 'Categorie', 'Thema of Groep', 'Aanvrager', 'Opmerking'];
  const rows = boeken.map(b => [
    `"${(b.titel || '').replace(/"/g, '""')}"`,
    `"${(b.auteur || '').replace(/"/g, '""')}"`,
    `"${(b.isbn || '').replace(/"/g, '""')}"`,
    `"${formatBedrag(b.prijs || 0)}"`,
    `"${(b.categorie || '').replace(/"/g, '""')}"`,
    `"${(themaVan(b) || '').replace(/"/g, '""')}"`,
    `"${(b.naam_aanvrager || '').replace(/"/g, '""')}"`,
    `"${(b.opmerking || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [header.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const datumStr = new Date().toISOString().slice(0, 10);
  a.download = `bestelling-sterrenwerk-${datumStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function printBestelbon(){
  const checked = [...document.querySelectorAll('.sel-aangevraagd:checked')].map(cb => cb.dataset.id);
  let boeken = checked.length
    ? allBooksCache.filter(b => checked.includes(String(b.id)))
    : allBooksCache.filter(b => b.status === 'aangevraagd' || !b.status);

  if (!boeken.length){
    alert('Geen te bestellen boeken geselecteerd om te printen.');
    return;
  }

  const datum = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  const totaalBedrag = boeken.reduce((sum, b) => sum + parsePrijs(b.prijs), 0);

  const printArea = document.getElementById('print-bestelbon-area');
  if (!printArea) return;

  function bestemdVoorTekst(b){
    const parts = [];
    const thema = themaLabel(b);
    if (thema) parts.push(thema);
    if (b.naam_aanvrager) parts.push(b.naam_aanvrager);
    return parts.join(' — ') || '—';
  }

  printArea.innerHTML = `
    <div class="print-order-sheet">
      <div class="print-header">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h1 style="font-size:18pt; margin:0 0 4px; font-weight:700; color:#000;">Bestellijst Boeken</h1>
            <div style="font-size:12pt; font-weight:600; color:#111;">Basisschool Het Sterrenwerk</div>
            <div style="font-size:9.5pt; color:#555; margin-top:2px;">Bestemd voor boekhandel / leverancier</div>
          </div>
          <div style="text-align:right; font-size:9.5pt; color:#222; line-height:1.4;">
            <div><strong>Besteldatum:</strong> ${datum}</div>
            <div><strong>Aantal titels:</strong> ${boeken.length}</div>
            <div><strong>Totaalbedrag (indicatie):</strong> ${euro(totaalBedrag)}</div>
          </div>
        </div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th style="width:30px; text-align:center;">#</th>
            <th style="width:45px; text-align:center;">Aantal</th>
            <th style="width:145px;">ISBN-13</th>
            <th>Titel</th>
            <th style="width:150px;">Auteur</th>
            <th style="width:130px;">Bestemd voor</th>
            <th style="width:75px; text-align:right;">Prijs</th>
          </tr>
        </thead>
        <tbody>
          ${boeken.map((b, idx) => `
            <tr>
              <td style="text-align:center; color:#555;">${idx + 1}</td>
              <td style="text-align:center; font-weight:700;">1x</td>
              <td class="isbn-cell">${escapeHtml(b.isbn || '—')}</td>
              <td><strong>${escapeHtml(b.titel)}</strong></td>
              <td>${escapeHtml(b.auteur || '—')}</td>
              <td style="font-size:9pt; color:#333;">${escapeHtml(bestemdVoorTekst(b))}</td>
              <td style="text-align:right;">${b.prijs ? euro(b.prijs) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" style="text-align:right; font-weight:700;">
              Totaal (${boeken.length} ${boeken.length === 1 ? 'boek' : 'boeken'}):
            </td>
            <td style="text-align:right; font-weight:700;">${euro(totaalBedrag)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="print-footer" style="margin-top:20px; padding-top:10px; border-top:1px solid #CCC; display:flex; justify-content:space-between; font-size:8.5pt; color:#555;">
        <div>Basisschool Het Sterrenwerk &middot; Boekenbestelling</div>
        <div>Graag leveren t.a.v. de taalcoördinator / administratie</div>
      </div>
    </div>
  `;

  // Maak printgebied zichtbaar voor de afdruk-dialoog
  printArea.style.display = 'block';

  // Roep print aan en verberg het gebied naderhand weer
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      printArea.style.display = 'none';
    }, 400);
  }, 100);
}

document.getElementById('btn-export-csv')?.addEventListener('click', exportBestellingenCsv);
document.getElementById('btn-print-bestelbon')?.addEventListener('click', printBestelbon);

// Waarschuwing bij verlaten van de pagina als er nog niet-opgeslagen wijzigingen zijn
window.addEventListener('beforeunload', e => {
  if (document.querySelector('.book-row.has-changes, .book-details.has-changes')){
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- Init ----------
// 1. Direct uit lokale cache tonen (binnen ~10ms!)
const cachedStartupBooks = loadCachedBooks();
if (cachedStartupBooks && cachedStartupBooks.length > 0){
  allBooksCache = cachedStartupBooks;
  renderZoekLijst();
  if (coordUnlocked) refreshCoordinatorData(true);
}

// 2. Verse data op de achtergrond synchroniseren
fetchAllBooks().then(() => {
  // Als er nog geen cache was (koude eerste start), toon dan nu de boeken
  if (!cachedStartupBooks || !cachedStartupBooks.length){
    renderZoekLijst();
    if (coordUnlocked) refreshCoordinatorData(true);
  }
});
