use std::sync::atomic::{AtomicBool, Ordering};
use tokio::process::Command;

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn configure_background_command(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

pub fn configure_std_background_command(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// Guard that binds a spawned child process to a Windows Job Object configured with
/// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, ensuring yt-dlp and any grandchild ffmpeg
/// processes terminate cleanly when cancelled or when the application exits.
pub struct ProcessGuard {
    #[cfg(windows)]
    job_handle: isize,
    terminated: AtomicBool,
}

impl ProcessGuard {
    #[cfg(windows)]
    pub fn attach(child: &tokio::process::Child) -> Self {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if !job.is_null() {
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
                let _ = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    size,
                );
                if let Some(raw_handle) = child.raw_handle() {
                    let _ = AssignProcessToJobObject(job, raw_handle as HANDLE);
                }
                Self {
                    job_handle: job as isize,
                    terminated: AtomicBool::new(false),
                }
            } else {
                Self {
                    job_handle: 0,
                    terminated: AtomicBool::new(false),
                }
            }
        }
    }

    #[cfg(not(windows))]
    pub fn attach(_child: &tokio::process::Child) -> Self {
        Self {
            terminated: AtomicBool::new(false),
        }
    }

    pub fn terminate(&self) {
        if self.terminated.swap(true, Ordering::SeqCst) {
            return;
        }
        #[cfg(windows)]
        {
            if self.job_handle != 0 {
                unsafe {
                    let handle = self.job_handle as HANDLE;
                    let _ = TerminateJobObject(handle, 1);
                }
            }
        }
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            if self.job_handle != 0 {
                unsafe {
                    let _ = CloseHandle(self.job_handle as HANDLE);
                }
                self.job_handle = 0;
            }
        }
    }
}

#[cfg(windows)]
#[allow(dead_code)]
fn _assert_raw_handle_usable(file: &std::fs::File) -> HANDLE {
    file.as_raw_handle() as HANDLE
}
