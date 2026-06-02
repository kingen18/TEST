# setup-scheduler.ps1 - 注册定时任务，每小时自动更新课表
# 用法: .\setup-scheduler.ps1 学号 密码

param(
    [string]$Username,
    [string]$Password
)

$TaskName = "HBUST-CourseCrawler"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeExe = (Get-Command node -ErrorAction Stop).Source
$CrawlerJs = Join-Path $ScriptDir "crawler.js"

if (!$Username) { $Username = Read-Host "学号" }
if (!$Password) { $Password = Read-Host "密码" -AsSecureString; $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)) }

# 删除旧任务
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false

$Action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$CrawlerJs`" $Username $Password" -WorkingDirectory $ScriptDir
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "HBUST课程表每小时自动更新" -Force

Write-Host "`n已注册: $TaskName (每小时更新)"
Write-Host "输出: $ScriptDir\outputs\schedule.html"

# 手动运行一次验证
Write-Host "首次运行中..."
Start-ScheduledTask -TaskName $TaskName
Write-Host "完成。打开 outputs\schedule.html 查看"
