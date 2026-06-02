# remove-scheduler.ps1 - 删除定时任务
$TaskName = "HBUST-CourseCrawler"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "✅ 已删除: $TaskName"
} else {
    Write-Host "⚠ 任务不存在: $TaskName"
}
