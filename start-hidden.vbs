Set WshShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' 현재 스크립트가 실행된 폴더 경로를 가져옵니다.
strFolder = objFSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strFolder

' auto-run.bat 파일을 화면에 표시하지 않고(0) 백그라운드 환경에서 실행합니다.
WshShell.Run "cmd.exe /c auto-run.bat", 0, False
