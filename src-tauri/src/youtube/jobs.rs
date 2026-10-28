use tauri::{AppHandle, Emitter};
#[derive(Clone, Default)]
pub struct Jobs(std::sync::Arc<(std::sync::Mutex<JobState>, std::sync::Condvar)>);
#[derive(Default)]
struct JobState {
    active: Option<(String, std::sync::Arc<std::sync::atomic::AtomicBool>)>,
    canceled: std::collections::VecDeque<String>,
    shutting_down: bool,
}
pub struct Job {
    id: String,
    canceled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    jobs: Jobs,
}
impl Jobs {
    pub fn start(&self, id: String) -> Result<Job, String> {
        if id.is_empty() || id.len() > 100 {
            return Err("Identificador de operação inválido.".to_string());
        }
        let mut state = self.0 .0.lock().map_err(|e| e.to_string())?;
        if state.shutting_down || state.canceled.contains(&id) {
            return Err("Conversão cancelada.".to_string());
        }
        if state.active.is_some() {
            return Err(
                "Já existe uma conversão em andamento. Aguarde seu encerramento.".to_string(),
            );
        }
        let canceled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        state.active = Some((id.clone(), canceled.clone()));
        Ok(Job {
            id,
            canceled,
            jobs: self.clone(),
        })
    }
    pub fn cancel(&self, id: &str) {
        if let Ok(mut state) = self.0 .0.lock() {
            if let Some((active, cancel)) = &state.active {
                if active == id {
                    cancel.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            }
            state.canceled.push_back(id.to_owned());
            while state.canceled.len() > 64 {
                state.canceled.pop_front();
            }
        }
    }
    pub fn cancel_all(&self) {
        if let Ok(state) = self.0 .0.lock() {
            if let Some((_, cancel)) = &state.active {
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
    }
    pub fn shutdown(&self) {
        if let Ok(mut state) = self.0 .0.lock() {
            state.shutting_down = true;
            if let Some((_, cancel)) = &state.active {
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            }
            // Give process cancellation and temporary-directory cleanup time to
            // finish before the desktop process exits.
            let _ = self
                .0
                 .1
                .wait_timeout_while(state, std::time::Duration::from_secs(10), |s| {
                    s.active.is_some()
                });
        }
    }
}
impl Job {
    pub fn check(&self) -> Result<(), String> {
        if self.canceled.load(std::sync::atomic::Ordering::SeqCst) {
            Err("Conversão cancelada.".to_string())
        } else {
            Ok(())
        }
    }
    pub(super) fn progress(&self, app: &AppHandle, stage: &str, percent: Option<f64>) {
        let _ = app.emit(
            "youtube-progress",
            serde_json::json!({"jobId":self.id,"stage":stage,"percent":percent}),
        );
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        if let Ok(mut state) = self.jobs.0 .0.lock() {
            if state.active.as_ref().is_some_and(|(id, _)| id == &self.id) {
                state.active = None;
                self.jobs.0 .1.notify_all();
            }
        }
    }
}
#[cfg(test)]
mod job_tests {
    use super::super::process::run;
    use super::*;
    #[test]
    fn only_one_job_can_run_and_cancellation_is_scoped() {
        let jobs = Jobs::default();
        let job = jobs.start("a".into()).unwrap();
        assert!(jobs.start("b".into()).is_err());
        jobs.cancel("other");
        assert!(job.check().is_ok());
        jobs.cancel("a");
        assert!(job.check().is_err());
        drop(job);
        assert!(jobs.start("b".into()).is_ok());
    }
    #[test]
    fn cancellation_before_start_and_shutdown_are_respected() {
        let jobs = Jobs::default();
        jobs.cancel("a");
        assert!(jobs.start("a".into()).is_err());
        let job = jobs.start("b".into()).unwrap();
        jobs.cancel_all();
        assert!(job.check().is_err());
    }
    #[cfg(windows)]
    #[test]
    fn canceled_child_process_is_reaped() {
        let jobs = Jobs::default();
        let job = jobs.start("process".into()).unwrap();
        let cancel = jobs.clone();
        let thread = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(100));
            cancel.cancel("process");
        });
        let start = std::time::Instant::now();
        let result = run(&job, "cmd.exe", &["/C", "ping -n 10 127.0.0.1 > NUL"]);
        thread.join().unwrap();
        assert!(result.unwrap_err().contains("cancelada"));
        assert!(start.elapsed() < std::time::Duration::from_secs(3));
    }
}

#[cfg(test)]
mod shutdown_tests {
    use super::*;
    #[test]
    fn shutdown_waits_for_job_cleanup_and_rejects_new_jobs() {
        let jobs = Jobs::default();
        let job = jobs.start("shutdown".into()).unwrap();
        let cleanup = std::thread::spawn(move || {
            while job.check().is_ok() {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
            drop(job);
        });
        jobs.shutdown();
        assert!(jobs.0 .0.lock().unwrap().active.is_none());
        assert!(jobs.start("late".into()).is_err());
        cleanup.join().unwrap();
    }
}
