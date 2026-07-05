# update_ratings_excel.ps1
# Читает "Анализ облигаций.xlsx" из photo-ratings/ и обновляет ratings.json.
# Запускать из папки market-map: .\update_ratings_excel.ps1

$ExcelFile   = "D:\Users\user\pa-finance\market-map\photo-ratings\Анализ облигаций.xlsx"
$RatingsFile = "D:\Users\user\pa-finance\market-map\ratings.json"

# ─── Загрузка существующих рейтингов ─────────────────────────────────────────
$existingRatings = @{}
if (Test-Path $RatingsFile) {
    $raw = Get-Content $RatingsFile -Raw | ConvertFrom-Json
    foreach ($p in $raw.PSObject.Properties) { $existingRatings[$p.Name] = $p.Value }
}
$countBefore = $existingRatings.Count
Write-Host "Записей до обновления : $countBefore"

# ─── Открытие Excel ──────────────────────────────────────────────────────────
Write-Host "Открываю $ExcelFile ..."
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($ExcelFile)
$ws = $wb.Sheets.Item(1)
$maxRow = $ws.UsedRange.Rows.Count
Write-Host "Строк в файле: $maxRow (включая заголовок)"

# Проверяем, что ISIN в кол. 1 и рейтинг в кол. 17
$h1  = $ws.Cells.Item(1,1).Text
$h17 = $ws.Cells.Item(1,17).Text
Write-Host "Кол.1 = '$h1'   Кол.17 = '$h17'"

# ─── Извлечение пар ISIN → рейтинг ──────────────────────────────────────────
$newRatings   = @{}
$skippedNew   = 0
$skippedEmpty = 0

for ($r = 2; $r -le $maxRow; $r++) {
    $isin   = $ws.Cells.Item($r, 1).Text.Trim()
    $rating = $ws.Cells.Item($r, 17).Text.Trim()

    if (-not $isin -or -not $rating) { $skippedEmpty++; continue }

    if ($existingRatings.ContainsKey($isin)) {
        $skippedNew++      # сохраняем более детальный рейтинг из существующего файла
        continue
    }
    $newRatings[$isin] = $rating
}

$wb.Close($false)
$excel.Quit()
[Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null

# ─── Объединение и сохранение ────────────────────────────────────────────────
$merged = @{}
foreach ($k in $existingRatings.Keys) { $merged[$k] = $existingRatings[$k] }
foreach ($k in $newRatings.Keys)       { $merged[$k] = $newRatings[$k] }

$added = $merged.Count - $countBefore

# Сохраняем с сортировкой ключей для читаемости
$sorted = [ordered]@{}
$merged.Keys | Sort-Object | ForEach-Object { $sorted[$_] = $merged[$_] }

$sorted | ConvertTo-Json -Depth 2 | Set-Content $RatingsFile -Encoding UTF8

Write-Host ""
Write-Host "════════════════════════════════════════════"
Write-Host "  Строк в Excel          : $($maxRow - 1)"
Write-Host "  Пропущено (пустые)     : $skippedEmpty"
Write-Host "  Пропущено (уже есть)   : $skippedNew"
Write-Host "  Новых добавлено        : $added"
Write-Host "  Итого в ratings.json   : $($merged.Count)"
Write-Host "════════════════════════════════════════════"
