# Deletes old/unneeded Vercel deployments across every project on the team
# to prevent storage exhaustion on the Hobby (free) plan.
#
# Vercel's own `deploymentExpiration` setting (30 days / keep 10) is NOT
# reliably enforced on Hobby — projects have been found with 13-16
# deployments dating back 6+ months. This script is the real enforcement.
#
# Policy (conservative, safe for quick rollback):
#   - NEVER delete the current production deployment for any project.
#   - Keep the $KeepRecent most recent deployments per project regardless
#     of state (gives a rollback buffer).
#   - Delete everything else.
#
# Usage:
#   $env:VERCEL_TOKEN = "..."; $env:VERCEL_TEAM_ID = "..."
#   pwsh scripts/cleanup-deployments.ps1 [-DryRun]

param(
    [switch]$DryRun,
    [int]$KeepRecent = 5
)

$ErrorActionPreference = 'Stop'

$VercelToken = $env:VERCEL_TOKEN
$VercelTeamId = $env:VERCEL_TEAM_ID

if (-not $VercelToken -or -not $VercelTeamId) {
    throw "VERCEL_TOKEN and VERCEL_TEAM_ID environment variables are required"
}

$Headers = @{ Authorization = "Bearer $VercelToken" }

function Get-AllProjects {
    $projects = @()
    $next = $null
    do {
        $qs = "teamId=$VercelTeamId&limit=100"
        if ($next) { $qs += "&from=$next" }
        $data = Invoke-RestMethod "https://api.vercel.com/v9/projects?$qs" -Headers $Headers -TimeoutSec 30
        $projects += @($data.projects)
        $next = $data.pagination.next
    } while ($next)
    return $projects
}

function Get-AllDeployments($ProjectId) {
    $deployments = @()
    $next = $null
    do {
        $qs = "teamId=$VercelTeamId&projectId=$ProjectId&limit=100"
        if ($next) { $qs += "&until=$next" }
        $data = Invoke-RestMethod "https://api.vercel.com/v6/deployments?$qs" -Headers $Headers -TimeoutSec 30
        $deployments += @($data.deployments)
        $next = $data.pagination.next
    } while ($next)
    return $deployments
}

function Remove-VercelDeployment($Uid) {
    try {
        $r = Invoke-WebRequest "https://api.vercel.com/v13/deployments/$Uid?teamId=$VercelTeamId" -Method DELETE -Headers $Headers -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 30
        # 200 = deleted, 404 = already gone. Both count as success.
        return ($r.StatusCode -eq 200 -or $r.StatusCode -eq 404)
    } catch {
        Write-Host "  WARNING delete failed for $Uid : $($_.Exception.Message)"
        return $false
    }
}

Write-Host "Vercel deployment cleanup $(if ($DryRun) { '(DRY RUN)' })"
$projects = Get-AllProjects
Write-Host "Found $($projects.Count) projects`n"

$totalDeleted = 0
$totalKept = 0
$totalErrors = 0

foreach ($project in $projects) {
    $productionId = $project.targets.production.id
    $deployments = @(Get-AllDeployments -ProjectId $project.id)

    if ($deployments.Count -eq 0) {
        Write-Host "- $($project.name): no deployments"
        continue
    }

    $sorted = $deployments | Sort-Object -Property createdAt -Descending

    $keepIds = New-Object System.Collections.Generic.HashSet[string]
    if ($productionId) { [void]$keepIds.Add($productionId) }
    foreach ($d in ($sorted | Select-Object -First $KeepRecent)) { [void]$keepIds.Add($d.uid) }

    $toDelete = $sorted | Where-Object { -not $keepIds.Contains($_.uid) }

    if (@($toDelete).Count -eq 0) {
        Write-Host "OK $($project.name): $($deployments.Count) deployments, nothing to clean"
        $totalKept += $deployments.Count
        continue
    }

    Write-Host "$($project.name): $($deployments.Count) total, keeping $($keepIds.Count), deleting $(@($toDelete).Count)"
    $totalKept += $keepIds.Count

    foreach ($d in $toDelete) {
        if ($DryRun) {
            Write-Host "  [dry-run] would delete $($d.uid) ($($d.state), $([DateTimeOffset]::FromUnixTimeMilliseconds($d.createdAt).ToString('yyyy-MM-dd')))"
            $totalDeleted++
            continue
        }
        $ok = Remove-VercelDeployment -Uid $d.uid
        if ($ok) { $totalDeleted++ } else { $totalErrors++ }
    }
}

Write-Host "`nDone. Kept: $totalKept, Deleted: $totalDeleted, Errors: $totalErrors"
