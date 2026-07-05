# Скачивает рейтинги облигаций со Smart-Lab и сохраняет ratings.json
# Запускать из папки market-map: .\fetch_ratings.ps1
$r = Invoke-WebRequest "https://smart-lab.ru/q/bonds/" -UserAgent "Mozilla/5.0"
$raw = $r.Content
$match = [regex]::Match($raw, 'var aBondsChartData = (\{.*?\});')
if (-not $match.Success) { Write-Error "aBondsChartData not found"; exit 1 }
$data = $match.Groups[1].Value | ConvertFrom-Json
$ratings = @{}
foreach ($key in @('wc','woc','wc_ft','woc_ft')) {
    foreach ($item in $data.$key) {
        if ($item.secid -and $item.rating) { $ratings[$item.secid] = $item.rating }
    }
}
$ratings | ConvertTo-Json | Set-Content "$PSScriptRoot\ratings.json" -Encoding UTF8
Write-Host "Saved $($ratings.Count) ratings to ratings.json"
