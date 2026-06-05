$source = "C:\Users\dhvnf\Downloads\NetaYumev35_pretrained_all_in_one.safetensors"
$dest = "C:\pinokio\api\comfy.git\app\models\checkpoints\NetaYumev35_pretrained_all_in_one.safetensors"

Write-Host "Starting watcher for $source..."
for ($i = 0; $i -lt 120; $i++) {
    if (Test-Path "$source.crdownload") {
        $size = (Get-Item "$source.crdownload").Length
        $sizeGB = [Math]::Round($size / 1GB, 2)
        Write-Host "Still downloading: $sizeGB GB..."
    } elseif (Test-Path $source) {
        Write-Host "Download complete! Moving file to ComfyUI checkpoints..."
        Move-Item -Path $source -Destination $dest -Force
        Write-Host "File successfully moved to $dest"
        break
    } else {
        Write-Host "Waiting for download to start or complete (Model already exists at destination, but waiting to overwrite with the new one if downloaded)..."
    }
    Start-Sleep -Seconds 15
}
