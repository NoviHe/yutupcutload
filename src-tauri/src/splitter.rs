use std::path::{Path, PathBuf};

use regex::Regex;

use crate::models::{AutoSplitParams, BulkParseLineError, BulkParseResult, GeneratedClip};

const MAX_AUTO_SPLIT_CLIPS: usize = 500;

#[derive(Debug, Clone, PartialEq)]
pub enum ParsedProgress {
    Download {
        percent: f64,
        downloaded_bytes: Option<u64>,
        speed: Option<String>,
        eta: Option<String>,
    },
    Postprocess {
        status: String,
        postprocessor: String,
    },
    Ffmpeg {
        percent: f64,
        speed: Option<String>,
    },
}

pub fn parse_timestamp(raw: &str) -> Result<f64, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Timestamp kosong".to_string());
    }
    if trimmed.starts_with('-') {
        return Err(format!("Timestamp tidak boleh negatif: {trimmed}"));
    }

    let parts: Vec<&str> = trimmed.split(':').collect();
    let total = match parts.len() {
        1 => {
            let secs: f64 = parts[0]
                .parse()
                .map_err(|_| format!("Format detik tidak valid: {trimmed}"))?;
            secs
        }
        2 => {
            let mins: u64 = parts[0]
                .parse()
                .map_err(|_| format!("Menit tidak valid: {trimmed}"))?;
            let secs: f64 = parts[1]
                .parse()
                .map_err(|_| format!("Detik tidak valid: {trimmed}"))?;
            if mins >= 60 {
                return Err(format!("Menit harus < 60 pada format MM:SS: {trimmed}"));
            }
            if !secs.is_finite() || secs < 0.0 || secs >= 60.0 {
                return Err(format!("Detik harus di antara 0 dan < 60: {trimmed}"));
            }
            (mins as f64) * 60.0 + secs
        }
        3 => {
            let hours: u64 = parts[0]
                .parse()
                .map_err(|_| format!("Jam tidak valid: {trimmed}"))?;
            let mins: u64 = parts[1]
                .parse()
                .map_err(|_| format!("Menit tidak valid: {trimmed}"))?;
            let secs: f64 = parts[2]
                .parse()
                .map_err(|_| format!("Detik tidak valid: {trimmed}"))?;
            if mins >= 60 {
                return Err(format!("Menit harus < 60: {trimmed}"));
            }
            if !secs.is_finite() || secs < 0.0 || secs >= 60.0 {
                return Err(format!("Detik harus di antara 0 dan < 60: {trimmed}"));
            }
            (hours as f64) * 3600.0 + (mins as f64) * 60.0 + secs
        }
        _ => {
            return Err(format!(
                "Format timestamp tidak dikenal (gunakan HH:MM:SS atau MM:SS): {trimmed}"
            ));
        }
    };

    if !total.is_finite() || total < 0.0 {
        return Err(format!("Timestamp tidak valid: {trimmed}"));
    }

    Ok((total * 1000.0).round() / 1000.0)
}

pub fn format_timestamp(secs: f64) -> String {
    let safe = if secs.is_finite() && secs >= 0.0 {
        secs
    } else {
        0.0
    };
    let total_ms = (safe * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let total_secs = total_ms / 1000;
    let hours = total_secs / 3600;
    let mins = (total_secs % 3600) / 60;
    let rem_secs = total_secs % 60;

    if ms > 0 {
        format!("{hours:02}:{mins:02}:{rem_secs:02}.{ms:03}")
    } else {
        format!("{hours:02}:{mins:02}:{rem_secs:02}")
    }
}

pub fn format_filename_timestamp(secs: f64) -> String {
    let safe = if secs.is_finite() && secs >= 0.0 {
        secs
    } else {
        0.0
    };
    let total_secs = safe.round() as u64;
    let hours = total_secs / 3600;
    let mins = (total_secs % 3600) / 60;
    let rem_secs = total_secs % 60;
    format!("{hours:02}-{mins:02}-{rem_secs:02}")
}

pub fn validate_range(
    start: f64,
    end: f64,
    total_duration: Option<f64>,
) -> Result<(), String> {
    if !start.is_finite() || !end.is_finite() {
        return Err("Start dan End harus berupa angka valid".to_string());
    }
    if start < 0.0 {
        return Err("Waktu Start tidak boleh negatif".to_string());
    }
    if end <= start {
        return Err("Waktu End harus lebih besar dari Start".to_string());
    }
    if end - start < 0.5 {
        return Err("Durasi klip minimal 0.5 detik".to_string());
    }
    if let Some(dur) = total_duration {
        if dur.is_finite() && dur > 0.0 && end > dur + 0.5 {
            return Err(format!(
                "Waktu End ({}) melebihi durasi video ({})",
                format_timestamp(end),
                format_timestamp(dur)
            ));
        }
    }
    Ok(())
}

pub fn generate_auto_splits(params: &AutoSplitParams) -> Result<Vec<GeneratedClip>, String> {
    if !params.total_duration.is_finite() || params.total_duration <= 0.0 {
        return Err("Durasi total video tidak valid".to_string());
    }
    if !params.chunk_secs.is_finite() || params.chunk_secs < 1.0 {
        return Err("Durasi per bagian minimal 1 detik".to_string());
    }
    if !params.overlap_secs.is_finite() || params.overlap_secs < 0.0 {
        return Err("Overlap tidak boleh negatif".to_string());
    }
    if params.overlap_secs >= params.chunk_secs {
        return Err("Overlap harus lebih kecil dari durasi per bagian".to_string());
    }

    let range_start = params.range_start.unwrap_or(0.0).max(0.0);
    let range_end = params
        .range_end
        .unwrap_or(params.total_duration)
        .min(params.total_duration);

    validate_range(range_start, range_end, Some(params.total_duration))?;

    let prefix = if params.prefix.trim().is_empty() {
        "Part".to_string()
    } else {
        params.prefix.trim().to_string()
    };

    let mut clips = Vec::new();
    let mut cursor = range_start;
    let mut idx = 1usize;

    while cursor < range_end - 0.05 {
        if clips.len() >= MAX_AUTO_SPLIT_CLIPS {
            return Err(format!(
                "Jumlah hasil split melebihi batas aman ({MAX_AUTO_SPLIT_CLIPS} klip). Perbesar durasi per bagian atau perkecil rentang."
            ));
        }
        let end = (cursor + params.chunk_secs).min(range_end);
        if end - cursor >= 0.5 {
            clips.push(GeneratedClip {
                start_secs: (cursor * 1000.0).round() / 1000.0,
                end_secs: (end * 1000.0).round() / 1000.0,
                label: format!("{prefix} {idx:02}"),
            });
        }
        if end >= range_end - 0.01 {
            break;
        }
        let step = params.chunk_secs - params.overlap_secs;
        if step <= 0.1 {
            break;
        }
        cursor += step;
        idx += 1;
    }

    if clips.is_empty() {
        return Err("Tidak ada bagian klip yang dihasilkan dari rentang tersebut".to_string());
    }

    Ok(clips)
}

pub fn parse_bulk_timestamps(text: &str, total_duration: Option<f64>) -> BulkParseResult {
    let range_re = Regex::new(
        r"^\s*([0-9]+(?::[0-9]{1,2}){0,2}(?:\.[0-9]+)?)\s*(?:-|->|\.\.|to|sampai)\s*([0-9]+(?::[0-9]{1,2}){0,2}(?:\.[0-9]+)?)(?:\s*[|,;:-]?\s*(.*))?$",
    )
    .expect("valid bulk regex");

    let mut clips = Vec::new();
    let mut errors = Vec::new();

    for (idx, raw_line) in text.lines().enumerate() {
        let line_number = idx + 1;
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
            continue;
        }

        let Some(caps) = range_re.captures(trimmed) else {
            errors.push(BulkParseLineError {
                line_number,
                raw: raw_line.to_string(),
                error: "Format tidak cocok. Contoh: 01:10:00-01:15:30 Boss Fight".to_string(),
            });
            continue;
        };

        let start_str = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let end_str = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let label = caps
            .get(3)
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default();

        let start_secs = match parse_timestamp(start_str) {
            Ok(v) => v,
            Err(e) => {
                errors.push(BulkParseLineError {
                    line_number,
                    raw: raw_line.to_string(),
                    error: e,
                });
                continue;
            }
        };

        let end_secs = match parse_timestamp(end_str) {
            Ok(v) => v,
            Err(e) => {
                errors.push(BulkParseLineError {
                    line_number,
                    raw: raw_line.to_string(),
                    error: e,
                });
                continue;
            }
        };

        if let Err(e) = validate_range(start_secs, end_secs, total_duration) {
            errors.push(BulkParseLineError {
                line_number,
                raw: raw_line.to_string(),
                error: e,
            });
            continue;
        }

        clips.push(GeneratedClip {
            start_secs,
            end_secs,
            label,
        });
    }

    BulkParseResult { clips, errors }
}

pub fn sanitize_filename(name: &str, max_len: usize) -> String {
    let mut cleaned = String::with_capacity(name.len());
    let mut last_was_space = false;

    for ch in name.chars() {
        if ch.is_control() || matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            if !last_was_space {
                cleaned.push(' ');
                last_was_space = true;
            }
            continue;
        }
        if ch.is_whitespace() {
            if !last_was_space {
                cleaned.push(' ');
                last_was_space = true;
            }
        } else {
            cleaned.push(ch);
            last_was_space = false;
        }
    }

    let trimmed = cleaned.trim_matches(|c: char| c == ' ' || c == '.');
    let mut result: String = if max_len > 0 {
        trimmed.chars().take(max_len).collect()
    } else {
        trimmed.to_string()
    };
    result = result
        .trim_matches(|c: char| c == ' ' || c == '.')
        .to_string();

    if result.is_empty() {
        return "clip".to_string();
    }

    let upper = result.to_ascii_uppercase();
    let is_reserved = matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if is_reserved {
        result = format!("_{result}");
    }

    result
}

pub fn render_output_stem(
    template: &str,
    title: &str,
    index: usize,
    start: f64,
    end: f64,
    label: &str,
) -> String {
    let tpl = if template.trim().is_empty() {
        "{title}_{index}_{start}-{end}_{label}"
    } else {
        template.trim()
    };

    let safe_title = sanitize_filename(title, 65);
    let safe_label = if label.trim().is_empty() {
        String::new()
    } else {
        sanitize_filename(label, 50)
    };
    let start_str = format_filename_timestamp(start);
    let end_str = format_filename_timestamp(end);
    let index_str = format!("{index:02}");

    let raw = tpl
        .replace("{title}", &safe_title)
        .replace("{index}", &index_str)
        .replace("{start}", &start_str)
        .replace("{end}", &end_str)
        .replace("{label}", &safe_label);

    let collapsed = raw
        .replace("__", "_")
        .trim_matches(|c: char| c == '_' || c == '-' || c == ' ')
        .to_string();

    sanitize_filename(&collapsed, 150)
}

pub fn resolve_non_colliding_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let clean_ext = ext.trim_start_matches('.');
    let candidate = dir.join(format!("{stem}.{clean_ext}"));
    if !candidate.exists() {
        return candidate;
    }

    let mut counter = 1usize;
    loop {
        let next = dir.join(format!("{stem} ({counter}).{clean_ext}"));
        if !next.exists() {
            return next;
        }
        counter += 1;
    }
}

pub fn parse_progress_line(line: &str, clip_duration_secs: f64) -> Option<ParsedProgress> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix("YCL_PROG|") {
        let parts: Vec<&str> = rest.split('|').collect();
        if parts.len() >= 6 {
            let percent_raw = parts[0].trim().trim_end_matches('%').trim();
            let parsed_pct = percent_raw.parse::<f64>().ok();

            let downloaded = parts[1].trim().parse::<u64>().ok();
            let total = parts[2]
                .trim()
                .parse::<u64>()
                .ok()
                .or_else(|| parts[3].trim().parse::<u64>().ok());

            let percent = match (parsed_pct, downloaded, total) {
                (Some(p), _, _) if p.is_finite() => p.clamp(0.0, 100.0),
                (_, Some(dl), Some(tot)) if tot > 0 => {
                    ((dl as f64 / tot as f64) * 100.0).clamp(0.0, 100.0)
                }
                _ => 0.0,
            };

            let speed = parse_speed_field(parts[4]);
            let eta = parse_eta_field(parts[5]);

            return Some(ParsedProgress::Download {
                percent,
                downloaded_bytes: downloaded,
                speed,
                eta,
            });
        }
    }

    if let Some(rest) = trimmed.strip_prefix("YCL_PP|") {
        let parts: Vec<&str> = rest.split('|').collect();
        if parts.len() >= 2 {
            return Some(ParsedProgress::Postprocess {
                status: parts[0].trim().to_string(),
                postprocessor: parts[1].trim().to_string(),
            });
        }
    }

    if let Some(time_idx) = trimmed.find("time=") {
        let after = &trimmed[time_idx + 5..];
        let time_token = after.split_whitespace().next().unwrap_or("");
        if let Ok(current_secs) = parse_timestamp(time_token) {
            if clip_duration_secs.is_finite() && clip_duration_secs > 0.0 {
                let pct = ((current_secs / clip_duration_secs) * 100.0).clamp(0.0, 99.5);
                let speed = trimmed.find("speed=").and_then(|idx| {
                    let s = trimmed[idx + 6..].split_whitespace().next()?;
                    if s == "N/A" || s.is_empty() {
                        None
                    } else {
                        Some(s.to_string())
                    }
                });
                return Some(ParsedProgress::Ffmpeg { percent: pct, speed });
            }
        }
    }

    None
}

fn parse_speed_field(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "NA" || trimmed == "None" || trimmed == "N/A" {
        return None;
    }
    if let Ok(bytes_per_sec) = trimmed.parse::<f64>() {
        if bytes_per_sec.is_finite() && bytes_per_sec > 0.0 {
            if bytes_per_sec >= 1_048_576.0 {
                return Some(format!("{:.2} MiB/s", bytes_per_sec / 1_048_576.0));
            }
            if bytes_per_sec >= 1024.0 {
                return Some(format!("{:.1} KiB/s", bytes_per_sec / 1024.0));
            }
            return Some(format!("{:.0} B/s", bytes_per_sec));
        }
        return None;
    }
    Some(trimmed.to_string())
}

fn parse_eta_field(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "NA" || trimmed == "None" || trimmed == "N/A" {
        return None;
    }
    if let Ok(secs_f) = trimmed.parse::<f64>() {
        if secs_f.is_finite() && secs_f >= 0.0 {
            let secs = secs_f.round() as u64;
            if secs >= 3600 {
                return Some(format!(
                    "{:02}:{:02}:{:02}",
                    secs / 3600,
                    (secs % 3600) / 60,
                    secs % 60
                ));
            }
            return Some(format!("{:02}:{:02}", secs / 60, secs % 60));
        }
        return None;
    }
    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_parse_and_format_timestamp_11_hour_vod() {
        assert_eq!(parse_timestamp("11:02:45").unwrap(), 39765.0);
        assert_eq!(parse_timestamp("01:05:09.250").unwrap(), 3909.25);
        assert_eq!(parse_timestamp("05:30").unwrap(), 330.0);
        assert_eq!(parse_timestamp("45").unwrap(), 45.0);
        assert_eq!(format_timestamp(39765.0), "11:02:45");
        assert_eq!(format_timestamp(3909.25), "01:05:09.250");
        assert_eq!(format_filename_timestamp(39765.0), "11-02-45");

        assert!(parse_timestamp("-5").is_err());
        assert!(parse_timestamp("01:60:00").is_err());
        assert!(parse_timestamp("01:00:60").is_err());
        assert!(parse_timestamp("65:00").is_err());
        assert!(parse_timestamp("").is_err());
    }

    #[test]
    fn test_auto_split_with_overlap_and_subrange() {
        let params = AutoSplitParams {
            total_duration: 3600.0,
            range_start: Some(600.0),
            range_end: Some(1500.0),
            chunk_secs: 400.0,
            overlap_secs: 50.0,
            prefix: "Bagian".to_string(),
        };
        let clips = generate_auto_splits(&params).unwrap();
        assert_eq!(clips.len(), 3);
        assert_eq!(clips[0].start_secs, 600.0);
        assert_eq!(clips[0].end_secs, 1000.0);
        assert_eq!(clips[0].label, "Bagian 01");
        assert_eq!(clips[1].start_secs, 950.0);
        assert_eq!(clips[1].end_secs, 1350.0);
        assert_eq!(clips[2].start_secs, 1300.0);
        assert_eq!(clips[2].end_secs, 1500.0);
    }

    #[test]
    fn test_auto_split_rejects_bad_overlap() {
        let params = AutoSplitParams {
            total_duration: 600.0,
            range_start: None,
            range_end: None,
            chunk_secs: 60.0,
            overlap_secs: 60.0,
            prefix: "Part".to_string(),
        };
        assert!(generate_auto_splits(&params).is_err());
    }

    #[test]
    fn test_bulk_timestamp_parser_mixed_lines() {
        let input = r#"
        # Komentar diabaikan
        00:45:10-00:48:30 Boss Fight Phase 1
        03:12:00 - 03:15:45 | Momen Lucu
        invalid line here
        12:00:00-12:05:00 Melebihi durasi
        "#;
        let res = parse_bulk_timestamps(input, Some(39600.0));
        assert_eq!(res.clips.len(), 2);
        assert_eq!(res.errors.len(), 2);
        assert_eq!(res.clips[0].start_secs, 2710.0);
        assert_eq!(res.clips[0].end_secs, 2910.0);
        assert_eq!(res.clips[0].label, "Boss Fight Phase 1");
        assert_eq!(res.clips[1].label, "Momen Lucu");
    }

    #[test]
    fn test_sanitize_filename_and_windows_reserved() {
        assert_eq!(sanitize_filename("CON", 50), "_CON");
        assert_eq!(sanitize_filename("nul", 50), "_nul");
        assert_eq!(
            sanitize_filename("Live: 11 Jam / Part *1*? <Test>", 100),
            "Live 11 Jam Part 1 Test"
        );
        assert_eq!(sanitize_filename("...", 50), "clip");
        let stem = render_output_stem(
            "{title}_{index}_{start}-{end}_{label}",
            "Stream: Hari 1",
            3,
            3600.0,
            3900.0,
            "",
        );
        assert_eq!(stem, "Stream Hari 1_03_01-00-00-01-05-00");
    }

    #[test]
    fn test_resolve_non_colliding_path() {
        let dir = std::env::temp_dir().join(format!("ycl_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let first = resolve_non_colliding_path(&dir, "clip", "mp4");
        assert_eq!(first.file_name().unwrap(), "clip.mp4");
        fs::write(&first, b"test").unwrap();

        let second = resolve_non_colliding_path(&dir, "clip", "mp4");
        assert_eq!(second.file_name().unwrap(), "clip (1).mp4");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_parse_progress_lines() {
        let p1 = parse_progress_line(
            "YCL_PROG| 45.2%|47395635|104857600|NA|5242880|11",
            120.0,
        );
        assert_eq!(
            p1,
            Some(ParsedProgress::Download {
                percent: 45.2,
                downloaded_bytes: Some(47395635),
                speed: Some("5.00 MiB/s".to_string()),
                eta: Some("00:11".to_string()),
            })
        );

        let p2 = parse_progress_line("YCL_PP|started|Merger", 120.0);
        assert_eq!(
            p2,
            Some(ParsedProgress::Postprocess {
                status: "started".to_string(),
                postprocessor: "Merger".to_string(),
            })
        );

        let p3 = parse_progress_line(
            "frame=  600 fps=120 q=28.0 size=    4096kB time=00:00:30.00 bitrate=1118.4kbits/s speed=4.5x",
            60.0,
        );
        assert_eq!(
            p3,
            Some(ParsedProgress::Ffmpeg {
                percent: 50.0,
                speed: Some("4.5x".to_string()),
            })
        );
    }
}
