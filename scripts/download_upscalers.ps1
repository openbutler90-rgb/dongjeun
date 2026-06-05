$destDir = "C:\pinokio\api\comfy.git\app\models\upscale_models"

if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Write-Host "Created destination folder: $destDir"
}

$upscalers = @{
    "4x_AnimeSharp.pth" = "https://huggingface.co/Airic/mirrors/resolve/main/4x_AnimeSharp.pth"
    "RealESRGAN_x4plus_anime_6B.pth" = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
    "4x_NMKD-Superscale-SP_178000_G.pth" = "https://huggingface.co/uwg/upscaler/resolve/main/ESRGAN/4x_NMKD-Superscale-SP_178000_G.pth"
    "4x_NMKD-UltraYandere-Lite_280k.pth" = "https://huggingface.co/JCTN/ESRGAN/resolve/main/4x_NMKD-UltraYandere-Lite_280k.pth"
}

foreach ($filename in $upscalers.Keys) {
    $url = $upscalers[$filename]
    $targetPath = Join-Path $destDir $filename
    
    $exists = Test-Path $targetPath
    $isInvalid = $false
    if ($exists) {
        $size = (Get-Item $targetPath).Length
        if ($size -lt 1024) {
            $isInvalid = $true
            Write-Host "Model $filename exists but is invalid (size: $size bytes). Redownloading."
            Remove-Item $targetPath -Force
        }
    }
    
    if ($exists -and -not $isInvalid) {
        Write-Host "Model $filename already exists at $targetPath (size: $((Get-Item $targetPath).Length) bytes). Skipping."
    } else {
        Write-Host "Downloading $filename from $url..."
        try {
            curl.exe -L -o $targetPath $url
            if (Test-Path $targetPath) {
                Write-Host "Successfully downloaded $filename to $targetPath"
            } else {
                throw "File not found after download"
            }
        } catch {
            $err = $_.ToString()
            Write-Warning "Failed downloading $filename - Error: $err"
            Write-Host "Trying fallback download method..."
            try {
                Invoke-WebRequest -Uri $url -OutFile $targetPath -UseBasicParsing
                Write-Host "Successfully downloaded $filename via fallback method"
            } catch {
                Write-Error "All download methods failed for $filename"
            }
        }
    }
}
