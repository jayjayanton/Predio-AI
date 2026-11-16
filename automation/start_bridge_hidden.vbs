Option Explicit
Dim shell, fs, base, command
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
base = fs.GetParentFolderName(WScript.ScriptFullName)
command = "cmd.exe /c py " & Chr(34) & fs.BuildPath(base, "irm_bridge.py") & Chr(34)
shell.Run command, 0, False
