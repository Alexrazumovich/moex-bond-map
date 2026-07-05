# Карта рынка облигаций — описание проекта

## Что делает

Браузерное SPA (no build) — интерактивная scatter-диаграмма YTM vs Дюрация для всех ликвидных облигаций Московской биржи. Цвет точки = рейтинг (4-зонная палитра: зелёный AA+, жёлтый A, синий BBB, красный BB и ниже). Есть фильтры, drill-down, таблица, карточка облигации, портфели.

## Стек

- Чистый JS + [ECharts 5.5](https://echarts.apache.org/)
- [SheetJS xlsx-0.20.3](https://sheetjs.com/) (CDN) — парсинг Excel-портфелей в браузере
- Данные: MOEX ISS REST API (без ключа, публичный)
- Рейтинги: локальный `ratings.json` (обновляется скриптом с corpbonds.ru)
- Кэш-бастинг: `?v=N` в URL скриптов/стилей (текущая версия: **v=54**)
- Сервер: `python server.py`, порт **8001** — статика + POST `/api/save-portfolio`

## Файлы

| Файл | Назначение |
|---|---|
| `index.html` | Разметка: шапка, фильтры, портфельная панель, контейнер графика, zoom-controls, bond-card, таблица |
| `app.js` | Вся логика: загрузка MOEX, рейтинги, фильтры, ECharts, тултип, zoom, портфели |
| `style.css` | Стили |
| `server.py` | Python HTTP-сервер: статика + POST /api/save-portfolio → portfolio.json |
| `portfolio.json` | Хранилище портфелей (создаётся автоматически при первом сохранении) |
| `ratings.json` | Рейтинги ISIN → строка (обновляется через `fetch_ratings_corpbonds.ps1`) |
| `files/bcs500.xlsx` | Пример экспорта из corpbonds.ru (формат для импорта) |

## Источники данных

### Котировки (MOEX ISS)

Загружаются при открытии страницы через `fetch`. Торговые площадки:

| Board | Тип |
|---|---|
| TQOB | ОФЗ |
| TQMU | Муниципальные |
| TQCB | Корпоративные (руб.) |
| TQOD | Корпоративные (USD/EUR) |

Поля: SECID, SHORTNAME, ISIN, MATDATE, FACEUNIT, COUPONPERCENT, OFFERDATE, BONDTYPE, YIELD, DURATION, LAST.

Тип купона определяется по полю **BONDTYPE** из board-endpoint (доступно, но не очевидно — не попадает в default columns):
- `BONDTYPE = "Флоатер"` → Флоатер (RUONIA, КС — для ОФЗ-ПК и корпоративных)
- `BONDTYPE` начинается с `"Линкер"` → Флоатер (ОФЗ-ИН, SU52xxx, CPI-linked)
- Иначе (BONDTYPE = null или "Фикс..."): COUPONPERCENT = 0 → Дисконтный; OFFERDATE → Переменный; иначе → Фиксированный

### Рейтинги — пайплайн

**Основной источник (актуальный):**
```
POST https://corpbonds.ru/screener/bonds (без авторизации)
        ↓
fetch_ratings_corpbonds.ps1   (забирает рейтинги от всех 4 агентств → пишет ratings.json)
        ↓
ratings.json                  (единственный источник для фронтенда)
        ↓
app.js: ratingsMap[ISIN]      (при загрузке облигаций с MOEX)
```

Запускать `fetch_ratings_corpbonds.ps1` раз в неделю. Возвращает ~2700 записей по корп. и муниципальным облигациям. Ключ — ISIN. Рейтинги от нескольких агентств хранятся через `"; "`: `"A(RU); ruA"`.

**Устаревший пайплайн (оставлен, не используется как основной):**
- `photo-ratings/*.jpg` — скриншоты из Telegram
- `update_ratings_photos.ps1` — OCR-парсинг jpg → данные для Excel
- `photo-ratings/export.xlsx` — промежуточный Excel
- `build_ratings.ps1` — сборный скрипт (фото + excel → ratings.json)
- `fetch_ratings_cbonds.ps1` — экспериментальный

**Нормализация рейтинга** (`normalizeRatingStr` в app.js):
- `"AA+(RU)"` → `"AA+"` (АКРА)
- `"RUAA+"` → `"AA+"` (Эксперт РА)
- `"AA+.RU"` → `"AA+"` (НКР)
- `"BB-|RU|"` → `"BB-"` (НРА — добавлено в v37)

`normalizeRatings(raw)` разбивает строку по `; ` или `,`, нормализует каждый элемент, дедуплицирует. Хранится в `b.ratings: string[]`.

Если у облигации нет прямого рейтинга — берётся рейтинг другой бумаги того же эмитента (`issuerKey` → `byIssuer` map).

## Архитектура app.js

```
fetchAllBonds()          — параллельная загрузка 4 board-ов, дедупликация по SECID
fetchRatings()           — загрузка ratings.json → ratingsMap
fetchZCYC()              — загрузка официальной КБД MOEX → ofzCurveData (параллельно с fetchAllBonds)
parseBoardBonds()        — маппинг строк MOEX → объекты Bond; определяет couponType через BONDTYPE
applyFilters()           — фильтрация allBonds → filteredBonds; в конце вызывает applySearch()
applySearch()            — единая точка рендеринга: учитывает searchQuery, searchMode, drillMode
buildSeries(bonds, showCurve, matchIds)  — формирует серии ECharts; matchIds → красный overlay поиска
buildPortfolioSeries()   — overlay diamond-серии поверх карты для каждого портфеля
initChart()              — инициализация ECharts, brush, drag-zoom, обработчики кликов
showBondCard(b, x, y)    — карточка рядом с курсором; отключает тултип (trigger:'none' + CSS bond-card-open)
hideBondCard()           — скрывает карточку; восстанавливает тултип
getZoom()                — читает реальный диапазон осей через chart.convertFromPixel(); надёжно
                           работает после колеса мыши и любых взаимодействий (в отличие от getOption())
setZoom(x0,x1,y0,y1)    — единая запись диапазона в dataZoom; все зум-операции идут через неё
fitZoomToData(bonds)     — авто-подстройка вида по перцентилям (1%–98%) без выбросов; вызывает setZoom
resetZoom()              — сбрасывает zoom: drill-режим → fitZoomToData(selectedBonds),
                           полная карта → fitZoomToData(filteredBonds); + exitBrushMode()
adjustZoom(xF, yF)       — масштабирует от центра текущего вида через getZoom()+setZoom();
                           xF/yF > 1 расширяет диапазон (zoom out), < 1 сужает (zoom in)
currentZoomSnapshot()    — возвращает {x0,x1,y0,y1} текущего вида через getZoom(); используется
                           при drill-down для сохранения позиции в drillStack
exitBrushMode()          — выходит из режима кисти (takeGlobalCursor brushType:false)
clearBrush()             — 1) поиск активен → clearSearch(); 2) drill → exitDrill(); 3) иначе очищает brush
clearSearch()            — сбрасывает searchQuery, очищает инпут, вызывает applySearch()
exitDrill()              — откат drill-down: восстанавливает zoom через setZoom(prev.zoom.*); exitBrushMode()
drillInto(bonds)         — drill-down: перестраивает график + fitZoomToData(bonds)
renderTable(bonds)       — таблица под графиком
matchesSearch(b, q)      — проверяет bond на совпадение (id, name, isin, issuerKey)
issuerKey(name)          — отрезает серийные суффиксы из SHORTNAME: "Сбербанк Р-001Р-176" → "Сбербанк"
loadPortfolioFromServer() — GET portfolio.json (с cache-bust) при старте
savePortfolioToServer()  — POST /api/save-portfolio; показывает статус через showSaveStatus()
renderPortfolioPanel()   — перестраивает HTML-панель портфелей; чекбоксы → visiblePortfolios
FETCH_TIMEOUT_MS=12000   — таймаут каждого запроса к MOEX ISS (AbortController)
ZOOM_STEP=1.2            — коэффициент масштабирования для кнопок zoom (плавные шаги ×1.2)
GRID_M                   — отступы сетки {left,right,top,bottom} — совпадают с grid в initChart();
                           нужны getZoom() для расчёта координат краёв plot-области
REPLACE_SERIES           — константа { replaceMerge: ['series'] } для chart.setOption; предотвращает
                           накопление "призрачных" серий при обновлении — ECharts без replaceMerge
                           merge-ит серии по индексу, и старая серия __search__ оставалась на графике
```

## UX — тултип и карточка

Два разных элемента с похожим содержимым:
- **ECharts tooltip** — всплывает при наведении, исчезает сам. Без кнопки закрытия.
- **Bond card** (`#bond-card`) — пин-карточка по клику. Имеет кнопку ✕. `position: fixed`.

### Тултип (v40)

- **Hover** → ECharts-тултип (`hideDelay: 300` — исчезает через 300мс после ухода курсора)
- **Любой mousedown на графике** → мгновенное скрытие тултипа: `dispatchAction({ type: 'hideTip' })` + inline CSS `opacity:0; visibility:hidden; transition:none` на `.echarts-tooltip`
- **mouseup** → `requestAnimationFrame` восстанавливает inline CSS (если карточка не открыта), чтобы тултип снова работал при следующем hover
- Почему `mousedown`, а не `click`: ECharts после `click` на точке внутренне вызывает `mouseover` и может сразу перепоказать тултип. `mousedown` срабатывает до этого.
- Почему `requestAnimationFrame` в `mouseup`, а не `mousemove`: `mousemove` стреляет сразу после `mousedown` и немедленно отменял бы скрытие. `mouseup` + rAF гарантирует, что вся цепочка `mousedown → mouseup → click` завершена.
- Почему была проблема с `hideDelay: 8000`: пользователь наводил, уходил курсором на пустое место, кликал — тултип держался ещё 8 секунд. Теперь 300мс.

### Карточка

- **Клик на точку** → `bond-card` появляется рядом с курсором. На `<body>` добавляется класс `bond-card-open`, который через CSS скрывает `.echarts-tooltip`. `trigger: 'none'` отключает тултип на уровне ECharts.
- **Закрытие** (кнопка ✕ или клик по пустому месту графика) → `bond-card-open` снимается, `trigger: 'item'` восстанавливается.
- Позиция рассчитывается JS с учётом краёв экрана (GAP=14px, CARD_W=310, CARD_H=185, отражается если выходит за край).
- Текст в карточке выделяем (`user-select: text; cursor: text`).
- Почему CSS, а не `setOption({ show: false })`: `setOption` применяется асинхронно и не успевает скрыть уже видимый тултип. CSS `visibility: hidden` применяется немедленно.

## Масштаб графика

- **Колесо мыши** — zoom in/out по обеим осям (`type: 'inside'` dataZoom)
- **Перетащить шкалу оси** — кастомный drag-zoom (`initAxisDrag()`): X вправо = уменьшить масштаб, влево = увеличить; Y вниз = уменьшить, вверх = увеличить
- **Авто-подстройка при старте** — после загрузки данных вид автоматически подгоняется под реальный диапазон через `fitZoomToData()`: обрезаются выбросы (перцентили 1%–98%), основная масса облигаций всегда в центре
- **Панель кнопок** (справа на графике, `.zoom-controls`):
  - `+` / `−` — приближение/удаление по обеим осям (×ZOOM_STEP=1.2)
  - `⊙` — сброс к виду по данным (`resetZoom()`)
  - `Y+` / `Y−` — расширить/сузить диапазон оси YTM
  - `X+` / `X−` — расширить/сузить диапазон оси Дюрация
- **Кнопка "↺ Сбросить масштаб"** под графиком — вызывает тот же `resetZoom()`
- **Выход из brush-режима** происходит автоматически при: сбросе масштаба, возврате из drill-down, очистке выделения. Реализовано через `takeGlobalCursor` с `brushType: false` — именно это переключает курсор тулбокса обратно в обычный режим (просто `brush: { areas: [] }` прямоугольники убирает, но курсор не меняет)

### Архитектура зум-системы (v38+)

Вся работа с масштабом проходит через два примитива:

```
getZoom()           — chart.convertFromPixel() → {x0, x1, y0, y1}
                      Читает реальный диапазон осей. Надёжно в любом состоянии:
                      после колеса мыши, brush, drag — в отличие от getOption().dataZoom,
                      где xAxisIndex приходит как [0] (массив), а startValue/endValue
                      могут быть undefined после интерактивного скролла.

setZoom(x0,x1,y0,y1) — chart.setOption({ dataZoom: [...] })
                      Единственное место записи dataZoom. Все остальные функции
                      (adjustZoom, fitZoomToData, exitDrill) вызывают только её.
```

`drillStack` хранит снапшот `{x0,x1,y0,y1}` через `currentZoomSnapshot() = getZoom()`.
При выходе из drill-down zoom восстанавливается через `setZoom(prev.zoom.x0, ...)` — не через `dataZoom: prev.zoom`.

## Цвет точек по рейтингу (v=54)

Каждая точка раскрашена по лучшему рейтингу облигации (`getBestRating`). Константы: `RATING_COLOR` (основные точки, «Виридис»), `PORTFOLIO_RATING_ZONES` (точки портфеля), `RATING_LEGEND_ITEMS` (легенда).

Все точки (включая обычные облигации и портфельные) используют **4-зонную палитру** через `getRatingColor(bond)`:

| Зона | Рейтинги | Диапазон цветов |
|---|---|---|
| Зелёная | AAA → AA- | `#00c853` → `#a5d6a7` (яркий зелёный → светло-зелёный) |
| Жёлтая | A+ → A- | `#f9a825` → `#ffe082` (янтарный → светло-жёлтый) |
| Синяя | BBB+ → BBB- | `#1565c0` → `#82b1ff` (тёмно-синий → светло-синий) |
| Красная | BB+ → D | `#f44336` → `#ffb3ae` (ярко-красный → розовый) |

Логика градиента: **лучший рейтинг = ярче**, худший = бледнее. Все цвета насыщены и хорошо видны (нет почти-белых оттенков).

- ОФЗ всегда получают цвет AAA (`#00c853`) независимо от рейтинга
- Без рейтинга: `#9e9e9e` серый
- Контуры у точек отсутствуют
- `symbolSize: 8` для обычных точек

Реализовано через: `getBestRating(bond)`, `getRatingColor(bond)`, `PORTFOLIO_RATING_ZONES`, `RATING_LEGEND_ITEMS`.
Пустые scatter-серии для каждого элемента легенды добавляются в конец `buildSeries()`.
**Важно:** `ratings.json` грузится только через HTTP, не через `file://` — нужен локальный сервер (порт 8001).

## Портфели (v=47+)

### Модель данных

```json
{
  "portfolios": [
    {
      "id": "p1",
      "name": "БКС 500",
      "color": "#1890ff",
      "positions": [
        { "isin": "RU000A105NJ3", "qty": 10, "buyPrice": 98.50 },
        { "isin": "RU000A107CM8", "qty": 5 }
      ]
    }
  ]
}
```

`buyPrice` — цена покупки в % от номинала, опционально.

### Хранение

- Сервер: `server.py` слушает POST `/api/save-portfolio` → пишет `portfolio.json`
- Автозагрузка: `loadPortfolioFromServer()` при старте, GET `portfolio.json?_=timestamp` (cache-bust)
- Автосохранение: после каждого изменения через `savePortfolioToServer()`
- Кнопка «Сохранить» — ручной триггер того же `savePortfolioToServer()`

### Добавление позиций

**Вручную** — кнопка «+ Позиция» открывает форму:
- Выбор существующего портфеля или «+ Новый портфель»
- ISIN или тикер (поиск по `ratingsMap` + `allBonds`)
- Количество, цена покупки %

**Из Excel (corpbonds.ru)** — кнопка «↑ Excel»:
- Открывает `<input type="file" accept=".xlsx">`
- SheetJS парсит в браузере: `XLSX.read(arrayBuffer, {type:'array'})` → `sheet_to_json(..., {header:1})`
- Нужные столбцы: ISIN (col 0), «Кол-во бумаг» (col 4), «Ср. цена позиции, %» (col 15, опционально)
- Пропускает строки без валидного ISIN (не начинается с `RU` или `XS`)
- Диалог выбора портфеля-назначения; при совпадении ISIN — обновляет qty и buyPrice

**Из JSON** — кнопка «↑ JSON»: загружает `portfolio.json` (полная замена локального состояния).

### Визуализация на карте

- Символ `diamond`, `symbolSize: 18`, `z: 20` (поверх всего)
- Цвет: `getRatingColor(bond)` — тот же, что у обычных точек (по рейтингу, 4-зонная палитра)
- Каждый портфель — отдельная серия с именем вида `__pf_p1__`
- Серии обновляются через `replaceMerge: ['series']` — нет «призраков»

### Фильтрация

- Чекбоксы в панели портфелей управляют `visiblePortfolios: Set`
- Кнопка «Только портфели» (`btn-pf-filter`): `portfolioFilterMode = true` → в `applyFilters()` `filteredBonds` пересекается с ISIN всех видимых портфелей
- При выключенном режиме портфельные diamond-точки видны поверх полной карты

## Фильтры

- Тип эмитента (ОФЗ / Муниципальные / Корпоративные / Прочие)
- Тип купона (Фиксированный / Флоатер / Переменный / Дисконтный / Прочие)
- Рейтинг (динамический список из ratings.json, порядок от AAA до D)
- Валюта (SUR / USD / EUR)

## Кривая ОФЗ (КБД)

Используется **официальная кривая бескупонной доходности (КБД)** от MOEX — модель Нельсона-Сигеля-Свенссона. Загружается через endpoint:
`https://iss.moex.com/iss/engines/stock/zcyc.json?iss.meta=off&iss.only=yearyields`

Секция `yearyields` содержит готовые значения на стандартных сроках (0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20 лет). Эти же данные используют bondcoupon.ru и corpbonds.ru. Хранится в `ofzCurveData: [[period, yield], ...]`.

## Поиск

Строка поиска над фильтрами. Ищет от 2 символов по: SECID, SHORTNAME, ISIN, `issuerKey(name)`.

Два режима (радио-кнопки):
- **Подсветить** — все облигации видны, найденные выделены красным overlay-серией (`__search__`, z:10, цвет `#ff1744`)
- **Только результаты** — на карте только найденные

При смене фильтров поиск переприменяется к новому `filteredBonds`. Escape / кнопка ✕ / кнопка в sel-bar — сбрасывают поиск. Поиск имеет приоритет над drill-down в рендеринге, но drill-состояние сохраняется и восстанавливается после очистки поиска.

## Drill-down

Brush-выделение прямоугольника → `drillInto(bonds)` → график перестраивается только по выбранным бумагам + показывается таблица. История drill-уровней хранится в `drillStack` (`[{ bonds, zoom: {x0,x1,y0,y1} }]`). Масштаб при входе в drill устанавливается через `fitZoomToData(bonds)`, при выходе — восстанавливается через `setZoom(prev.zoom.*)`. При смене фильтров drillStack сбрасывается, но `selectedBonds` пересекается с новым `filteredBonds`. Кнопка "← Вернуться к полной карте" откатывает на уровень выше.
