'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

// Конкретные торговые площадки MOEX: только они дают актуальные данные и правильный тип.
// TQOB = ОФЗ, TQMU = муниципальные, TQCB = корпоративные (руб.), TQOD = корпоративные (USD/EUR)
const BOARDS = [
  { id: 'TQOB', type: 'ОФЗ' },
  { id: 'TQMU', type: 'Муниципальные' },
  { id: 'TQCB', type: 'Корпоративные' },
  { id: 'TQOD', type: 'Корпоративные' },
];

const SEC_TYPES    = ['ОФЗ', 'Муниципальные', 'Корпоративные', 'Прочие'];
// COUPONTYPE недоступен в пакетном MOEX API → определяем через эвристику
// Флоатер: ОФЗ-ПК (SU29xxx), ОФЗ-ИН (SU52xxx), корп. с КС/RUON в названии
const COUPON_TYPES = ['Фиксированный', 'Флоатер', 'Переменный', 'Дисконтный', 'Прочие'];
const CURRENCIES   = ['SUR', 'USD', 'EUR'];

// Порядок отображения рейтингов в фильтре (от лучшего к худшему)
const RATING_ORDER = [
  'AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-',
  'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-',
  'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D',
  'Нет рейтинга',
];

const TYPE_COLOR = {
  'ОФЗ':           '#2680eb',
  'Муниципальные': '#2d9e5f',
  'Корпоративные': '#e07b00',
  'Прочие':        '#8c8c8c',
};

// Цвета точек по рейтингу — «Виридис»:
// почти чёрный → фиолетовый → синий → голубой → бирюза → зелёный → лайм → лимонный (AAA)
const RATING_COLOR = {
  'AAA':  '#E0F000',
  'AA+':  '#CCE800',
  'AA':   '#A8DE00',
  'AA-':  '#6CD424',
  'A+':   '#30C44C',
  'A':    '#00B87C',
  'A-':   '#00B0B0',
  'BBB+': '#0098CC',
  'BBB':  '#1878D4',
  'BBB-': '#1F4DC0',
  'BB+':  '#5C1A96',
  'BB':   '#2E0B55',
  'BB-':  '#0D0221',
};
const RATING_COLOR_JUNK = '#060008';  // B+ и ниже — почти чёрный
const RATING_COLOR_NONE = '#9e9e9e';  // без рейтинга

// Палитра: 4 зоны, внутри каждой лучший рейтинг — ярче, худший — бледнее,
// но все цвета достаточно насыщены и хорошо видны.
// Интерполяция в RGB между двумя якорными точками каждой зоны.
const PORTFOLIO_RATING_ZONES = {
  // Зелёная: #00c853 (AAA) → #a5d6a7 (AA-) — 4 шага
  'AAA':  '#00c853',
  'AA+':  '#37cd6f',
  'AA':   '#6ed28b',
  'AA-':  '#a5d6a7',
  // Жёлтая: #f9a825 (A+) → #ffe082 (A-) — 3 шага
  'A+':   '#f9a825',
  'A':    '#fcc454',
  'A-':   '#ffe082',
  // Синяя: #1565c0 (BBB+) → #82b1ff (BBB-) — 3 шага
  'BBB+': '#1565c0',
  'BBB':  '#4c8be0',
  'BBB-': '#82b1ff',
  // Красная: #f44336 (BB+) → #ffb3ae (D) — 12 шагов
  'BB+':  '#f44336',
  'BB':   '#f54d41',
  'BB-':  '#f6574c',
  'B+':   '#f76257',
  'B':    '#f86c62',
  'B-':   '#f9766d',
  'CCC+': '#fa8178',
  'CCC':  '#fb8b83',
  'CCC-': '#fc958e',
  'CC':   '#fd9f99',
  'C':    '#feaaa4',
  'D':    '#ffb3ae',
};

// Элементы легенды для рейтинговой шкалы
const RATING_LEGEND_ITEMS = [
  ['AAA / ОФЗ',    '#00c853'],
  ['AA+',          '#37cd6f'],
  ['AA',           '#6ed28b'],
  ['AA-',          '#a5d6a7'],
  ['A+',           '#f9a825'],
  ['A',            '#fcc454'],
  ['A-',           '#ffe082'],
  ['BBB+',         '#1565c0'],
  ['BBB',          '#4c8be0'],
  ['BBB-',         '#82b1ff'],
  ['BB+',          '#f44336'],
  ['BB',           '#f6574c'],
  ['BB-',          '#f86c62'],
  ['Ниже BB-',     '#fb8b83'],
  ['Нет рейтинга', '#9e9e9e'],
];

// Нормализует одну строку рейтинга к стандартному виду:
// "AA+(RU)" → "AA+", "RUAA+" → "AA+", "AA+.RU" → "AA+", "AA+(RU.SF)" → "AA+", "BB-|RU|" → "BB-"
function normalizeRatingStr(s) {
  return s.trim()
    .replace(/\|[Rr][Uu]\|.*$/, '')                  // убираем |RU| и всё после (НРА: "BB-|RU|")
    .replace(/\([Rr][Uu](?:\.[A-Za-z]+)?\)$/, '')  // убираем (RU), (RU.SF) и т.п.
    .replace(/^[Rr][Uu]/, '')                        // убираем RU-префикс (Эксперт РА)
    .replace(/\.[Rr][Uu]$/i, '')                     // убираем .RU-суффикс (НКР)
    .toUpperCase().trim();
}

// Разбивает строку рейтингов на массив нормализованных значений из RATING_ORDER
// "A-(RU); RUA+" → ["A-", "A+"]
function normalizeRatings(raw) {
  if (!raw) return [];
  return [...new Set(
    raw.split(/[;,]/)
      .map(normalizeRatingStr)
      .filter(s => RATING_ORDER.includes(s))
  )];
}

// ─── State ───────────────────────────────────────────────────────────────────

let allBonds       = [];
let filteredBonds  = [];
let ofzCurveData   = [];   // [[period_years, yield_%], ...] — КБД MOEX
let selectedBonds  = [];
let drillMode      = false;   // true — карта показывает только выделенные бумаги
let pendingBrush   = [];      // бонды из brushSelected, ждут mouseup
let drillPending   = false;   // mouseup уже был, ждём последний brushSelected
let seriesData     = {};      // { typeName: Bond[] } — параллельно сериям графика
let chart          = null;
let tableSort      = { col: 'ytm', dir: 'desc' };
let drillStack     = [];     // [{bonds: Bond[]|null, zoom: [...]}] — история drill-уровней

let searchQuery    = '';      // текущий поисковый запрос (raw, не trimmed)
let searchMode     = 'highlight'; // 'highlight' | 'only'

const filters = {
  types:       new Set(SEC_TYPES),
  couponTypes: new Set(COUPON_TYPES),
  currencies:  new Set(CURRENCIES),
  ratings:     new Set(),   // заполняется динамически в buildRatingFilter()
};

let ratingsMap = {};   // SECID → ratingGroup, загружается из ratings.json

// ─── Portfolio state ──────────────────────────────────────────────────────────
const PORTFOLIO_COLORS = ['#ff6b35', '#9c27b0', '#2196f3', '#26c6da', '#66bb6a', '#ffa726'];
let portfolioData     = { portfolios: [] };
let visiblePortfolios    = new Set();
let pendingExcelRows     = null;
let portfolioFilterMode  = false;

// ─── MOEX ISS API ────────────────────────────────────────────────────────────

function toObjects(cols, rows) {
  return rows.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

function normCurrency(raw) {
  if (!raw || raw === 'SUR' || raw === 'RUB') return 'SUR';
  if (raw === 'USD') return 'USD';
  if (raw === 'EUR') return 'EUR';
  return 'SUR';
}

const FETCH_TIMEOUT_MS = 12_000;
const ZOOM_STEP        = 1.2;   // коэффициент масштабирования для кнопок zoom (v=40)
// Отступы сетки — должны совпадать с grid в initChart()
const GRID_M = { left: 66, right: 22, top: 56, bottom: 50 };

async function fetchBoardPage(boardId, start, withCursor = false) {
  const sections = ['securities', 'marketdata'];
  if (withCursor) sections.push('securities.cursor');

  const url = `https://iss.moex.com/iss/engines/stock/markets/bonds/boards/${boardId}/securities.json`;
  const qs = new URLSearchParams({
    'iss.meta':           'off',
    'iss.only':           sections.join(','),
    'securities.columns': 'SECID,SHORTNAME,ISIN,MATDATE,FACEUNIT,COUPONPERCENT,OFFERDATE,BONDTYPE',
    'marketdata.columns': 'SECID,YIELD,DURATION,LAST',
    'start':              start,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}?${qs}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`MOEX ${boardId}: HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`MOEX ${boardId}: таймаут ${FETCH_TIMEOUT_MS / 1000}с`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseBoardBonds(secCols, mdCols, secRows, mdRows, bondType) {
  const secs = toObjects(secCols, secRows);
  const mds  = toObjects(mdCols, mdRows);
  const mdBySecid = new Map(mds.map(m => [m.SECID, m]));

  return secs.flatMap(s => {
    const md  = mdBySecid.get(s.SECID) || {};
    const ytm = md.YIELD    != null ? +md.YIELD    : null;
    const dur = md.DURATION != null ? +md.DURATION : null;

    // Только бумаги с реальными рыночными данными (YTM > 0, дюрация > 0)
    if (!ytm || ytm <= 0 || ytm > 150) return [];
    if (!dur || dur <= 0 || dur > 18250) return [];   // до 50 лет в днях

    const couponPct = s.COUPONPERCENT != null ? +s.COUPONPERCENT : null;
    // BONDTYPE — поле board endpoint, содержит точный тип от MOEX:
    // "Флоатер" → плавающая ставка (RUONIA, КС)
    // "Линкер/облигации с индексируемым..." → ОФЗ-ИН (CPI-linked, SU52xxx)
    // Для остальных используем эвристику по COUPONPERCENT и OFFERDATE
    let couponType = 'Фиксированный';
    if (s.BONDTYPE === 'Флоатер' || (s.BONDTYPE && s.BONDTYPE.startsWith('Линкер'))) {
      couponType = 'Флоатер';
    } else if (couponPct === 0) {
      couponType = 'Дисконтный';
    } else if (s.OFFERDATE) {
      couponType = 'Переменный';
    }

    return [{
      id:         s.SECID,
      isin:       s.ISIN   || s.SECID,   // ISIN для маппинга с CBonds; для корп. бумаг SECID = ISIN
      name:       s.SHORTNAME || s.SECID,
      type:       bondType,
      couponType,
      couponRate: couponPct,
      maturity:   s.MATDATE || null,
      currency:   normCurrency(s.FACEUNIT),
      ytm,
      duration:   dur / 365,   // дни → годы
      price:      md.LAST != null ? +md.LAST : null,
    }];
  });
}

async function fetchBoard(board) {
  const first   = await fetchBoardPage(board.id, 0, true);
  const secCols = first.securities.columns;
  const mdCols  = first.marketdata.columns;
  let secRows   = [...first.securities.data];
  let mdRows    = [...first.marketdata.data];

  const cursor   = first['securities.cursor']?.data?.[0];
  const total    = cursor ? cursor[1] : secRows.length;
  const pageSize = cursor ? cursor[2] : 100;

  if (total > pageSize) {
    const nPages = Math.ceil(total / pageSize);
    for (let batchStart = 1; batchStart < nPages; batchStart += 10) {
      const batchEnd = Math.min(batchStart + 10, nPages);
      const promises = [];
      for (let p = batchStart; p < batchEnd; p++) {
        promises.push(fetchBoardPage(board.id, p * pageSize));
      }
      const results = await Promise.all(promises);
      for (const d of results) {
        secRows = secRows.concat(d.securities.data);
        mdRows  = mdRows.concat(d.marketdata.data);
      }
    }
  }

  return parseBoardBonds(secCols, mdCols, secRows, mdRows, board.type);
}

async function fetchAllBonds() {
  setLoadingMsg(`Загрузка данных MOEX: ${BOARDS.map(b => b.id).join(', ')}…`);

  // Загружаем все площадки параллельно
  const results = await Promise.allSettled(BOARDS.map(b => fetchBoard(b)));

  const failed = [];
  const bonds = results.flatMap((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`Board ${BOARDS[i].id}:`, r.reason.message);
      failed.push(BOARDS[i].id);
      return [];
    }
    return r.value;
  });

  if (failed.length) {
    setLoadingMsg(`Не удалось загрузить: ${failed.join(', ')} (таймаут или ошибка MOEX)`);
    await new Promise(r => setTimeout(r, 2500));
  }

  // Дедупликация: одна бумага может присутствовать на нескольких площадках
  const seen = new Set();
  return bonds.filter(b => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
}

// ─── Ratings ─────────────────────────────────────────────────────────────────

async function fetchRatings() {
  try {
    const res = await fetch('ratings.json');
    if (!res.ok) return;
    const raw = await res.json();   // { SECID: "AA-", ... }
    for (const [secid, rating] of Object.entries(raw)) {
      ratingsMap[secid] = rating;   // сохраняем сырой рейтинг
    }
  } catch {
    // ratings.json отсутствует — все облигации получат «Нет рейтинга»
  }
}

// ─── Chart ───────────────────────────────────────────────────────────────────

// Официальная кривая бескупонной доходности (КБД) от MOEX ISS
// Модель Нельсона-Сигеля-Свенссона; yearyields — готовые значения на стандартных сроках
async function fetchZCYC() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      'https://iss.moex.com/iss/engines/stock/zcyc.json?iss.meta=off&iss.only=yearyields',
      { signal: ctrl.signal }
    );
    if (!res.ok) return;
    const json = await res.json();
    const rows = json?.yearyields?.data ?? [];
    // Строка: [tradedate, tradetime, period_years, yield_%]
    ofzCurveData = rows
      .map(r => [+r[2], +r[3]])
      .filter(([p, v]) => p > 0 && v > 0)
      .sort(([a], [b]) => a - b);
  } catch {
    ofzCurveData = [];
  }
}

// showCurve: false в режиме drill, чтобы не тянуть кривую за пределы выделения
// matchIds: Set<id> — подсветить эти облигации золотым, остальные притушить
function getBestRating(bond) {
  if (!bond.ratings?.length) return null;
  let bestIdx = Infinity, best = null;
  for (const r of bond.ratings) {
    const idx = RATING_ORDER.indexOf(r);
    if (idx !== -1 && idx < bestIdx) { bestIdx = idx; best = r; }
  }
  return best;
}

function getRatingColor(bond) {
  if (bond.type === 'ОФЗ') return PORTFOLIO_RATING_ZONES['AAA'];
  const r = getBestRating(bond);
  if (!r) return '#9e9e9e';
  return PORTFOLIO_RATING_ZONES[r] ?? '#ff8a80';
}

function buildSeries(bonds, showCurve = true, matchIds = null) {
  seriesData = {};
  const scatter = SEC_TYPES.map(type => {
    const group = bonds.filter(b => b.type === type);
    seriesData[type] = group;
    return {
      name:        type,
      type:        'scatter',
      data:        group.map(b => ({ value: [b.duration, b.ytm], bond: b, itemStyle: { color: getRatingColor(b) } })),
      symbolSize:  8,
      label: {
        show:      true,
        formatter: p => p.data.bond?.name || '',
        position:  'right',
        fontSize:  9,
        color:     '#4a5568',
      },
      labelLayout: { hideOverlap: true },
      itemStyle:   { opacity: 0.82 },
      emphasis:    {
        scale: true,
        itemStyle: { opacity: 1, borderWidth: 2, borderColor: '#fff' },
      },
    };
  });

  // Overlay-серия для подсветки найденных облигаций (не входит в легенду)
  if (matchIds && matchIds.size > 0) {
    const matched = bonds.filter(b => matchIds.has(b.id));
    scatter.push({
      name:        '__search__',
      type:        'scatter',
      data:        matched.map(b => ({ value: [b.duration, b.ytm], bond: b })),
      symbolSize:  11,
      z:           10,
      itemStyle:   { color: '#ff1744', borderColor: '#b71c1c', borderWidth: 1.5, opacity: 1 },
      label: {
        show:      true,
        formatter: p => p.data.bond?.name || '',
        position:  'right',
        fontSize:  9,
        color:     '#b71c1c',
        fontWeight: 'bold',
      },
      labelLayout: { hideOverlap: true },
      emphasis:    { scale: true, itemStyle: { opacity: 1 } },
    });
  }

  // Официальная КБД MOEX (загружается один раз при старте)
  const curve = showCurve ? ofzCurveData : [];
  const curveSeries = {
    name:      'Кривая ОФЗ',
    type:      'line',
    data:      curve,
    smooth:    true,
    symbol:    'none',
    z:         5,
    lineStyle: { color: 'rgba(40, 80, 160, 0.75)', width: 2.5 },
    tooltip: {
      formatter: p =>
        `<b>Кривая ОФЗ</b><br/>` +
        `<span style="color:#6b7a99">Дюрация:</span> ${p.value[0]} лет<br/>` +
        `<span style="color:#6b7a99">YTM:</span> ${Number(p.value[1]).toFixed(2)}%`,
    },
  };

  // Пустые серии только для отрисовки цветовой легенды рейтингов
  const legendSeries = RATING_LEGEND_ITEMS.map(([name, color]) => ({
    name,
    type:      'scatter',
    data:      [],
    symbol:    'circle',
    symbolSize: 10,
    itemStyle: { color },
  }));

  return [...scatter, curveSeries, ...legendSeries, ...buildPortfolioSeries()];
}

function initChart() {
  chart = echarts.init(document.getElementById('chart'), null, { renderer: 'canvas' });

  chart.setOption({
    backgroundColor: 'transparent',
    animation: false,

    tooltip: {
      trigger:    'item',
      enterable:  true,
      hideDelay:  300,
      backgroundColor: '#ffffff',
      borderColor: '#cdd5e4',
      padding: [8, 12],
      textStyle: { color: '#1a2138', fontSize: 12 },
      formatter(p) {
        if (!p.data?.bond) return '';
        if (p.data.portfolio) return portfolioTooltipHtml(p.data.bond, p.data.position, p.data.portfolio);
        const b = p.data.bond;
        const rate     = b.couponRate != null ? b.couponRate.toFixed(2) + '%' : '—';
        const priceStr = b.price      != null ? b.price.toFixed(2) + '%' : '—';
        const ratingStr = b.ratings?.length > 0 ? b.ratings.join(', ') : '—';
        return `<b style="font-size:13px">${escHtml(b.name)}</b><br/>
<span style="color:#6b7a99">Тикер:</span> ${b.id}<br/>
<span style="color:#6b7a99">Цена:</span> <b>${priceStr}</b><br/>
<span style="color:#6b7a99">YTM:</span> <b>${b.ytm.toFixed(2)}%</b><br/>
<span style="color:#6b7a99">Дюрация:</span> <b>${b.duration.toFixed(2)} лет</b><br/>
<span style="color:#6b7a99">Купон:</span> ${rate} — ${b.couponType}<br/>
<span style="color:#6b7a99">Погашение:</span> ${b.maturity || '—'}<br/>
<span style="color:#6b7a99">Рейтинг:</span> ${ratingStr}<br/>
<span style="color:#6b7a99">Тип:</span> ${b.type}`;
      },
    },

    legend: {
      data: [...RATING_LEGEND_ITEMS.map(([name]) => name), 'Кривая ОФЗ'],
      top: 8, left: 10,
      type: 'scroll',
      orient: 'horizontal',
      selectedMode: false,
      textStyle: { color: '#4a5568', fontSize: 11 },
      itemWidth: 10, itemHeight: 10,
      itemGap: 10,
      inactiveColor: '#c8d4e8',
    },

    toolbox: {
      feature: {
        brush: {
          type: ['rect', 'clear'],
          title: { rect: 'Выделить область', clear: 'Сбросить выделение' },
        },
        saveAsImage: { title: 'Сохранить как PNG', pixelRatio: 2 },
        dataZoom:    { title: { zoom: 'Масштаб', back: 'Сброс масштаба' } },
      },
      iconStyle:  { borderColor: '#8c9ab5' },
      emphasis:   { iconStyle: { borderColor: '#2b7de9' } },
      top: 6, right: 8,
    },

    brush: {
      xAxisIndex: 0,
      yAxisIndex: 0,
      seriesIndex: SEC_TYPES.map((_, i) => i),   // только scatter-серии, не кривую
      throttleDelay: 350,
      outOfBrush: { colorAlpha: 0.07 },
    },

    // Начальный вид — YTM 0-35%, дюрация 0-13 лет. Колесом мыши можно зумить.
    dataZoom: [
      { type: 'inside', yAxisIndex: 0, startValue: 0, endValue: 35, zoomLock: false },
      { type: 'inside', xAxisIndex: 0, startValue: 0, endValue: 13, zoomLock: false },
    ],

    grid: { left: 66, right: 22, top: 56, bottom: 50 },

    xAxis: {
      name: 'Дюрация, лет',
      nameLocation: 'middle',
      nameGap: 34,
      nameTextStyle: { color: '#6b7a99', fontSize: 12 },
      type: 'value',
      min: 0,
      axisLine:  { lineStyle: { color: '#cdd5e4' } },
      splitLine: { lineStyle: { color: '#e5eaf3', type: 'dashed' } },
      axisLabel: { color: '#6b7a99' },
      axisTick:  { lineStyle: { color: '#cdd5e4' } },
    },

    yAxis: {
      name: 'YTM, %',
      nameLocation: 'middle',
      nameGap: 50,
      nameTextStyle: { color: '#6b7a99', fontSize: 12 },
      type: 'value',
      min: 0,
      axisLine:  { lineStyle: { color: '#cdd5e4' } },
      splitLine: { lineStyle: { color: '#e5eaf3', type: 'dashed' } },
      axisLabel: { color: '#6b7a99', formatter: v => v + '%' },
      axisTick:  { lineStyle: { color: '#cdd5e4' } },
    },

    series: buildSeries([]),
  });

  // brushSelected накапливает бонды, но НЕ перерисовывает — ждём mouseup
  chart.on('brushSelected', params => {
    const selected = [];
    if (params.batch?.[0]?.selected) {
      for (const s of params.batch[0].selected) {
        if (s.seriesIndex >= SEC_TYPES.length) continue;
        const type  = SEC_TYPES[s.seriesIndex];
        const group = seriesData[type] || [];
        for (const idx of s.dataIndex) {
          if (group[idx]) selected.push(group[idx]);
        }
      }
    }
    pendingBrush = selected;

    // Если mouseup уже был (drillPending), а brushSelected пришёл чуть позже — сразу дриллим
    if (drillPending && selected.length > 0) {
      drillPending = false;
      const bonds = pendingBrush;
      pendingBrush = [];
      drillInto(bonds);
    }
  });

  // mouseup = пользователь завершил рисование прямоугольника
  document.getElementById('chart').addEventListener('mouseup', () => {
    if (pendingBrush.length > 0) {
      // brushSelected уже пришёл до mouseup — сразу дриллим
      const bonds = pendingBrush;
      pendingBrush = [];
      drillInto(bonds);
    } else {
      // brushSelected ещё не пришёл (дроссель 350ms) — ставим флаг ожидания
      drillPending = true;
      setTimeout(() => { drillPending = false; }, 600);
    }
  });

  window.addEventListener('resize', () => chart.resize());

  // Любой mousedown — мгновенно скрываем тултип через inline-стили и hideTip.
  // Срабатывает до 'click', поэтому тултип исчезает раньше, чем ECharts успевает его перепоказать.
  chart.getZr().on('mousedown', () => {
    chart.dispatchAction({ type: 'hideTip' });
    document.querySelectorAll('.echarts-tooltip').forEach(el => {
      el.style.transition = 'none';
      el.style.opacity    = '0';
      el.style.visibility = 'hidden';
    });
  });

  // Клик на точку — открываем карточку (тултип уже скрыт mousedown-ом)
  chart.on('click', params => {
    if (params.data?.bond) {
      const e = params.event?.event;
      showBondCard(params.data.bond, e?.clientX ?? 0, e?.clientY ?? 0);
    }
  });

  // Клик по пустому месту — скрываем карточку
  chart.getZr().on('click', params => {
    if (!params.target) hideBondCard();
  });

  // mouseup — восстанавливаем inline-стили тултипа в следующем кадре.
  // rAF гарантирует, что click уже выполнен и bond-card-open уже мог быть добавлен (bond click)
  // или убран (hideBondCard). Нужно для сценария drag-brush: там click не стреляет, а CSS остался.
  chart.getZr().on('mouseup', () => {
    requestAnimationFrame(() => {
      if (document.body.classList.contains('bond-card-open')) return;
      document.querySelectorAll('.echarts-tooltip').forEach(el => {
        el.style.transition = '';
        el.style.opacity    = '';
        el.style.visibility = '';
      });
    });
  });

  initAxisDrag();
}

// ─── Axis drag-to-zoom ────────────────────────────────────────────────────────
// Захват зоны оси мышью масштабирует эту ось:
// X-шкала: вправо = меньше масштаб (больше видно), влево = крупнее
// Y-шкала: вниз   = меньше масштаб (больше видно), вверх = крупнее

function initAxisDrag() {
  const chartDom = document.getElementById('chart');
  const G = { left: 66, right: 22, top: 56, bottom: 50 };

  let drag = null; // { axis, startX, startY, xSv, xEv, ySv, yEv }

  function axisZone(e) {
    const rect = chartDom.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const cw = rect.width, ch = rect.height;
    if (py >= ch - G.bottom && px >= G.left && px <= cw - G.right) return 'x';
    if (px <= G.left         && py >= G.top  && py <= ch - G.bottom) return 'y';
    return null;
  }

  function readRanges() {
    const rect = chartDom.getBoundingClientRect();
    const cw = rect.width, ch = rect.height;
    return {
      xSv: chart.convertFromPixel({ xAxisIndex: 0 }, G.left + 1),
      xEv: chart.convertFromPixel({ xAxisIndex: 0 }, cw - G.right - 1),
      ySv: chart.convertFromPixel({ yAxisIndex: 0 }, ch - G.bottom - 1),
      yEv: chart.convertFromPixel({ yAxisIndex: 0 }, G.top + 1),
    };
  }

  chartDom.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const zone = axisZone(e);
    if (!zone) return;
    drag = { axis: zone, startX: e.clientX, startY: e.clientY, ...readRanges() };
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!drag) return;
    let { xSv, xEv, ySv, yEv } = drag;

    if (drag.axis === 'x') {
      const dx      = e.clientX - drag.startX;
      const span    = xEv - xSv;
      const mid     = (xSv + xEv) / 2;
      const newSpan = Math.max(0.3, span * Math.pow(2, dx / 200));
      xSv = Math.max(0, mid - newSpan / 2);
      xEv = mid + newSpan / 2;
    } else {
      const dy      = e.clientY - drag.startY;
      const span    = yEv - ySv;
      const mid     = (ySv + yEv) / 2;
      const newSpan = Math.max(1, span * Math.pow(2, dy / 200));
      ySv = Math.max(0, mid - newSpan / 2);
      yEv = mid + newSpan / 2;
    }

    chart.setOption({
      dataZoom: [
        { type: 'inside', yAxisIndex: 0, startValue: ySv, endValue: yEv },
        { type: 'inside', xAxisIndex: 0, startValue: xSv, endValue: xEv },
      ],
    });
  });

  document.addEventListener('mouseup', () => { drag = null; });

  // Курсор меняется при наведении на зоны осей
  chartDom.addEventListener('mousemove', e => {
    if (drag) return;
    const zone = axisZone(e);
    chartDom.style.cursor = zone === 'x' ? 'ew-resize'
                          : zone === 'y' ? 'ns-resize'
                          : '';
  });
  chartDom.addEventListener('mouseleave', () => {
    if (!drag) chartDom.style.cursor = '';
  });
}

// Читает реальный текущий диапазон осей через convertFromPixel.
// Надёжнее getOption().dataZoom: работает после колеса мыши, brush, любых взаимодействий.
function getZoom() {
  const dom  = document.getElementById('chart');
  const rect = dom.getBoundingClientRect();
  return {
    x0: chart.convertFromPixel({ xAxisIndex: 0 }, GRID_M.left + 1),
    x1: chart.convertFromPixel({ xAxisIndex: 0 }, rect.width  - GRID_M.right  - 1),
    y0: chart.convertFromPixel({ yAxisIndex: 0 }, rect.height - GRID_M.bottom - 1),
    y1: chart.convertFromPixel({ yAxisIndex: 0 }, GRID_M.top + 1),
  };
}

function setZoom(x0, x1, y0, y1) {
  chart.setOption({
    dataZoom: [
      { type: 'inside', yAxisIndex: 0, startValue: Math.max(0, y0), endValue: y1 },
      { type: 'inside', xAxisIndex: 0, startValue: Math.max(0, x0), endValue: x1 },
    ]
  });
}

function currentZoomSnapshot() {
  return getZoom();   // {x0, x1, y0, y1}
}

// Перейти в выделение — сохраняет текущий уровень в стек
function drillInto(bonds) {
  drillStack.push({
    bonds: drillMode ? [...selectedBonds] : null,   // null = полная карта
    zoom:  currentZoomSnapshot(),
  });

  drillMode     = true;
  drillPending  = false;
  selectedBonds = bonds;

  chart.setOption({ series: buildSeries(bonds, false) }, REPLACE_SERIES);
  fitZoomToData(bonds);
  setTimeout(() => {
    chart.dispatchAction({ type: 'brush', areas: [] });
    exitBrushMode();
  }, 0);

  updateBackBtn();
  renderSelBar(bonds.length);
  renderTable(bonds);
}

// Вернуться на один уровень назад
function exitDrill() {
  if (drillStack.length === 0) return;
  const prev = drillStack.pop();

  if (prev.bonds === null) {
    // Возврат на полную карту
    drillMode     = false;
    selectedBonds = [];
    chart.setOption({ series: buildSeries(filteredBonds, true) }, REPLACE_SERIES);
    setZoom(prev.zoom.x0, prev.zoom.x1, prev.zoom.y0, prev.zoom.y1);
    renderSelBar(0);
    renderTable([]);
  } else {
    // Возврат к предыдущему выделению
    selectedBonds = prev.bonds;
    chart.setOption({ series: buildSeries(prev.bonds, false) }, REPLACE_SERIES);
    setZoom(prev.zoom.x0, prev.zoom.x1, prev.zoom.y0, prev.zoom.y1);
    renderSelBar(prev.bonds.length);
    renderTable(prev.bonds);
  }

  setTimeout(() => {
    chart.dispatchAction({ type: 'brush', areas: [] });
    exitBrushMode();
  }, 0);
  updateBackBtn();
}

function updateBackBtn() {
  const btn = document.getElementById('btn-clear');
  if (!btn) return;
  const isTopLevel = drillStack.length <= 1 && (drillStack[0]?.bonds === null || drillStack.length === 0);
  btn.textContent = isTopLevel ? '← Вернуться к полной карте' : '← Назад';
}

const REPLACE_SERIES = { replaceMerge: ['series'] };

function updateChart(bonds) {
  chart?.setOption({ series: buildSeries(bonds, true) }, REPLACE_SERIES);
}

// ─── Filters ─────────────────────────────────────────────────────────────────

function applyFilters() {
  filteredBonds = allBonds.filter(b => {
    const bondRatings = b.ratings?.length > 0 ? b.ratings : ['Нет рейтинга'];
    return filters.types.has(b.type) &&
      filters.couponTypes.has(b.couponType) &&
      filters.currencies.has(b.currency) &&
      bondRatings.some(r => filters.ratings.has(r));
  });

  if (portfolioFilterMode && visiblePortfolios.size > 0) {
    const pfIsins = new Set(
      portfolioData.portfolios
        .filter(p => visiblePortfolios.has(p.id))
        .flatMap(p => p.positions.map(pos => pos.isin))
    );
    filteredBonds = filteredBonds.filter(b => pfIsins.has(b.isin) || pfIsins.has(b.id));
  }

  if (drillMode) {
    // Пересекаем выделение с новым filteredBonds
    const filteredSet = new Set(filteredBonds.map(b => b.id));
    selectedBonds = selectedBonds.filter(b => filteredSet.has(b.id));
    drillStack = [];
    if (selectedBonds.length === 0) drillMode = false;
  }

  applySearch(); // единая точка рендеринга: учитывает поиск и drill

  const el = document.getElementById('stats-filtered');
  if (filteredBonds.length < allBonds.length) {
    el.textContent = `Показано: ${fmt(filteredBonds.length)}`;
    el.style.display = 'inline';
  } else {
    el.style.display = 'none';
  }
}

function clearBrush() {
  if (searchQuery.trim().length >= 2) { clearSearch(); return; }
  if (drillMode) exitDrill();
  else {
    chart?.dispatchAction({ type: 'brush', areas: [] });
    exitBrushMode();
  }
}

function updateDropdownLabel(id, set, all) {
  const btn = document.querySelector(`#${id} .filter-dropdown-btn .filter-count`);
  if (!btn) return;
  btn.textContent = set.size === all.length
    ? `Все (${all.length})`
    : `Выбрано: ${set.size} из ${all.length}`;
  const active = set.size < all.length;
  document.getElementById(id).querySelector('.filter-dropdown-btn').classList.toggle('filter-active', active);
}

// Добавляет кнопки «Все» и «Нет» в верхнюю часть панели фильтра
function addAllNoneButtons(containerId, filterSet, getAllValues) {
  const panel = document.querySelector(`#${containerId} .filter-dropdown-panel`);
  if (!panel || panel.querySelector('.filter-all-none')) return;

  const bar = document.createElement('div');
  bar.className = 'filter-all-none';

  const btnAll = document.createElement('button');
  btnAll.className = 'btn-flt-toggle';
  btnAll.textContent = 'Все';
  btnAll.addEventListener('click', e => {
    e.stopPropagation();
    const allVals = getAllValues();
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    allVals.forEach(v => filterSet.add(v));
    updateDropdownLabel(containerId, filterSet, allVals);
    applyFilters();
  });

  const btnNone = document.createElement('button');
  btnNone.className = 'btn-flt-toggle';
  btnNone.textContent = 'Нет';
  btnNone.addEventListener('click', e => {
    e.stopPropagation();
    const allVals = getAllValues();
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    filterSet.clear();
    updateDropdownLabel(containerId, filterSet, allVals);
    applyFilters();
  });

  bar.appendChild(btnAll);
  bar.appendChild(btnNone);
  panel.prepend(bar);
}

function initFilters() {
  // Механика выпадания — для всех дропдаунов (включая rating, который строится позже)
  document.querySelectorAll('.filter-dropdown').forEach(container => {
    container.querySelector('.filter-dropdown-btn').addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = container.classList.contains('open');
      document.querySelectorAll('.filter-dropdown.open').forEach(d => d.classList.remove('open'));
      if (!isOpen) container.classList.add('open');
    });
    container.querySelector('.filter-dropdown-panel').addEventListener('click', e => e.stopPropagation());
  });

  // Закрываем все при клике вне
  document.addEventListener('click', () => {
    document.querySelectorAll('.filter-dropdown.open').forEach(d => d.classList.remove('open'));
  });

  // Обработчики галочек для статичных фильтров
  const groups = {
    'filter-type':     { set: filters.types,       all: SEC_TYPES },
    'filter-coupon':   { set: filters.couponTypes,  all: COUPON_TYPES },
    'filter-currency': { set: filters.currencies,   all: CURRENCIES },
  };

  for (const [id, { set, all }] of Object.entries(groups)) {
    const container = document.getElementById(id);
    container.addEventListener('change', e => {
      const cb = e.target;
      if (!cb.matches('input[type="checkbox"]')) return;
      const val = cb.value;
      if (cb.checked) {
        set.add(val);
      } else {
        set.delete(val);
      }
      updateDropdownLabel(id, set, all);
      applyFilters();
    });
    addAllNoneButtons(id, set, () => all);
  }
}

// Строим фильтр рейтингов динамически после загрузки данных
function buildRatingFilter() {
  const uniqueRatings = [...new Set(
    allBonds.flatMap(b => b.ratings?.length > 0 ? b.ratings : ['Нет рейтинга'])
  )].sort((a, b) => {
    const ia = RATING_ORDER.indexOf(a);
    const ib = RATING_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, 'ru');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  filters.ratings = new Set(uniqueRatings);

  const panel = document.querySelector('#filter-rating .filter-dropdown-panel');
  panel.innerHTML = uniqueRatings.map(r =>
    `<label class="filter-option"><input type="checkbox" checked value="${escHtml(r)}">${escHtml(r)}</label>`
  ).join('');

  updateDropdownLabel('filter-rating', filters.ratings, uniqueRatings);

  document.getElementById('filter-rating').addEventListener('change', e => {
    const cb = e.target;
    if (!cb.matches('input[type="checkbox"]')) return;
    const val = cb.value;
    if (cb.checked) {
      filters.ratings.add(val);
    } else {
      filters.ratings.delete(val);
    }
    updateDropdownLabel('filter-rating', filters.ratings, uniqueRatings);
    applyFilters();
  });

  // Кнопки «Все» / «Нет» для фильтра рейтингов (добавляем/пересоздаём при каждом перестроении)
  const ratingPanel = document.querySelector('#filter-rating .filter-dropdown-panel');
  const oldBar = ratingPanel.querySelector('.filter-all-none');
  if (oldBar) oldBar.remove();
  addAllNoneButtons('filter-rating', filters.ratings, () => uniqueRatings);
}

// ─── Table ───────────────────────────────────────────────────────────────────

function renderTable(bonds) {
  const wrap = document.getElementById('tbl-wrap');
  if (!bonds.length) { wrap.style.display = 'none'; return; }

  const sorted = [...bonds].sort((a, b) => {
    let va = a[tableSort.col] ?? (tableSort.dir === 'asc' ? Infinity : -Infinity);
    let vb = b[tableSort.col] ?? (tableSort.dir === 'asc' ? Infinity : -Infinity);
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    return tableSort.dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  document.getElementById('tbl-body').innerHTML = sorted.map(b => `
    <tr>
      <td><a href="https://www.moex.com/ru/issue.aspx?code=${b.id}" target="_blank">${b.id}</a></td>
      <td>${escHtml(b.name)}</td>
      <td style="color:${TYPE_COLOR[b.type]};font-weight:500">${b.type}</td>
      <td class="r">${b.ytm.toFixed(2)}</td>
      <td class="r">${b.duration.toFixed(2)}</td>
      <td class="r">${b.couponRate != null ? b.couponRate.toFixed(2) : '—'}</td>
      <td>${b.couponType}</td>
      <td>${b.ratings?.length > 0 ? b.ratings.join(', ') : '—'}</td>
      <td>${b.maturity || '—'}</td>
      <td>${b.currency === 'SUR' ? '₽' : b.currency}</td>
    </tr>`).join('');

  wrap.style.display = 'block';
}

function initTable() {
  document.querySelectorAll('.bonds-tbl th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      tableSort = tableSort.col === col
        ? { col, dir: tableSort.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'desc' };
      document.querySelectorAll('.bonds-tbl th').forEach(h => h.classList.remove('asc', 'desc'));
      th.classList.add(tableSort.dir);
      renderTable(selectedBonds);
    });
  });
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

function downloadCsv(bonds) {
  const header = ['Тикер','Название','Тип','YTM %','Дюрация лет','Купон %','Тип купона','Рейтинг','Погашение','Валюта'].join(',');
  const rows = bonds.map(b => [
    b.id,
    `"${String(b.name || '').replace(/"/g, '""')}"`,
    b.type,
    b.ytm.toFixed(2),
    b.duration.toFixed(2),
    b.couponRate != null ? b.couponRate.toFixed(2) : '',
    b.couponType,
    b.rating !== 'Нет рейтинга' ? b.rating : '',
    b.maturity || '',
    b.currency,
  ].join(','));

  const blob = new Blob(['﻿' + [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bonds-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Bond card (пин-карточка по клику) ───────────────────────────────────────

function showBondCard(b, clientX = 0, clientY = 0) {
  const rate      = b.couponRate != null ? b.couponRate.toFixed(2) + '%' : '—';
  const priceStr  = b.price      != null ? b.price.toFixed(2) + '%' : '—';
  const ratingStr = b.ratings?.length > 0 ? b.ratings.join(', ') : '—';
  const moexUrl   = `https://www.moex.com/ru/issue.aspx?code=${b.id}`;

  document.getElementById('bond-card-body').innerHTML =
    `<b>${escHtml(b.name)}</b>` +
    `<span class="lbl">Тикер:</span> <a href="${moexUrl}" target="_blank">${b.id}</a><br/>` +
    `<span class="lbl">Цена:</span> <b>${priceStr}</b><br/>` +
    `<span class="lbl">YTM:</span> <b>${b.ytm.toFixed(2)}%</b><br/>` +
    `<span class="lbl">Дюрация:</span> ${b.duration.toFixed(2)} лет<br/>` +
    `<span class="lbl">Купон:</span> ${rate} — ${b.couponType}<br/>` +
    `<span class="lbl">Погашение:</span> ${b.maturity || '—'}<br/>` +
    `<span class="lbl">Рейтинг:</span> ${ratingStr}<br/>` +
    `<span class="lbl">Тип:</span> ${b.type}`;

  // Позиционируем рядом с курсором (как замёрзший тултип)
  const card   = document.getElementById('bond-card');
  const GAP    = 14;
  const CARD_W = 310;
  const CARD_H = 185;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = clientX + GAP;
  let top  = clientY + GAP;
  if (left + CARD_W > vw - 8) left = clientX - CARD_W - GAP;
  if (top  + CARD_H > vh - 8) top  = clientY - CARD_H - GAP;
  left = Math.max(8, left);
  top  = Math.max(8, top);

  card.style.left    = left + 'px';
  card.style.top     = top  + 'px';
  card.style.display = 'block';
  document.body.classList.add('bond-card-open');
  document.querySelectorAll('.echarts-tooltip').forEach(el => {
    el.style.cssText += ';transition:none!important;opacity:0!important;visibility:hidden!important';
  });
  chart.dispatchAction({ type: 'hideTip' });
  chart.setOption({ tooltip: { trigger: 'none' } });
}

function hideBondCard() {
  document.body.classList.remove('bond-card-open');
  document.querySelectorAll('.echarts-tooltip').forEach(el => {
    el.style.transition = '';
    el.style.opacity    = '';
    el.style.visibility = '';
  });
  chart.setOption({ tooltip: { trigger: 'item' } });
  document.getElementById('bond-card').style.display = 'none';
}

function exitBrushMode() {
  chart.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: false } });
}

// Подстраивает вид под данные с перцентильной обрезкой выбросов (1%–98%).
// Используется при начальной загрузке, drill-down и сбросе масштаба.
function fitZoomToData(bonds) {
  if (!bonds.length) return;
  const ytms = bonds.map(b => b.ytm).sort((a, b) => a - b);
  const durs = bonds.map(b => b.duration).sort((a, b) => a - b);
  const pct  = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const y0 = Math.max(0, pct(ytms, 0.01)), y1 = pct(ytms, 0.98);
  const x0 = Math.max(0, pct(durs, 0.01)), x1 = pct(durs, 0.98);
  setZoom(
    x0 - Math.max((x1 - x0) * 0.06, 0.1),
    x1 + Math.max((x1 - x0) * 0.06, 0.1),
    y0 - Math.max((y1 - y0) * 0.06, 1),
    y1 + Math.max((y1 - y0) * 0.06, 1)
  );
}

function resetZoom() {
  exitBrushMode();
  const bonds = drillMode && selectedBonds.length > 0 ? selectedBonds
              : filteredBonds.length > 0 ? filteredBonds : allBonds;
  fitZoomToData(bonds);
}

// xFactor/yFactor > 1 — расширить диапазон оси (zoom out), < 1 — сузить (zoom in).
// Читает реальный диапазон через getZoom(), а не getOption() — работает корректно всегда.
function adjustZoom(xFactor, yFactor) {
  const { x0, x1, y0, y1 } = getZoom();
  const xMid = (x0 + x1) / 2, xSpan = (x1 - x0) * xFactor;
  const yMid = (y0 + y1) / 2, ySpan = (y1 - y0) * yFactor;
  setZoom(xMid - xSpan / 2, xMid + xSpan / 2, yMid - ySpan / 2, yMid + ySpan / 2);
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function setLoadingMsg(msg) {
  const el = document.getElementById('loading-msg');
  if (el) el.textContent = msg;
}

function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.style.display = 'none';
}

function renderSelBar(count, label = 'Выделено') {
  const bar = document.getElementById('sel-bar');
  const cnt = document.getElementById('sel-count');
  const btn = document.getElementById('btn-clear');
  if (count > 0) {
    cnt.textContent = `${label}: ${count} облигаций`;
    if (btn) btn.textContent = label === 'Найдено' ? '✕ Очистить поиск' : '← Вернуться к полной карте';
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

// ─── Search ──────────────────────────────────────────────────────────────────

function matchesSearch(b, q) {
  return b.id.toLowerCase().includes(q) ||
    b.name.toLowerCase().includes(q) ||
    (b.isin && b.isin.toLowerCase().includes(q)) ||
    issuerKey(b.name).toLowerCase().includes(q);
}

function applySearch() {
  const q = searchQuery.trim().toLowerCase();
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = searchQuery.trim() ? '' : 'none';

  if (q.length < 2) {
    // Нет активного поиска — восстанавливаем drill-вид или полную карту
    if (drillMode) {
      chart?.setOption({ series: buildSeries(selectedBonds, false) }, REPLACE_SERIES);
      renderSelBar(selectedBonds.length);
      renderTable(selectedBonds);
    } else {
      updateChart(filteredBonds);
      renderSelBar(0);
      renderTable([]);
    }
    return;
  }

  const matches = filteredBonds.filter(b => matchesSearch(b, q));

  if (searchMode === 'only') {
    chart?.setOption({ series: buildSeries(matches, true) }, REPLACE_SERIES);
  } else {
    const matchIds = new Set(matches.map(b => b.id));
    chart?.setOption({ series: buildSeries(filteredBonds, true, matchIds) }, REPLACE_SERIES);
  }
  renderSelBar(matches.length, 'Найдено');
  renderTable(matches);
}

function clearSearch() {
  searchQuery = '';
  const inp = document.getElementById('search-input');
  if (inp) inp.value = '';
  applySearch();
}

function fmt(n) { return n.toLocaleString('ru-RU'); }

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Извлекает ключ эмитента из краткого названия бумаги — отрезает серийные суффиксы.
// "ДОМ.РФ25об" → "ДОМ.РФ",  "Сбербанк Р-001Р-176" → "Сбербанк",  "ФСК РС-23" → "ФСК"
function issuerKey(name) {
  if (!name) return '';
  return name
    .replace(/\s+\S*\d\S*$/u, '')                            // "Р-001Р-176", "1Р-41", "БО-001", "РС-23"
    .replace(/\s*[-–]?\s*\d+\s+обл$/u, '')                   // "РЖД-33 обл", "РЖД 36 обл" — старый формат
    .replace(/[-–]\d+$/u, '')                                // "-23"
    .replace(/(?<=[а-яёa-z0-9])[А-ЯЁ]{1,3}\d+\S*$/u, '')  // "Б19", "БО3" — маркер серии после строчной буквы
    .replace(/\d+\S*$/u, '')                                 // "25об", "001Р-1"
    .replace(/-+\s*$/, '')                                   // хвостовой дефис
    .trim();
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

function portfolioNextColor() {
  const used = new Set(portfolioData.portfolios.map(p => p.color));
  return PORTFOLIO_COLORS.find(c => !used.has(c)) ?? PORTFOLIO_COLORS[portfolioData.portfolios.length % PORTFOLIO_COLORS.length];
}

function resolvePortfolioPositions(portfolio) {
  return portfolio.positions.flatMap(pos => {
    const bond = allBonds.find(b => b.isin === pos.isin || b.id === pos.isin);
    if (!bond) return [];
    return [{ bond, position: pos, portfolio }];
  });
}

function buildPortfolioSeries() {
  return portfolioData.portfolios
    .filter(p => visiblePortfolios.has(p.id))
    .map(portfolio => ({
      name:       '★ ' + portfolio.name,
      type:       'scatter',
      data:       resolvePortfolioPositions(portfolio).map(({ bond, position, portfolio: pf }) => ({
        value: [bond.duration, bond.ytm],
        bond, position, portfolio: pf,
        itemStyle: { color: getRatingColor(bond) },
      })),
      symbol:     'diamond',
      symbolSize: 18,
      z:          20,
      itemStyle:  {},
      emphasis:   { scale: true, itemStyle: { opacity: 1 } },
      label: {
        show:      true,
        formatter: p => p.data.bond?.name || '',
        position:  'right',
        fontSize:  9,
        fontWeight:'bold',
        color:     portfolio.color,
      },
      labelLayout: { hideOverlap: true },
    }));
}

function portfolioTooltipHtml(bond, position, portfolio) {
  const hasBuyPrice = position.buyPrice != null && position.buyPrice > 0;
  const pnl = hasBuyPrice && bond.price != null
    ? (bond.price - position.buyPrice) / position.buyPrice * 100
    : null;
  const pnlStr      = pnl != null
    ? `<b style="color:${pnl >= 0 ? '#22a05a' : '#e53935'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</b>`
    : '—';
  const buyPriceStr = hasBuyPrice ? position.buyPrice.toFixed(2) + '%' : '—';
  const priceStr    = bond.price != null ? bond.price.toFixed(2) + '%' : '—';
  const ratingStr   = bond.ratings?.length > 0 ? bond.ratings.join(', ') : '—';
  return `<b style="font-size:13px">${escHtml(bond.name)}</b>
<span style="color:${portfolio.color}">◆ ${escHtml(portfolio.name)}</span><br/>
<span style="color:#6b7a99">Куплено:</span> <b>${buyPriceStr}</b>
&nbsp;&nbsp;<span style="color:#6b7a99">Текущая:</span> <b>${priceStr}</b><br/>
<span style="color:#6b7a99">P&L:</span> ${pnlStr}
&nbsp;&nbsp;<span style="color:#6b7a99">Кол-во:</span> ${position.qty} шт.<br/>
<span style="color:#6b7a99">YTM:</span> ${bond.ytm.toFixed(2)}%
&nbsp;&nbsp;<span style="color:#6b7a99">Дюрация:</span> ${bond.duration.toFixed(2)} лет<br/>
<span style="color:#6b7a99">Рейтинг:</span> ${ratingStr}`;
}

function renderPortfolioPanel() {
  const list = document.getElementById('pf-list');
  if (!portfolioData.portfolios.length) {
    list.innerHTML = '<span class="pf-empty">Нет портфелей — нажмите «+ Позиция»</span>';
    return;
  }
  list.innerHTML = portfolioData.portfolios.map(p => `
    <label class="pf-item">
      <input type="checkbox" class="pf-checkbox" data-id="${p.id}" ${visiblePortfolios.has(p.id) ? 'checked' : ''}>
      <span class="pf-dot" style="background:${p.color}"></span>
      <span class="pf-name">${escHtml(p.name)}</span>
      <span class="pf-count">${p.positions.length} поз.</span>
    </label>`).join('');
  list.querySelectorAll('.pf-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) visiblePortfolios.add(cb.dataset.id);
      else visiblePortfolios.delete(cb.dataset.id);
      if (chart) portfolioFilterMode ? applyFilters() : applySearch();
    });
  });
}

function openAddPositionForm() {
  const sel = document.getElementById('pf-sel-portfolio');
  sel.innerHTML = portfolioData.portfolios.map(p =>
    `<option value="${p.id}">${escHtml(p.name)}</option>`
  ).join('') + '<option value="__new__">+ Новый портфель…</option>';
  const hasPortfolios = portfolioData.portfolios.length > 0;
  if (!hasPortfolios) sel.value = '__new__';
  document.getElementById('pf-new-name-row').style.display = sel.value === '__new__' ? '' : 'none';
  document.getElementById('pf-isin').value  = '';
  document.getElementById('pf-qty').value   = '';
  document.getElementById('pf-price').value = '';
  document.getElementById('pf-new-name').value = '';
  document.getElementById('pf-form-overlay').style.display = 'flex';
  document.getElementById('pf-isin').focus();
}

function closeAddPositionForm() {
  document.getElementById('pf-form-overlay').style.display = 'none';
}

function submitAddPosition() {
  const sel      = document.getElementById('pf-sel-portfolio');
  const isin     = document.getElementById('pf-isin').value.trim().toUpperCase();
  const qty      = parseInt(document.getElementById('pf-qty').value, 10);
  const buyPrice = parseFloat(document.getElementById('pf-price').value.replace(',', '.'));

  if (!isin)                        { alert('Введите ISIN или тикер'); return; }
  if (!qty || qty <= 0)             { alert('Введите корректное количество'); return; }
  if (isNaN(buyPrice) || buyPrice <= 0) { alert('Введите корректную цену покупки'); return; }

  let portfolioId = sel.value;
  if (portfolioId === '__new__') {
    const name = document.getElementById('pf-new-name').value.trim()
      || `Портфель ${portfolioData.portfolios.length + 1}`;
    const p = { id: 'p' + Date.now(), name, color: portfolioNextColor(), positions: [] };
    portfolioData.portfolios.push(p);
    portfolioId = p.id;
    visiblePortfolios.add(portfolioId);
  }

  const portfolio = portfolioData.portfolios.find(p => p.id === portfolioId);
  portfolio.positions.push({ isin, qty, buyPrice });

  renderPortfolioPanel();
  if (chart) applySearch();
  closeAddPositionForm();
  savePortfolioToServer();
}

async function loadPortfolioFromFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data.portfolios)) throw new Error('Неверный формат файла');
    portfolioData     = data;
    visiblePortfolios = new Set(portfolioData.portfolios.map(p => p.id));
    renderPortfolioPanel();
    if (chart) applySearch();
    savePortfolioToServer();
  } catch (e) {
    alert('Ошибка загрузки: ' + e.message);
  }
}

const LS_KEY = 'moex_bond_map_portfolio';

async function loadPortfolioFromServer() {
  try {
    const res = await fetch('portfolio.json?' + Date.now());
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.portfolios)) {
        portfolioData     = data;
        visiblePortfolios = new Set(portfolioData.portfolios.map(p => p.id));
        return;
      }
    }
  } catch { /* сервер недоступен — пробуем localStorage */ }

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.portfolios)) {
        portfolioData     = data;
        visiblePortfolios = new Set(portfolioData.portfolios.map(p => p.id));
      }
    }
  } catch { /* localStorage пуст или повреждён */ }
}

async function savePortfolioToServer() {
  const json = JSON.stringify(portfolioData);
  try {
    const res = await fetch('/api/save-portfolio', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    json,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showSaveStatus('✓ Сохранено');
    return;
  } catch { /* сервер недоступен — сохраняем локально */ }

  try {
    localStorage.setItem(LS_KEY, json);
    showSaveStatus('✓ Сохранено локально');
  } catch (e) {
    showSaveStatus('Ошибка сохранения', true);
    console.error('save-portfolio:', e);
  }
}

function showSaveStatus(msg, isError = false) {
  const el = document.getElementById('pf-save-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#e53935' : '#22a05a';
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

function openExcelImportDialog(rows, filename) {
  pendingExcelRows = rows;
  document.getElementById('pf-excel-info').textContent =
    `${filename}  ·  ${rows.length - 1} позиций`;

  const sel = document.getElementById('pf-excel-portfolio');
  sel.innerHTML = portfolioData.portfolios.map(p =>
    `<option value="${p.id}">${escHtml(p.name)}</option>`
  ).join('') + '<option value="__new__">+ Новый портфель…</option>';
  sel.value = '__new__';

  document.getElementById('pf-excel-name').value = filename.replace(/\.xlsx?$/i, '');
  document.getElementById('pf-excel-name-row').style.display = '';
  document.getElementById('pf-excel-overlay').style.display  = 'flex';
}

function closeExcelImportDialog() {
  pendingExcelRows = null;
  document.getElementById('pf-excel-overlay').style.display = 'none';
}

function submitExcelImport() {
  const rows = pendingExcelRows;
  if (!rows) return;

  const sel = document.getElementById('pf-excel-portfolio');
  let portfolioId = sel.value;

  if (portfolioId === '__new__') {
    const name = document.getElementById('pf-excel-name').value.trim()
      || `Портфель ${portfolioData.portfolios.length + 1}`;
    const p = { id: 'p' + Date.now(), name, color: portfolioNextColor(), positions: [] };
    portfolioData.portfolios.push(p);
    portfolioId = p.id;
    visiblePortfolios.add(portfolioId);
  }

  const portfolio = portfolioData.portfolios.find(p => p.id === portfolioId);
  const headers   = rows[0].map(h => String(h ?? '').trim());
  const isinIdx   = headers.findIndex(h => h === 'ISIN');
  const qtyIdx    = headers.findIndex(h => h.includes('Кол-во'));
  const priceIdx  = headers.findIndex(h => h.includes('цена позиции'));

  if (isinIdx < 0 || qtyIdx < 0) {
    alert('Не найдены столбцы ISIN или «Кол-во бумаг». Проверьте формат файла.');
    return;
  }

  let imported = 0;
  for (let i = 1; i < rows.length; i++) {
    const row  = rows[i];
    const isin = String(row[isinIdx] ?? '').trim().toUpperCase();
    const qty  = parseInt(row[qtyIdx], 10);
    if (!isin || !qty || qty <= 0) continue;

    const rawPrice = priceIdx >= 0 ? parseFloat(row[priceIdx]) : NaN;
    const pos = { isin, qty };
    if (!isNaN(rawPrice) && rawPrice > 0) pos.buyPrice = rawPrice;

    const idx = portfolio.positions.findIndex(p => p.isin === isin);
    if (idx >= 0) portfolio.positions[idx] = pos;
    else          portfolio.positions.push(pos);
    imported++;
  }

  closeExcelImportDialog();
  renderPortfolioPanel();
  if (chart) applySearch();
  savePortfolioToServer();
  showSaveStatus(`Импортировано: ${imported} позиций`);
}

function initPortfolio() {
  document.getElementById('btn-pf-add-pos').addEventListener('click', openAddPositionForm);

  document.getElementById('btn-pf-load').addEventListener('click', () =>
    document.getElementById('pf-file-input').click());
  document.getElementById('pf-file-input').addEventListener('change', e => {
    if (e.target.files[0]) loadPortfolioFromFile(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('btn-pf-save').addEventListener('click', savePortfolioToServer);

  document.getElementById('btn-pf-filter').addEventListener('click', () => {
    portfolioFilterMode = !portfolioFilterMode;
    document.getElementById('btn-pf-filter').classList.toggle('btn-active', portfolioFilterMode);
    if (chart) applyFilters();
  });

  document.getElementById('btn-pf-excel').addEventListener('click', () =>
    document.getElementById('pf-excel-input').click());
  document.getElementById('pf-excel-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = ev => {
      const wb   = XLSX.read(ev.target.result, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      if (rows.length < 2) { alert('Файл пуст или не содержит строк данных.'); return; }
      openExcelImportDialog(rows, file.name);
    };
    reader.readAsArrayBuffer(file);
  });
  document.getElementById('pf-excel-cancel').addEventListener('click', closeExcelImportDialog);
  document.getElementById('pf-excel-submit').addEventListener('click', submitExcelImport);
  document.getElementById('pf-excel-portfolio').addEventListener('change', e => {
    document.getElementById('pf-excel-name-row').style.display =
      e.target.value === '__new__' ? '' : 'none';
  });
  document.getElementById('pf-excel-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeExcelImportDialog();
  });

  document.getElementById('pf-cancel').addEventListener('click', closeAddPositionForm);
  document.getElementById('pf-submit').addEventListener('click', submitAddPosition);
  document.getElementById('pf-sel-portfolio').addEventListener('change', e => {
    document.getElementById('pf-new-name-row').style.display =
      e.target.value === '__new__' ? '' : 'none';
  });
  document.getElementById('pf-form-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAddPositionForm();
  });
  document.getElementById('pf-submit').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitAddPosition();
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  initChart();
  initFilters();
  initTable();
  initPortfolio();

  document.getElementById('btn-clear').addEventListener('click', clearBrush);
  document.getElementById('btn-csv').addEventListener('click', () => downloadCsv(selectedBonds));
  document.getElementById('bond-card-close').addEventListener('click', hideBondCard);
  document.getElementById('btn-reset-zoom').addEventListener('click', resetZoom);

  const Z = ZOOM_STEP;
  document.getElementById('zc-in').addEventListener('click',    () => adjustZoom(1/Z, 1/Z));
  document.getElementById('zc-out').addEventListener('click',   () => adjustZoom(Z,   Z  ));
  document.getElementById('zc-reset').addEventListener('click', () => resetZoom());
  document.getElementById('zc-yp').addEventListener('click',    () => adjustZoom(1,   Z  ));
  document.getElementById('zc-ym').addEventListener('click',    () => adjustZoom(1,   1/Z));
  document.getElementById('zc-xp').addEventListener('click',    () => adjustZoom(Z,   1  ));
  document.getElementById('zc-xm').addEventListener('click',    () => adjustZoom(1/Z, 1  ));

  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', e => {
    searchQuery = e.target.value;
    applySearch();
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') clearSearch();
  });
  document.getElementById('search-clear').addEventListener('click', clearSearch);
  document.querySelectorAll('input[name="search-mode"]').forEach(radio => {
    radio.addEventListener('change', e => {
      searchMode = e.target.value;
      applySearch();
    });
  });

  try {
    // Загружаем рейтинги, данные MOEX и КБД параллельно
    [allBonds] = await Promise.all([fetchAllBonds(), fetchRatings(), fetchZCYC(), loadPortfolioFromServer()]);

    // Первый проход: нормализуем все рейтинги по ISIN / SECID в массив
    allBonds.forEach(b => {
      const raw = ratingsMap[b.isin] ?? ratingsMap[b.id] ?? null;
      b.ratings = normalizeRatings(raw);
    });

    // Второй проход: если рейтинг не найден — берём от другой бумаги того же эмитента
    const byIssuer = new Map();
    allBonds.forEach(b => {
      if (b.ratings.length > 0) {
        const k = issuerKey(b.name);
        if (k && !byIssuer.has(k)) byIssuer.set(k, b.ratings);
      }
    });
    allBonds.forEach(b => {
      if (b.ratings.length === 0) {
        b.ratings = byIssuer.get(issuerKey(b.name)) ?? [];
      }
    });

    // Строим фильтр рейтингов из реальных данных
    buildRatingFilter();

    const ts = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    document.getElementById('update-time').textContent = `Обновлено: ${ts}`;
    document.getElementById('stats-total').textContent = `Облигаций с данными: ${fmt(allBonds.length)}`;

    hideLoading();
    applyFilters();
    fitZoomToData(filteredBonds);
    renderPortfolioPanel();
  } catch (err) {
    console.error(err);
    setLoadingMsg(
      `Ошибка: ${err.message}. ` +
      'Проверьте интернет. Если открываете как file://, ' +
      'запустите локальный сервер: python -m http.server 8000'
    );
  }
}

document.addEventListener('DOMContentLoaded', init);
