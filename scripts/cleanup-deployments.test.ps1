# Offline fixture: preview-only projects retain their five newest deployments.
$ErrorActionPreference = 'Stop'
$env:VERCEL_TOKEN = 'fixture-token'
$env:VERCEL_TEAM_ID = 'fixture-team'
$requests = [System.Collections.Generic.List[string]]::new()
$deletes = [System.Collections.Generic.List[string]]::new()
$messages = [System.Collections.Generic.List[string]]::new()

function Write-Host {
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Object)
    $messages.Add(($Object -join ' '))
}

function Invoke-RestMethod {
    param([string]$Uri, [hashtable]$Headers, [int]$TimeoutSec)
    $requests.Add($Uri)
    if ($Uri -like '*v9/projects*') {
        return @{ projects = @(
            @{ id = 'no-production'; name = 'No production'; targets = @{} }
        ); pagination = @{} }
    }
    if ($Uri -like '*projectId=no-production*') {
        return @{ deployments = @(
            @{ uid = 'preview-1'; state = 'READY'; createdAt = 1 },
            @{ uid = 'preview-2'; state = 'READY'; createdAt = 2 },
            @{ uid = 'preview-3'; state = 'READY'; createdAt = 3 },
            @{ uid = 'preview-4'; state = 'READY'; createdAt = 4 },
            @{ uid = 'preview-5'; state = 'READY'; createdAt = 5 },
            @{ uid = 'preview-6'; state = 'READY'; createdAt = 6 }
        ); pagination = @{} }
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

if (-not ($requests | Where-Object { $_ -like '*projectId=no-production*' })) {
    throw 'a project without targets.production.id did not list deployments'
}
if ($deletes.Count -ne 0) {
    throw 'a dry run made a delete request'
}
if (-not ($messages -contains 'No production: 6 total, keeping 5, deleting 1')) {
    throw 'a preview-only project did not retain its five newest deployments'
}
$dryRunDeletes = @($messages | Where-Object { $_ -match '\[dry-run\] would delete' })
if ($dryRunDeletes.Count -ne 1 -or $dryRunDeletes[0] -notmatch '\[dry-run\] would delete preview-1') {
    throw 'a preview-only project did not dry-run deletion of only its oldest deployment'
}
