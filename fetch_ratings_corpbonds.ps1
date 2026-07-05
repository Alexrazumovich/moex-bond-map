# fetch_ratings_corpbonds.ps1
# Забирает рейтинги всех корп. и муниципальных облигаций с corpbonds.ru/screener/bonds
# и перезаписывает ratings.json.
# Запускать из папки market-map: .\fetch_ratings_corpbonds.ps1

$RatingsFile = "D:\Users\user\pa-finance\market-map\ratings.json"
$Url         = "https://corpbonds.ru/screener/bonds"

# Запрашиваем без фильтров по типу купона/дюрации, только сектора с возможными рейтингами
$Body = '{"market-sector":["corp","muni"],"currency":["SUR"]}'

Write-Host "Запрашиваю данные с corpbonds.ru..."

try {
    $response = Invoke-RestMethod `
        -Uri     $Url `
        -Method  POST `
        -Body    $Body `
        -ContentType "application/json" `
        -Headers @{ "X-Requested-With" = "XMLHttpRequest" } `
        -TimeoutSec 60
} catch {
    Write-Error "Ошибка запроса: $($_.Exception.Message)"
    exit 1
}

Write-Host "Получено облигаций: $($response.Count)"

# Собираем ISIN → строка рейтингов (все агентства через "; ")
$ratings    = @{}
$withRating = 0
$noRating   = 0

foreach ($bond in $response) {
    $isin = $bond.isin
    if (-not $isin) { continue }

    $ratingNames = @($bond.ratings | Where-Object { $_.ratingName } | ForEach-Object { $_.ratingName })

    if ($ratingNames.Count -eq 0) { $noRating++; continue }

    $ratings[$isin] = $ratingNames -join "; "
    $withRating++
}

# Сохраняем с сортировкой ключей
$sorted = [ordered]@{}
$ratings.Keys | Sort-Object | ForEach-Object { $sorted[$_] = $ratings[$_] }

$sorted | ConvertTo-Json -Depth 2 | Set-Content $RatingsFile -Encoding UTF8

Write-Host ""
Write-Host "════════════════════════════════════════════"
Write-Host "  Всего облигаций получено : $($response.Count)"
Write-Host "  С рейтингом              : $withRating"
Write-Host "  Без рейтинга (пропуск)   : $noRating"
Write-Host "  Записей в ratings.json   : $($ratings.Count)"
Write-Host "════════════════════════════════════════════"
Write-Host ""
Write-Host "Готово. ratings.json обновлён — можно открывать index.html."
