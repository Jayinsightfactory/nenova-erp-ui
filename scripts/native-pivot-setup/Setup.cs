using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Reflection;
using System.Windows.Forms;

public static class Installer {
    public const string Original = "4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63";
    public const string Updated = "FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79";
    public static string Hash(byte[] bytes) { using(var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", ""); }
    public static string HashFile(string path) { return Hash(File.ReadAllBytes(path)); }
    public static byte[] Payload() {
        using(var input = Assembly.GetExecutingAssembly().GetManifestResourceStream("Nenova.Payload"))
        using(var output = new MemoryStream()) { if(input == null) throw new Exception("설치 파일이 손상되었습니다."); input.CopyTo(output); return output.ToArray(); }
    }
    public static bool Running() {
        // Fail closed across all sessions, including processes whose path is inaccessible.
        var processes = Process.GetProcessesByName("Nenova");
        try { return processes.Length != 0; } finally { foreach(var process in processes) process.Dispose(); }
    }
    public static string Install(string selected, byte[] payload, Func<bool> running) {
        if(Hash(payload) != Updated) throw new Exception("설치 파일 검증에 실패했습니다. 파일을 다시 받아 주세요.");
        string target = Path.GetFullPath(selected);
        if(!String.Equals(Path.GetFileName(target), "Nenova.exe", StringComparison.OrdinalIgnoreCase)) throw new Exception("기존 Nenova.exe 파일을 선택해 주세요.");
        if(!File.Exists(target)) throw new Exception("기존 네노바가 설치되어 있지 않습니다. 설치 위치를 다시 선택해 주세요.");
        string current = HashFile(target);
        if(current == Updated) return "이미 업데이트된 버전입니다.\r\n기존 네노바 바로가기로 실행해 주세요.";
        if(current != Original) throw new Exception("이 PC의 네노바 버전은 이번 설치 대상과 다릅니다. 기존 파일은 변경하지 않았습니다. 담당자에게 버전 확인을 요청해 주세요.");
        if(running()) throw new Exception("이 PC에서 NENOVA.EXE가 실행 중입니다.\r\n작업을 저장하고 네노바를 완전히 닫은 뒤 다시 설치를 눌러 주세요.\r\n다른 직원 PC는 계속 사용해도 됩니다.");
        string suffix = DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N");
        string stage = target + ".pending-" + suffix;
        string backup = target + ".before-signed-pivot-" + suffix + ".bak";
        bool replaced = false;
        try {
            using(var output = new FileStream(stage, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { output.Write(payload, 0, payload.Length); output.Flush(true); }
            if(HashFile(stage) != Updated) throw new Exception("임시 설치 파일 검증에 실패했습니다.");
            if(running() || HashFile(target) != Original) throw new Exception("네노바 실행 또는 파일 변경이 감지되었습니다. 닫은 뒤 다시 시도해 주세요.");
            File.Replace(stage, target, backup);
            replaced = true;
            if(HashFile(target) != Updated || HashFile(backup) != Original) throw new Exception("설치 후 파일 검증에 실패했습니다.");
            return "설치가 완료되었습니다.\r\n기존 네노바 바로가기로 다시 실행해 주세요.\r\n\r\n모든 차수·국가의 음수 주문이 피벗에 표시되고 합계에서 차감됩니다.\r\n\r\n원본 백업: " + backup;
        } catch(Exception failure) {
            if(replaced) {
                try {
                    if(HashFile(backup) != Original) throw new Exception("원본 백업 검증 실패");
                    File.Replace(backup, target, target + ".failed-" + suffix);
                    if(HashFile(target) != Original) throw new Exception("복원 검증 실패");
                } catch(Exception restore) { throw new Exception("설치 및 자동 복원에 실패했습니다. 프로그램을 실행하지 말고 담당자에게 알려 주세요.\r\n백업: " + backup + "\r\n" + restore.Message, failure); }
                throw new Exception("설치에 실패하여 이전 버전으로 복원했습니다.\r\n" + failure.Message, failure);
            }
            throw;
        } finally {
            // Only this invocation's uniquely created stage; never remove backups.
            if(File.Exists(stage)) { try { File.Delete(stage); } catch { } }
        }
    }
}

public sealed class SetupForm : Form {
    readonly TextBox path = new TextBox();
    readonly TextBox status = new TextBox();
    readonly Button install = new Button();
    readonly Button browse = new Button();
    readonly Button close = new Button();
    public SetupForm() {
        Text = "네노바 피벗 업데이트 설치";
        Font = new Font("맑은 고딕", 10);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(700, 450); MinimumSize = new Size(580, 410);
        StartPosition = FormStartPosition.CenterScreen;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 1, RowCount = 5 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(new Label { Text = "음수 주문도 피벗에 표시되도록 업데이트합니다.", AutoSize = true, Dock = DockStyle.Fill, Font = new Font(Font, FontStyle.Bold), Padding = new Padding(0,0,0,14) });
        layout.Controls.Add(new Label { Text = "이 PC의 NENOVA.EXE만 저장 후 닫아 주세요.\r\n기존 설치 파일을 백업하며, 업무 데이터는 변경하지 않습니다.", AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(0,0,0,14) });
        var chooser = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, TabIndex = 0 };
        chooser.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); chooser.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        path.Dock = DockStyle.Fill; path.AccessibleName = "기존 네노바 실행 파일 위치"; path.TabIndex = 0;
        path.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Wooribnc\Nenova\Nenova.exe");
        browse.Text = "위치 찾기(&B)"; browse.AutoSize = true; browse.TabIndex = 1;
        browse.Click += delegate { using(var dialog = new OpenFileDialog { Filter = "네노바 실행 파일|Nenova.exe", CheckFileExists = true, Title = "기존 Nenova.exe 선택" }) if(dialog.ShowDialog(this) == DialogResult.OK) path.Text = dialog.FileName; };
        chooser.Controls.Add(path); chooser.Controls.Add(browse); layout.Controls.Add(chooser);
        status.Multiline = true; status.ReadOnly = true; status.ScrollBars = ScrollBars.Vertical; status.Dock = DockStyle.Fill; status.TabIndex = 1;
        status.Text = File.Exists(path.Text) ? "설치 위치를 확인했습니다. 아래 설치 버튼을 눌러 주세요." : "기존 설치 위치를 찾지 못했습니다. ‘위치 찾기’로 Nenova.exe를 선택해 주세요.";
        layout.Controls.Add(status);
        var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, TabIndex = 2 };
        install.Text = "설치(&I)"; install.AutoSize = true; install.TabIndex = 0;
        close.Text = "닫기(&C)"; close.AutoSize = true; close.TabIndex = 1; close.Click += delegate { Close(); };
        install.Click += delegate {
            install.Enabled = browse.Enabled = path.Enabled = false;
            UseWaitCursor = true;
            try { status.Text = Installer.Install(path.Text, Installer.Payload(), Installer.Running); install.Visible = false; AcceptButton = close; close.Focus(); }
            catch(Exception error) { status.Text = "설치하지 못했습니다.\r\n" + error.Message; install.Enabled = browse.Enabled = path.Enabled = true; }
            finally { UseWaitCursor = false; }
        };
        buttons.Controls.Add(install); buttons.Controls.Add(close); layout.Controls.Add(buttons); Controls.Add(layout);
        AcceptButton = install; CancelButton = close;
    }
    [STAThread] public static void Main() {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) { MessageBox.Show("마우스 오른쪽 버튼 → 관리자 권한으로 실행해 주세요."); return; }
        Application.Run(new SetupForm());
    }
}
