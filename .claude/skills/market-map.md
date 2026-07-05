# Скилл: market-map

Этот скилл помогает работать с проектом **Карта рынка облигаций MOEX**.  
Читай его целиком перед любой работой с репозиторием.

---

## 1. Структура проекта

```
market-map/
├── index.html          — разметка SPA
├── app.js              — вся логика (ECharts, MOEX ISS, Supabase, портфели)
├── style.css           — стили
├── server.py           — локальный HTTP-сервер (порт 8001) + POST /api/save-portfolio
├── ratings.json        — рейтинги облигаций (ISIN → строка агентств)
├── fetch_ratings.py    — Python-скрипт обновления рейтингов (для Actions и CLI)
├── fetch_ratings_corpbonds.ps1  — то же для Windows PowerShell
├── README.md           — документация репозитория
├── market-map-description.md   — подробное техническое описание (читать перед работой!)
├── img/
│   └── current_map.png — актуальный скриншот для README
├── .github/workflows/
│   └── update-ratings.yml  — GitHub Actions: обновление рейтингов каждую ночь в 03:00 МСК
└── .gitignore          — portfolio.json, files/, photo-ratings/, __pycache__/
```

**Репозиторий:** https://github.com/Alexrazumovich/moex-bond-map  
**Живой сайт:** https://alexrazumovich.github.io/moex-bond-map/

**Перед любой работой читай** `market-map-description.md` — там архитектура, ключевые решения, схема БД.

---

## 2. Запуск локального сервиса

```powershell
# Убить старые Python-процессы на порту 8001
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Запустить сервер
Start-Process python -ArgumentList "D:\Users\user\pa-finance\market-map\server.py" -WindowStyle Hidden

# Открыть в браузере
Start-Process "http://localhost:8001"
```

**Важно:** открывать только через `http://localhost:8001`, не как `file://` — браузер блокирует fetch из файловой системы.

---

## 3. Версионирование и кэш-бастинг

При каждом изменении `app.js` или `style.css` — **обязательно** бампить версию в `index.html`:

```html
<!-- Найти и поменять обе строки -->
<link rel="stylesheet" href="style.css?v=56">
<script src="app.js?v=56"></script>
```

Текущая версия указана в `market-map-description.md` (поле «Текущая версия»).  
Версию также обновить в `market-map-description.md` и в memory-файле проекта.

---

## 4. Внесение изменений — чеклист

1. Прочитай `market-map-description.md`
2. Внеси изменения в `app.js` / `style.css` / `index.html`
3. Бампни версию `?v=N` в `index.html`
4. Перезапусти сервер и проверь в браузере
5. Обнови `market-map-description.md` если изменилась архитектура
6. Обнови memory-файл `project_market_map.md`
7. Закоммить и запушить (см. раздел «Публикация»)

---

## 5. Обновление README

README находится в корне репозитория. Обновляй при:
- Добавлении новых функций
- Изменении стека или источников данных
- Смене скриншота

**Скриншот** — всегда через абсолютный raw-URL:
```markdown
![Карта рынка облигаций](https://raw.githubusercontent.com/Alexrazumovich/moex-bond-map/master/img/current_map.png)
```

Чтобы обновить скриншот: положи новый файл в `img/current_map.png` и закоммить его отдельно.

---

## 6. Диагностика ошибок

### Сервер не запускается
```powershell
# Проверить, что порт 8001 свободен
netstat -ano | Select-String ":8001"
# Если занят — убить процесс по PID
Stop-Process -Id <PID> -Force
```

### Данные MOEX не загружаются
- Проверить консоль браузера (F12) — там детали fetch-ошибок
- MOEX ISS иногда временно недоступен — подождать и обновить страницу
- Таймаут запроса: `FETCH_TIMEOUT_MS = 12000` в `app.js`

### Рейтинги не отображаются
- `ratings.json` должен быть в папке проекта и доступен через HTTP
- Проверить: `http://localhost:8001/ratings.json`
- Обновить вручную: `python fetch_ratings.py`

### Портфели не сохраняются
- Вошёл в аккаунт → данные идут в Supabase; проверить в Supabase Dashboard → Table Editor
- Не вошёл → сохраняются в localStorage; проверить в DevTools → Application → Local Storage
- Локально → через POST `/api/save-portfolio`; проверить что `server.py` запущен

### Ошибки Supabase
- `SUPABASE_URL` и `SUPABASE_KEY` — первые строки `app.js`
- Publishable key — безопасен в публичном коде (защита через RLS)
- Таблицы: `portfolios`, `positions` (Supabase Dashboard → Table Editor)

---

## 7. Обновление рейтингов вручную

```powershell
# Windows
.\fetch_ratings_corpbonds.ps1

# Или через Python (кросс-платформенно)
python fetch_ratings.py
```

После обновления — закоммитить:
```powershell
git add ratings.json
git commit -m "chore: update ratings.json"
git push
```

**Автоматически:** GitHub Actions запускает `fetch_ratings.py` каждую ночь в 03:00 МСК.  
Ручной запуск: GitHub → вкладка Actions → Update ratings → Run workflow.

---

## 8. Публикация (git workflow)

```powershell
cd "D:\Users\user\pa-finance\market-map"

# Проверить состояние
git status

# Если remote опередил (например, Actions закоммитил ratings.json) — подтянуть
git pull --rebase

# Закоммитить изменения
git add <файлы>
git commit -m "описание изменений"
git push
```

**После push:**
- GitHub Pages автоматически пересобирает сайт (~1 мин)
- Проверить статус: `gh run list --limit 5`
- Живой сайт: https://alexrazumovich.github.io/moex-bond-map/

**Если push отклонён** (`rejected — fetch first`): Actions успел закоммитить `ratings.json` раньше.  
Решение: `git pull --rebase` → затем `git push`.

---

## 9. Supabase схема

```sql
portfolios (id uuid PK, user_id uuid → auth.users, client_id text, name text, color text)
positions  (id uuid PK, portfolio_id uuid → portfolios CASCADE, isin text, qty int, buy_price numeric)
```

- Проект: `moex-bond-map` на supabase.com (аккаунт Alexrazumovich)
- RLS включён: пользователь видит только свои портфели
- Регион: Southeast Asia (Singapore) — `ap-southeast-1`
