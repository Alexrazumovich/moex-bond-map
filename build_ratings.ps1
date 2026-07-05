# build_ratings.ps1
# Перестраивает ratings.json с нуля:
#   1. Открывает export.xlsx (photo-ratings/) — ISIN (кол.1), Название (кол.2), Рейтинг (кол.5)
#   2. Загружает все облигации с MOEX (TQOB, TQMU, TQCB, TQOD) с пагинацией
#   3. Для каждой бумаги ищет рейтинг: сначала по ISIN, затем по нормализованному названию
#   4. Сохраняет ratings.json
# Запускать из папки market-map: .\build_ratings.ps1

$ExcelFile   = "D:\Users\user\pa-finance\market-map\photo-ratings\export.xlsx"
$RatingsFile = "D:\Users\user\pa-finance\market-map\ratings.json"

# ─── 1. Читаем export.xlsx ───────────────────────────────────────────────────
Write-Host "Открываю export.xlsx..."
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false; $excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($ExcelFile)
$ws = $wb.Sheets.Item(1)
$maxRow = $ws.UsedRange.Rows.Count
Write-Host "Строк в файле: $maxRow"

function Normalize-Name($s) {
    # Нижний регистр, убираем всё кроме букв и цифр
    return ([regex]::Replace($s, '[^а-яёА-ЯЁa-zA-Z0-9]', '')).ToLower()
}

$isinMap = @{}   # ISIN → rating
$nameMap = @{}   # normalized_name → rating

for ($r = 2; $r -le $maxRow; $r++) {
    $isin   = $ws.Cells.Item($r, 1).Text.Trim()
    $name   = $ws.Cells.Item($r, 2).Text.Trim()
    $rawRtg = $ws.Cells.Item($r, 5).Text.Trim()

    if (-not $rawRtg) { continue }

    # Формат "BB-|RU|" → берём часть до первого "|"
    $rating = (($rawRtg -split '\|')[0]).Trim().ToUpper()
    if (-not $rating) { continue }

    if ($isin) { $isinMap[$isin] = $rating }

    $norm = Normalize-Name $name
    if ($norm.Length -ge 5 -and -not $nameMap.ContainsKey($norm)) {
        $nameMap[$norm] = $rating
    }
}

$wb.Close($false); $excel.Quit()
[Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null

Write-Host "ISIN-ключей из Excel: $($isinMap.Count)"
Write-Host "Name-ключей из Excel: $($nameMap.Count)"

# ─── 2. Загружаем бумаги с MOEX ─────────────────────────────────────────────
$boards = @("TQOB", "TQCB", "TQOD", "TQMU")
$ratings   = @{}
$byIsin    = 0
$byName    = 0
$noMatch   = 0

foreach ($board in $boards) {
    Write-Host "Загружаю $board ..."
    $start    = 0
    $pageSize = 100
    $total    = $null

    do {
        $url  = "https://iss.moex.com/iss/engines/stock/markets/bonds/boards/$board/securities.json" +
                "?iss.meta=off&iss.only=securities&securities.columns=SECID,ISIN,SHORTNAME&start=$start"
        try {
            $resp = Invoke-RestMethod $url -TimeoutSec 30
        } catch {
            Write-Warning "$board стр.$([math]::Floor($start/$pageSize)+1): $($_.Exception.Message)"
            break
        }

        $cols     = $resp.securities.columns
        $rows     = $resp.securities.data
        $secidIdx = [array]::IndexOf($cols, "SECID")
        $isinIdx  = [array]::IndexOf($cols, "ISIN")
        $nameIdx  = [array]::IndexOf($cols, "SHORTNAME")

        foreach ($row in $rows) {
            $secid = $row[$secidIdx]
            $isin  = $row[$isinIdx]
            $name  = $row[$nameIdx]
            $key   = if ($isin) { $isin } else { $secid }

            if ($ratings.ContainsKey($key)) { continue }   # уже есть (другая площадка)

            # Поиск по ISIN
            $found = $null
            if ($isin  -and $isinMap.ContainsKey($isin))  { $found = $isinMap[$isin];  $byIsin++ }
            elseif ($secid -and $isinMap.ContainsKey($secid)) { $found = $isinMap[$secid]; $byIsin++ }

            # Поиск по нормализованному названию (если ISIN не нашёлся)
            if (-not $found -and $name) {
                $norm = Normalize-Name $name
                if ($norm.Length -ge 5 -and $nameMap.ContainsKey($norm)) {
                    $found = $nameMap[$norm]; $byName++
                }
            }

            if ($found) { $ratings[$key] = $found }
            else        { $noMatch++ }
        }

        $start += $rows.Count
        # Продолжаем, пока получаем полную страницу
    } while ($rows.Count -eq $pageSize)

    Write-Host "  $board: обработано $start бумаг"
}

# ─── 3. Сохраняем ───────────────────────────────────────────────────────────
$sorted = [ordered]@{}
$ratings.Keys | Sort-Object | ForEach-Object { $sorted[$_] = $ratings[$_] }
$sorted | ConvertTo-Json -Depth 2 | Set-Content $RatingsFile -Encoding UTF8

Write-Host ""
Write-Host "════════════════════════════════════════════"
Write-Host "  Найдено по ISIN       : $byIsin"
Write-Host "  Найдено по названию   : $byName"
Write-Host "  Без рейтинга (пропуск): $noMatch"
Write-Host "  Итого в ratings.json  : $($ratings.Count)"
Write-Host "════════════════════════════════════════════"
