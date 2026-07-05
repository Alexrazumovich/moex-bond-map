# Загружает рейтинги эмитентов с CBonds и сохраняет ratings.json
# Запускать из папки market-map: .\fetch_ratings_cbonds.ps1
#
# При первом запуске замени LOGIN и PASSWORD на реальные данные CBonds.
# Демо-аккаунт (test/test) работает, но содержит лишь несколько тестовых записей.

param(
    [string]$Login    = "test",
    [string]$Password = "test"
)

$BaseUrl = "https://ws2.cbonds.info/services/json"

# ─── Вспомогательные функции ──────────────────────────────────────────────────

function Invoke-Cbonds($Operation, $Body) {
    $url  = "$BaseUrl/$Operation/?login=$Login&password=$Password"
    $json = $Body | ConvertTo-Json -Depth 5 -Compress
    Invoke-RestMethod -Uri $url -Method POST -Body $json -ContentType "application/json; charset=utf-8"
}

# Скачивает все страницы операции (по 1000 записей), возвращает объединённый список
function Get-AllPages($Operation, $Fields, $Filter = $null) {
    $page   = 1
    $limit  = 1000
    $result = @()
    do {
        $body = @{ page = $page; limit = $limit; fields = $Fields }
        if ($Filter) { $body['filter'] = $Filter }
        $r = Invoke-Cbonds $Operation $body
        $result += $r.items
        Write-Host "  $Operation стр.$page : получено $($result.Count) из $($r.total)"
        $page++
    } while ($result.Count -lt $r.total)
    return $result
}

# Нормализует рейтинг к стандартному виду: AA+(RU) → AA+, ruAAA → AAA, bbb-(ru) → BBB-
function Normalize-Rating($raw) {
    if (!$raw -or $raw -eq 'Withdrawn') { return $null }
    $r = $raw -replace '\([Rr][Uu]\)$', ''   # убираем суффикс (RU)/(ru)
    $r = $r -replace '^ru',             ''   # убираем ru-префикс (Эксперт РА: ruAAA → AAA)
    return $r.ToUpper().Trim()
}

# ─── Шаг 1: рейтинги эмитентов (только Россия) ───────────────────────────────

Write-Host "Шаг 1: получаем рейтинги эмитентов (Россия)…"
$allRatings = Get-AllPages "get_emitent_ratings" `
    @("emitent_id", "scale_point_name", "agency_name_rus", "date") `
    @{ emitent_country_id = "1" }

# Для каждого эмитента берём самый свежий не-отозванный рейтинг
$emitentRating = @{}
foreach ($g in ($allRatings | Group-Object emitent_id)) {
    $latest = $g.Group |
        Where-Object { $_.scale_point_name -ne 'Withdrawn' } |
        Sort-Object date -Descending |
        Select-Object -First 1
    if ($latest) {
        $norm = Normalize-Rating $latest.scale_point_name
        if ($norm) { $emitentRating[$g.Name] = $norm }
    }
}
Write-Host "Уникальных эмитентов с рейтингом: $($emitentRating.Count)"

# ─── Шаг 2: выпуски облигаций (ISIN → emitent_id) ────────────────────────────

Write-Host "Шаг 2: получаем выпуски облигаций (Россия)…"
$allEmissions = Get-AllPages "get_emissions" `
    @("isin_code", "emitent_id") `
    @{ emitent_country_id = "1" }

# ─── Шаг 3: строим маппинг ISIN → рейтинг ───────────────────────────────────

$isinRatings = @{}
foreach ($e in $allEmissions) {
    if ($e.isin_code -and $emitentRating.ContainsKey($e.emitent_id)) {
        $isinRatings[$e.isin_code] = $emitentRating[$e.emitent_id]
    }
}
Write-Host "ISIN с рейтингами: $($isinRatings.Count)"

# ─── Шаг 4: сохраняем ────────────────────────────────────────────────────────

$isinRatings | ConvertTo-Json | Set-Content "$PSScriptRoot\ratings.json" -Encoding UTF8
Write-Host "Готово → ratings.json ($($isinRatings.Count) записей)"
