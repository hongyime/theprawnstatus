# Offline fixture: projects without a production target must not list or delete deployments.
$ErrorActionPreference = 'Stop'
$env:VERCEL_TOKEN = 'fixture-token'
$env:VERCEL_TEAM_ID = 'fixture-team'
$requests = [System.Collections.Generic.List[string]]::new()
$deletes = [System.Collections.Generic.List[string]]::new()

function Invoke-RestMethod {
    param([string]$Uri, [hashtable]$Headers, [int]$TimeoutSec)
    $requests.Add($Uri)
    if ($Uri -like '*v9/projects*') {
        return @{ projects = @(
            @{ id = 'no-production'; name = 'No production'; targets = @{} },
            @{ id = 'production'; name = 'Production'; targets = @{ production = @{ id = 'current' } } }
        ); pagination = @{} }
    }
    if ($Uri -like '*projectId=production*') {
        return @{ deployments = @(@{ uid = 'current'; state = 'READY'; createdAt = 0 }); pagination = @{} }
    }
    throw "unexpected deployment list: $Uri"
}

function Invoke-WebRequest {
    param(
        [string]$Uri,
        [string]$Method,
        [hashtable]$Headers,
        [switch]$UseBasicParsing,
        [switch]$SkipHttpErrorCheck,
        [int]$TimeoutSec
    )
    $deletes.Add($Uri)
    throw "deletes are not expected in this fixture"
}

& (Join-Path $PSScriptRoot 'cleanup-deployments.ps1') -DryRun

if ($requests | Where-Object { $_ -like '*projectId=no-production*' }) {
    throw 'a project without targets.production.id listed deployments'
}
if ($deletes.Count -ne 0) {
    throw 'a project without targets.production.id made a delete decision'
}
