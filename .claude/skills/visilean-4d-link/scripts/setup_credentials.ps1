# Stores VisiLean MCP credentials for ONE workspace as Windows user environment variables.
# Input is hidden, nothing is printed back and nothing is written to a file.
# The person who owns the credentials runs this themselves in a PowerShell window:
#
#   powershell -ExecutionPolicy Bypass -File setup_credentials.ps1 -Prefix VL_TATA -Workspace "Tata Projects Ltd"
#
# Creates <Prefix>_CLIENT_ID, <Prefix>_CLIENT_SECRET, <Prefix>_MCP_KEY.
# Shape check (catches the common paste mix-up): Client ID = 36-char GUID, MCP Key = ~75 chars "xxxxx_xxxx_...".
param([string]$Prefix = "VL", [string]$Workspace = "your VisiLean workspace")

$vars = [ordered]@{ "${Prefix}_CLIENT_ID" = "Client ID"; "${Prefix}_CLIENT_SECRET" = "Client Secret"; "${Prefix}_MCP_KEY" = "MCP Key" }
foreach ($name in $vars.Keys) {
    $secure = Read-Host -AsSecureString "Paste the $($vars[$name]) for $Workspace"
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim()
        if (-not $plain) { Write-Warning "$name left empty - skipped"; continue }
        if ($name -like "*_CLIENT_ID" -and $plain -notmatch '^[0-9A-Fa-f-]{36}$') { Write-Warning "That does not look like a Client ID (expected a 36-char GUID). Check you did not paste the MCP Key." }
        if ($name -like "*_MCP_KEY" -and $plain.Length -lt 50) { Write-Warning "That looks short for an MCP Key (expected ~75 chars). Check you did not paste the Client ID." }
        [Environment]::SetEnvironmentVariable($name, $plain, 'User')
        Write-Host "$name saved." -ForegroundColor Green
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $plain = $null }
}
Write-Host "`nDone. Restart Claude (desktop app or terminal) so new sessions can see the variables." -ForegroundColor Cyan
