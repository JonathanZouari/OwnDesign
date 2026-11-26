$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$backend = Join-Path $project 'backend'
$frontend = Join-Path $project 'frontend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;" + $env:Path
$env:DOCKER_CONTEXT = 'desktop-linux'
$socket = docker context inspect --format '{{.Endpoints.docker.Host}}'
if ($socket -ne 'npipe:////./pipe/dockerDesktopLinuxEngine') { throw 'Expected local Docker Desktop engine.' }
if (Test-Path (Join-Path $project 'supabase/.temp/project-ref')) { throw 'Expected an unlinked local project.' }
$status = supabase status --workdir $project -o json 2>$null
if ($LASTEXITCODE -ne 0) {
    supabase start --workdir $project -x realtime,imgproxy,edge-runtime,logflare,vector,supavisor,studio,postgres-meta,mailpit >$null
    if ($LASTEXITCODE -ne 0) { throw 'Local database failed to start.' }
    $status = supabase status --workdir $project -o json 2>$null
}
$local = ($status -join "`n") | ConvertFrom-Json
if ($local.API_URL -notmatch '^http://(localhost|127\.0\.0\.1):[0-9]+$') { throw 'Expected a loopback database API.' }
$public = $local.PUBLISHABLE_KEY
if (!$public) { $public = $local.ANON_KEY }
$secret = $local.SECRET_KEY
if (!$secret) { $secret = $local.SERVICE_ROLE_KEY }
if (!$public -or !$secret) { throw 'Local development keys unavailable.' }
$env:SUPABASE_URL = $local.API_URL
$env:SUPABASE_PUBLISHABLE_KEY = $public
$env:SUPABASE_SECRET_KEY = $secret
$env:ALLOWED_ORIGINS = 'http://localhost:5500,http://127.0.0.1:5500'
$config = @{ apiUrl='http://127.0.0.1:8000'; supabaseUrl=$local.API_URL; supabasePublishableKey=$public } | ConvertTo-Json
foreach ($port in 5500,8000) {
    if ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $port) { throw "Port $port in use. Existing services left running." }
}
[IO.File]::WriteAllText((Join-Path $frontend 'js/config.js'), "export const config = $config;")
$api = Start-Process $python -WorkingDirectory $backend -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000' -WindowStyle Hidden -PassThru
$ui = Start-Process $python -WorkingDirectory $frontend -ArgumentList '-m','http.server','5500','--bind','127.0.0.1' -WindowStyle Hidden -PassThru
for ($i=0;$i -lt 30;$i++) {
    if ($api.HasExited -or $ui.HasExited) { throw 'A local app server exited.' }
    try {
        $health = Invoke-RestMethod http://127.0.0.1:8000/health
        if ($health.data.status -eq 'ok' -and (Invoke-WebRequest http://127.0.0.1:5500/ -UseBasicParsing).StatusCode -eq 200) { Write-Output 'App ready: http://127.0.0.1:5500'; return }
    } catch {}
    Start-Sleep -Seconds 1
}
throw 'Local application readiness timed out.'
