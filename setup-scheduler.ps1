# setup-scheduler.ps1 - 注册定时任务，每小时自动更新课表
# 用法: 右键 → 使用PowerShell运行，输入学号密码
#       或在终端: .\setup-scheduler.ps1 学号 密码

param(
    [string]$Username,
    [string]$Password
)

$TaskName = "HBUST-CourseCrawler"
$ScriptDir = $PSScriptRoot
$NodeExe = (Get-Command node -ErrorAction Stop).Source
$CrawlerJs = Join-Path $ScriptDir "crawler.js"

# 交互式输入
if (!$Username) { $Username = Read-Host "学号" }
if (!$Password) { $Password = Read-Host "密码" -AsSecureString; $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)) }

# 删除旧任务
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false

# 创建
$Action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$CrawlerJs`" $Username $Password" -WorkingDirectory $ScriptDir
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([TimeSpan]::MaxValue)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "HBUST课程表每小时自动更新" -Force
Start-ScheduledTask -TaskName $TaskName

Write-Host "`n✅ 已注册: $TaskName (每小时更新)"
Write-Host "   输出: $ScriptDir\outputs\schedule.html"
