' تشغيل الخادم إن لم يكن شغالاً ثم فتح لوحة التحكم
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\abdulrazaka\Cloude\Menu"
sh.Run "cmd /c node server.js", 0, False
WScript.Sleep 1800
sh.Run "http://localhost:3000/admin"
