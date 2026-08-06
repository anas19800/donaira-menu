' تشغيل خادم المنيو في الخلفية (بدون نافذة)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\abdulrazaka\Cloude\Menu"
sh.Run "cmd /c node server.js", 0, False
