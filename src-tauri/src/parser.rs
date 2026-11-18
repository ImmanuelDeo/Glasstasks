use crate::models::{
    CheckboxStatus, PriorityLevel, SourceAnchor, TaskItem, TaskPatchRequest,
};
use chrono::NaiveDate;
use once_cell::sync::Lazy;
use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

static FENCE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(`{3,}|~{3,})(.*)$").unwrap());
static HEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(#{1,6}\s+.+)$").unwrap());
static TASK_LINE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^([ \t]*)([-*+]|\d+\.)\s+\[(.)\]\s+(.*)$").unwrap());

static DUE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"📅\s*(\d{4}-\d{2}-\d{2}|\S+)").unwrap());
static SCHEDULED_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"⏳\s*(\d{4}-\d{2}-\d{2})").unwrap());
static START_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"🛫\s*(\d{4}-\d{2}-\d{2})").unwrap());
static DONE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"✅\s*(\d{4}-\d{2}-\d{2})").unwrap());
static CREATED_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"➕\s*(\d{4}-\d{2}-\d{2})").unwrap());
static RECURRENCE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"🔁\s*([^📅⏳🛫✅➕🔺⏫🔼🔽⏬#\[\]]*)").unwrap());
static TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:^|\s)(#[a-zA-Z0-9_\-/]+)").unwrap());
static WIKILINK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[\[[^\]]+\]\]").unwrap());
static MDLINK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[[^\]]+\]\([^\)]+\)").unwrap());
static DATAVIEW_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[[a-zA-Z0-9_\-]+::[^\]]+\]").unwrap());
static BLOCK_ID_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:\s)(\^[a-zA-Z0-9\-]+)\s*$").unwrap());

pub fn compute_sha256(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn detect_line_ending(content: &str) -> &'static str {
    if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

pub fn is_valid_calendar_date(date_str: &str) -> bool {
    if date_str.len() != 10 {
        return false;
    }
    NaiveDate::parse_from_str(date_str, "%Y-%m-%d").is_ok()
}

/// Splits content into lines while recording exact byte offsets and preserving line endings.
pub fn split_lines_with_offsets(content: &str) -> Vec<(&str, usize, usize)> {
    let mut result = Vec::new();
    let bytes = content.as_bytes();
    let mut start = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            let line_end = if i > start && bytes[i - 1] == b'\r' {
                i - 1
            } else {
                i
            };
            result.push((&content[start..line_end], start, line_end));
            start = i + 1;
        }
        i += 1;
    }
    if start < bytes.len() {
        result.push((&content[start..bytes.len()], start, bytes.len()));
    } else if content.ends_with('\n') {
        // Trailing empty line is not a task, no need to push phantom task
    }
    result
}

pub fn parse_markdown_tasks(
    relative_path: &str,
    content: &str,
    custom_status_map: &HashMap<String, String>,
) -> Vec<TaskItem> {
    let file_hash = compute_sha256(content);
    let lines_with_offsets = split_lines_with_offsets(content);
    let plain_lines: Vec<String> = lines_with_offsets
        .iter()
        .map(|(l, _, _)| (*l).to_string())
        .collect();

    let mut tasks = Vec::new();
    let mut in_code_fence = false;
    let mut current_fence_marker = String::new();
    let mut current_heading: Option<String> = None;
    let mut occurrence_counter: HashMap<String, usize> = HashMap::new();

    for (idx, (raw_line, byte_start, byte_end)) in lines_with_offsets.iter().enumerate() {
        let line_number = idx + 1;

        // 1. Check fenced code blocks (including ```tasks, ```dataview, ~~~)
        if let Some(caps) = FENCE_RE.captures(raw_line) {
            let marker = caps.get(1).unwrap().as_str();
            let marker_char = marker.chars().next().unwrap();
            if !in_code_fence {
                in_code_fence = true;
                current_fence_marker = marker_char.to_string();
                continue;
            } else if current_fence_marker.starts_with(marker_char) {
                in_code_fence = false;
                current_fence_marker.clear();
                continue;
            }
        }

        if in_code_fence {
            continue;
        }

        // 2. Track nearest Markdown heading context
        if let Some(h_caps) = HEADING_RE.captures(raw_line) {
            current_heading = Some(h_caps.get(1).unwrap().as_str().trim().to_string());
            continue;
        }

        // 3. Match Markdown checkbox task
        if let Some(t_caps) = TASK_LINE_RE.captures(raw_line) {
            let indent = t_caps.get(1).unwrap().as_str().to_string();
            let bullet_marker = t_caps.get(2).unwrap().as_str().to_string();
            let checkbox_char = t_caps.get(3).unwrap().as_str().to_string();
            let body = t_caps.get(4).unwrap().as_str();

            let nesting_level = indent
                .chars()
                .fold(0usize, |acc, c| acc + if c == '\t' { 2 } else { 1 })
                / 2;

            let occ_idx = *occurrence_counter.get(*raw_line).unwrap_or(&0);
            occurrence_counter.insert((*raw_line).to_string(), occ_idx + 1);

            // Context lines before and after
            let mut context_before = Vec::new();
            if idx >= 2 {
                context_before.push(plain_lines[idx - 2].clone());
            }
            if idx >= 1 {
                context_before.push(plain_lines[idx - 1].clone());
            }
            let mut context_after = Vec::new();
            if idx + 1 < plain_lines.len() {
                context_after.push(plain_lines[idx + 1].clone());
            }
            if idx + 2 < plain_lines.len() {
                context_after.push(plain_lines[idx + 2].clone());
            }

            // Determine status & custom status handling
            let (status, mut is_read_only, mut read_only_reason) = match checkbox_char.as_str() {
                " " => (CheckboxStatus::Todo, false, None),
                "x" | "X" => (CheckboxStatus::Done, false, None),
                other => {
                    if let Some(mapped) = custom_status_map.get(other) {
                        match mapped.as_str() {
                            "todo" => (CheckboxStatus::Todo, false, None),
                            "done" => (CheckboxStatus::Done, false, None),
                            _ => (
                                CheckboxStatus::Custom(other.to_string()),
                                true,
                                Some(format!(
                                    "Status khusus '[{}]' ditampilkan sebagai baca-saja",
                                    other
                                )),
                            ),
                        }
                    } else {
                        (
                            CheckboxStatus::Custom(other.to_string()),
                            true,
                            Some(format!(
                                "Custom checkbox '[{}]' belum dipetakan; ditampilkan baca-saja",
                                other
                            )),
                        )
                    }
                }
            };

            // Extract dates
            let mut due_date = None;
            let mut has_invalid_due_date = false;
            let mut raw_invalid_due_date = None;
            if let Some(d_caps) = DUE_RE.captures(body) {
                let token = d_caps.get(1).unwrap().as_str().to_string();
                if is_valid_calendar_date(&token) {
                    due_date = Some(token);
                } else {
                    has_invalid_due_date = true;
                    raw_invalid_due_date = Some(token);
                }
            }

            let scheduled_date = SCHEDULED_RE
                .captures(body)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .filter(|d| is_valid_calendar_date(d));

            let start_date = START_RE
                .captures(body)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .filter(|d| is_valid_calendar_date(d));

            let done_date = DONE_RE
                .captures(body)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .filter(|d| is_valid_calendar_date(d));

            let created_date = CREATED_RE
                .captures(body)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .filter(|d| is_valid_calendar_date(d));

            // Recurrence detection
            let mut is_recurring = false;
            let mut recurrence_rule = None;
            if body.contains('🔁') {
                is_recurring = true;
                if let Some(r_caps) = RECURRENCE_RE.captures(body) {
                    let rule_str = r_caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
                    recurrence_rule = Some(if rule_str.is_empty() {
                        "🔁".to_string()
                    } else {
                        format!("🔁 {}", rule_str)
                    });
                } else {
                    recurrence_rule = Some("🔁".to_string());
                }
                is_read_only = true;
                read_only_reason = Some(
                    "Task berulang (🔁) bersifat baca-saja pada MVP agar tidak merusak aturan recurrence Obsidian Tasks".to_string(),
                );
            }

            // Priority detection
            let priority = if body.contains('🔺') {
                PriorityLevel::Highest
            } else if body.contains('⏫') {
                PriorityLevel::High
            } else if body.contains('🔼') {
                PriorityLevel::Medium
            } else if body.contains('🔽') {
                PriorityLevel::Low
            } else if body.contains('⏬') {
                PriorityLevel::Lowest
            } else {
                PriorityLevel::None
            };

            // Links (wikilinks and markdown links)
            let mut links = Vec::new();
            for m in WIKILINK_RE.find_iter(body) {
                links.push(m.as_str().to_string());
            }
            for m in MDLINK_RE.find_iter(body) {
                links.push(m.as_str().to_string());
            }

            // Tags (ignore tags inside links)
            let body_without_links = WIKILINK_RE.replace_all(body, " ");
            let body_without_links = MDLINK_RE.replace_all(&body_without_links, " ");
            let mut tags = Vec::new();
            for cap in TAG_RE.captures_iter(&body_without_links) {
                let tag = cap.get(1).unwrap().as_str().to_string();
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
            }

            // Unrecognized metadata (Dataview fields, block IDs)
            let mut unrecognized_metadata = Vec::new();
            for m in DATAVIEW_RE.find_iter(body) {
                unrecognized_metadata.push(m.as_str().to_string());
            }
            if let Some(b_cap) = BLOCK_ID_RE.captures(body) {
                unrecognized_metadata.push(b_cap.get(1).unwrap().as_str().to_string());
            }

            // Compute clean display title while preserving inline links and text
            let display_title = extract_clean_display_title(body);

            let id = format!("{}::L{}::occ{}", relative_path, line_number, occ_idx);

            tasks.push(TaskItem {
                id,
                raw_line: (*raw_line).to_string(),
                relative_path: relative_path.to_string(),
                heading_context: current_heading.clone(),
                anchor: SourceAnchor {
                    line_number,
                    byte_start: *byte_start,
                    byte_end: *byte_end,
                    file_hash: file_hash.clone(),
                    duplicate_occurrence_index: occ_idx,
                    context_before,
                    context_after,
                },
                indent,
                nesting_level,
                bullet_marker,
                checkbox_char,
                status,
                display_title,
                due_date,
                has_invalid_due_date,
                raw_invalid_due_date,
                scheduled_date,
                start_date,
                done_date,
                created_date,
                priority,
                recurrence_rule,
                is_recurring,
                is_read_only,
                read_only_reason,
                tags,
                links,
                unrecognized_metadata,
                conflict_info: None,
            });
        }
    }

    tasks
}

pub fn extract_clean_display_title(body: &str) -> String {
    let mut s = body.to_string();
    s = DUE_RE.replace_all(&s, "").to_string();
    s = SCHEDULED_RE.replace_all(&s, "").to_string();
    s = START_RE.replace_all(&s, "").to_string();
    s = DONE_RE.replace_all(&s, "").to_string();
    s = CREATED_RE.replace_all(&s, "").to_string();
    s = RECURRENCE_RE.replace_all(&s, "").to_string();
    for p in ['🔺', '⏫', '🔼', '🔽', '⏬'] {
        s = s.replace(p, "");
    }
    s = BLOCK_ID_RE.replace_all(&s, "").to_string();
    // Remove standalone tags from display title while keeping inline text & links readable
    s = TAG_RE.replace_all(&s, "").to_string();
    // Collapse multiple spaces
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        body.trim().to_string()
    } else {
        collapsed
    }
}

/// Applies a minimal surgical patch to a single task raw line, preserving indentation,
/// bullet marker, tags, links, unrecognized metadata, scheduled/start/created dates, and block IDs.
pub fn patch_task_raw_line(
    raw_line: &str,
    patch: &TaskPatchRequest,
) -> Result<String, String> {
    let caps = TASK_LINE_RE
        .captures(raw_line)
        .ok_or_else(|| "Baris sumber bukan format task Markdown yang valid".to_string())?;

    let indent = caps.get(1).unwrap().as_str();
    let bullet = caps.get(2).unwrap().as_str();
    let old_check = caps.get(3).unwrap().as_str();
    let old_body = caps.get(4).unwrap().as_str();

    // Prevent mutating recurring tasks or unsupported custom statuses in MVP
    if old_body.contains('🔁') {
        return Err("Task berulang (🔁) bersifat baca-saja pada MVP untuk mencegah kerusakan jadwal recurrence.".to_string());
    }
    if old_check != " " && old_check != "x" && old_check != "X" {
        return Err(format!(
            "Task dengan custom status '[{}]' bersifat baca-saja.",
            old_check
        ));
    }

    let mut new_check = old_check.to_string();
    let mut new_body = old_body.to_string();

    // 1. Handle status change (Todo <-> Done) and ✅ done date management
    if let Some(ref target_status) = patch.new_status {
        match target_status {
            CheckboxStatus::Todo => {
                new_check = " ".to_string();
                // Remove ✅ YYYY-MM-DD when reopening task
                new_body = DONE_RE.replace_all(&new_body, "").to_string();
            }
            CheckboxStatus::Done => {
                new_check = "x".to_string();
                if !DONE_RE.is_match(&new_body) {
                    // Insert ✅ today_local before block ID if present, else at end
                    if let Some(b_cap) = BLOCK_ID_RE.captures(&new_body.clone()) {
                        let block_id = b_cap.get(1).unwrap().as_str();
                        let without_block = BLOCK_ID_RE.replace(&new_body, "").trim_end().to_string();
                        new_body = format!("{} ✅ {} {}", without_block, patch.today_local, block_id);
                    } else {
                        new_body = format!("{} ✅ {}", new_body.trim_end(), patch.today_local);
                    }
                }
            }
            CheckboxStatus::Custom(c) => {
                new_check = c.clone();
            }
        }
    }

    // 2. Handle title edit without losing tags, links, dates, or unrecognized metadata
    if let Some(ref updated_title) = patch.new_title {
        let trimmed_new_title = updated_title.trim();
        if trimmed_new_title.is_empty() {
            return Err("Judul task tidak boleh kosong.".to_string());
        }
        new_body = replace_title_preserving_metadata(&new_body, trimmed_new_title);
    }

    // 3. Handle due date change (set, update, or remove)
    if let Some(ref due_change) = patch.new_due_date {
        match due_change {
            Some(new_date_str) => {
                if !is_valid_calendar_date(new_date_str) {
                    return Err(format!(
                        "Format tanggal tenggat tidak valid: {}",
                        new_date_str
                    ));
                }
                if DUE_RE.is_match(&new_body) {
                    new_body = DUE_RE
                        .replace(&new_body, format!("📅 {}", new_date_str).as_str())
                        .to_string();
                } else if let Some(b_cap) = BLOCK_ID_RE.captures(&new_body.clone()) {
                    let block_id = b_cap.get(1).unwrap().as_str();
                    let without_block = BLOCK_ID_RE.replace(&new_body, "").trim_end().to_string();
                    new_body = format!("{} 📅 {} {}", without_block, new_date_str, block_id);
                } else {
                    new_body = format!("{} 📅 {}", new_body.trim_end(), new_date_str);
                }
            }
            None => {
                // Remove existing due date token
                new_body = DUE_RE.replace_all(&new_body, "").to_string();
            }
        }
    }

    // Normalize internal duplicate spaces introduced by token removal while preserving single spacing
    let cleaned_body = new_body.split_whitespace().collect::<Vec<_>>().join(" ");
    Ok(format!("{}{} [{}] {}", indent, bullet, new_check, cleaned_body))
}

fn replace_title_preserving_metadata(old_body: &str, new_title: &str) -> String {
    // Collect trailing/inline metadata tokens that are not already in new_title
    let mut preserved_tokens: Vec<String> = Vec::new();

    // Preserve tags if user didn't include them in the edited title
    let new_title_without_links = MDLINK_RE.replace_all(new_title, " ");
    for cap in TAG_RE.captures_iter(old_body) {
        let tag = cap.get(1).unwrap().as_str().to_string();
        if !new_title_without_links.contains(&tag) && !preserved_tokens.contains(&tag) {
            preserved_tokens.push(tag);
        }
    }

    // Preserve Dataview fields
    for m in DATAVIEW_RE.find_iter(old_body) {
        let token = m.as_str().to_string();
        if !new_title.contains(&token) {
            preserved_tokens.push(token);
        }
    }

    // Preserve priority emoji
    for p in ['🔺', '⏫', '🔼', '🔽', '⏬'] {
        if old_body.contains(p) && !new_title.contains(p) {
            preserved_tokens.push(p.to_string());
        }
    }

    // Preserve date tokens
    for re in [&*CREATED_RE, &*START_RE, &*SCHEDULED_RE, &*DUE_RE, &*DONE_RE] {
        if let Some(m) = re.find(old_body) {
            let token = m.as_str().to_string();
            if !new_title.contains(&token) {
                preserved_tokens.push(token);
            }
        }
    }

    // Preserve block ID at the very end
    if let Some(b_cap) = BLOCK_ID_RE.captures(old_body) {
        let block_id = b_cap.get(1).unwrap().as_str().to_string();
        if !new_title.contains(&block_id) {
            preserved_tokens.push(block_id);
        }
    }

    if preserved_tokens.is_empty() {
        new_title.to_string()
    } else {
        format!("{} {}", new_title.trim_end(), preserved_tokens.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_standard_and_nested_tasks() {
        let md = "## Tugas Kuliah
- [ ] Menyelesaikan revisi proposal 📅 2026-10-16 #kuliah
  - [ ] Subtask cek sitasi [[Bab 2]]
- [x] Mengirim dokumen ✅ 2026-10-14
";
        let tasks = parse_markdown_tasks("Kuliah.md", md, &HashMap::new());
        assert_eq!(tasks.len(), 3);
        assert_eq!(tasks[0].status, CheckboxStatus::Todo);
        assert_eq!(tasks[0].due_date.as_deref(), Some("2026-10-16"));
        assert_eq!(tasks[0].tags, vec!["#kuliah"]);
        assert_eq!(tasks[1].nesting_level, 1);
        assert_eq!(tasks[1].links, vec!["[[Bab 2]]"]);
        assert_eq!(tasks[2].status, CheckboxStatus::Done);
        assert_eq!(tasks[2].done_date.as_deref(), Some("2026-10-14"));
    }

    #[test]
    fn test_ignore_fenced_code_blocks_and_queries() {
        let md = "# Catatan
```tasks
not done
due before 2026-10-20
- [ ] Task di dalam query block
```
- [ ] Task nyata di luar code block 📅 2026-10-18
~~~
- [ ] Task di dalam tilde block
~~~
";
        let tasks = parse_markdown_tasks("Catatan.md", md, &HashMap::new());
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].display_title, "Task nyata di luar code block");
    }

    #[test]
    fn test_recurring_and_custom_status_read_only() {
        let md = "- [ ] Bayar tagihan listrik 🔁 every month 📅 2026-10-25
- [/] Sedang dikerjakan setengah jalan 📅 2026-10-15
";
        let tasks = parse_markdown_tasks("Rutin.md", md, &HashMap::new());
        assert_eq!(tasks.len(), 2);
        assert!(tasks[0].is_recurring);
        assert!(tasks[0].is_read_only);
        assert_eq!(tasks[1].status, CheckboxStatus::Custom("/".to_string()));
        assert!(tasks[1].is_read_only);
    }

    #[test]
    fn test_invalid_calendar_date_flagged_not_dropped() {
        let md = "- [ ] Task dengan tanggal salah 📅 2026-02-30 #penting
";
        let tasks = parse_markdown_tasks("Invalid.md", md, &HashMap::new());
        assert_eq!(tasks.len(), 1);
        assert!(tasks[0].has_invalid_due_date);
        assert_eq!(tasks[0].raw_invalid_due_date.as_deref(), Some("2026-02-30"));
    }
}
