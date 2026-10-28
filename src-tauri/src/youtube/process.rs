use super::jobs::Job;
use std::process::Command;
pub(super) fn run(job: &Job, command: &str, args: &[&str]) -> Result<std::process::Output, String> {
    use std::io::Read;
    job.check()?;
    let mut command_builder = Command::new(command);
    command_builder
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command_builder.creation_flags(0x08000000);
    }
    let mut child = command_builder
        .spawn()
        .map_err(|e| format!("Não foi possível executar {command}: {e}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("Saída do processo indisponível.")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("Erro do processo indisponível.")?;
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let mut canceled = false;
    let status = loop {
        if job.check().is_err() {
            canceled = true;
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .output();
            }
            let _ = child.kill();
            break child.wait().map_err(|e| e.to_string())?;
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    let stdout = out
        .join()
        .map_err(|_| "Falha ao ler saída.".to_string())?
        .map_err(|e| e.to_string())?;
    let stderr = err
        .join()
        .map_err(|_| "Falha ao ler erro.".to_string())?
        .map_err(|e| e.to_string())?;
    if canceled {
        return Err("Conversão cancelada.".to_string());
    }
    let output = std::process::Output {
        status,
        stdout,
        stderr,
    };
    if output.status.success() {
        Ok(output)
    } else {
        Err(format!(
            "{command} terminou com erro: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

pub(super) fn output_text(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}
