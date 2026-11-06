use super::files::write_library;
use super::settings::SELECTED_ROOT;
use super::*;
use std::{fs, path::PathBuf, sync::MutexGuard};
struct Scope {
    _guard: MutexGuard<'static, ()>,
    dir: tempfile::TempDir,
    previous: Option<PathBuf>,
}

#[test]
fn bulk_import_keeps_valid_files_and_reports_failures_and_duplicate_names() {
    let scope = Scope::new();
    let bytes = crate::music::midi::tests::fixture_bytes();
    let first = scope.dir.path().join("score.mid");
    let other_dir = scope.dir.path().join("another-source");
    fs::create_dir(&other_dir).unwrap();
    let second = other_dir.join("score.mid");
    let invalid = scope.dir.path().join("broken.mid");
    fs::write(&first, &bytes).unwrap();
    fs::write(&second, &bytes).unwrap();
    fs::write(&invalid, b"not a MIDI").unwrap();
    let report = import_midis(&[first.clone(), invalid.clone(), second.clone()]);
    assert_eq!(report.imported.len(), 2);
    assert_eq!(report.failed.len(), 1);
    assert_eq!(report.failed[0].file_name, "broken.mid");
    assert_eq!(report.imported[0].file, "score.mid");
    assert_eq!(report.imported[1].file, "score (2).mid");
    assert_ne!(report.imported[0].id, report.imported[1].id);
    assert_eq!(read_library().unwrap().len(), 2);
    assert_eq!(fs::read(first).unwrap(), bytes);
    assert_eq!(fs::read(second).unwrap(), bytes);
    assert_eq!(fs::read(invalid).unwrap(), b"not a MIDI");
    assert!(import_midis(&[]).imported.is_empty());
}

#[test]
fn selected_parts_survive_rename_and_playlists_and_old_entries_default_to_all() {
    let scope = Scope::new();
    let source = scope.midi();
    let entry = import_midi(&source).unwrap();
    let path = midi_path(&entry.file).unwrap();
    let original = fs::read(&path).unwrap();
    assert!(entry.selected_part_ids.is_none());
    save_selected_parts(&entry.id, &[]).unwrap();
    let renamed = rename_midi(&entry.id, "Renamed parts").unwrap();
    assert_eq!(renamed.selected_part_ids, Some(vec![]));
    assert_eq!(
        fs::read(midi_path(&renamed.file).unwrap()).unwrap(),
        original
    );
    save_selected_parts(&entry.id, &["0:0".into()]).unwrap();
    assert_eq!(
        read_library().unwrap()[0].selected_part_ids,
        Some(vec!["0:0".to_string()])
    );
    let file = scope.dir.path().join("library.json");
    fs::write(&file, b"{broken").unwrap();
    assert!(save_selected_parts(&entry.id, &[]).is_err());
    assert_eq!(fs::read(file).unwrap(), b"{broken");
}

#[cfg(windows)]
#[test]
fn bulk_import_and_part_selection_preserve_confirmed_files_after_write_failure() {
    let scope = Scope::new();
    let source = scope.midi();
    let entry = import_midi(&source).unwrap();
    let file = scope.dir.path().join("library.json");
    let before = fs::read(&file).unwrap();
    let permissions = fs::metadata(&file).unwrap().permissions();
    let mut readonly = permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&file, readonly).unwrap();
    let selection = save_selected_parts(&entry.id, &[]);
    let report = import_midis(&[source]);
    fs::set_permissions(&file, permissions).unwrap();
    assert!(selection.is_err());
    assert_eq!(report.imported.len(), 0);
    assert_eq!(report.failed.len(), 1);
    assert_eq!(fs::read(&file).unwrap(), before);
    assert_eq!(
        fs::read_dir(scope.dir.path().join("midi")).unwrap().count(),
        1
    );
}
impl Scope {
    fn new() -> Self {
        let guard = transaction().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let previous = SELECTED_ROOT.lock().unwrap().replace(dir.path().to_owned());
        Self {
            _guard: guard,
            dir,
            previous,
        }
    }
    fn midi(&self) -> PathBuf {
        let file = self.dir.path().join("original.mid");
        crate::transcription::decoder::write_midi(
            &file,
            &[crate::transcription::decoder::NoteEvent {
                start_frame: 2,
                end_frame: 30,
                pitch: 60,
                velocity: 100,
                pitch_bends: vec![],
            }],
        )
        .unwrap();
        file
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        *SELECTED_ROOT.lock().unwrap() = self.previous.take();
    }
}

#[test]
fn auto_advance_preference_roundtrips_without_overwriting_other_settings_or_invalid_json() {
    let scope = Scope::new();
    assert!(!read_settings().unwrap()["autoAdvanceEnabled"]
        .as_bool()
        .unwrap_or(false));
    write_settings_at(scope.dir.path(), serde_json::json!({ "other": 42 })).unwrap();
    write_auto_advance(true).unwrap();
    assert_eq!(read_settings().unwrap()["autoAdvanceEnabled"], true);
    assert_eq!(read_settings().unwrap()["other"], 42);
    write_auto_advance(false).unwrap();
    assert_eq!(read_settings().unwrap()["autoAdvanceEnabled"], false);
    let file = scope.dir.path().join("settings.json");
    fs::write(&file, b"{broken").unwrap();
    assert!(write_auto_advance(true).is_err());
    assert_eq!(fs::read(file).unwrap(), b"{broken");
}
#[test]
fn rename_preserves_playlist_id_and_reimport_has_new_id() {
    let scope = Scope::new();
    let source = scope.midi();
    let original = import_midi(&source).unwrap();
    let lists = vec![Playlist {
        id: "p".into(),
        name: "p".into(),
        track_ids: vec![original.id.clone()],
        created_at: "".into(),
    }];
    write_playlists(&lists).unwrap();
    let renamed = rename_midi(&original.id, "renamed").unwrap();
    assert_eq!(renamed.id, original.id);
    assert_eq!(
        read_playlists().unwrap()[0].track_ids.as_slice(),
        std::slice::from_ref(&renamed.id)
    );
    assert!(midi_path(&renamed.file).unwrap().is_file());
    let next = import_midi(&source).unwrap();
    assert_ne!(next.id, renamed.id);
}
#[test]
fn invalid_json_is_preserved_and_import_cannot_overwrite_it() {
    let scope = Scope::new();
    let source = scope.midi();
    let file = scope.dir.path().join("library.json");
    fs::write(&file, b"{broken").unwrap();
    assert!(read_library().is_err());
    assert!(import_midi(&source).is_err());
    assert_eq!(fs::read(file).unwrap(), b"{broken");
}
#[test]
fn atomic_write_replaces_valid_json_and_missing_file_is_empty() {
    let scope = Scope::new();
    assert!(read_library().unwrap().is_empty());
    write_library(&[]).unwrap();
    write_library(&[]).unwrap();
    assert_eq!(
        fs::read_to_string(scope.dir.path().join("library.json"))
            .unwrap()
            .trim(),
        "[]"
    );
}
#[test]
fn playlist_bulk_add_is_atomic_and_reorder_preserves_all_references() {
    let scope = Scope::new();
    let a = import_midi(&scope.midi()).unwrap();
    let b = import_midi(&scope.midi()).unwrap();
    write_playlists(&[Playlist {
        id: "p".into(),
        name: "P".into(),
        track_ids: vec!["missing".into(), a.id.clone()],
        created_at: "".into(),
    }])
    .unwrap();
    let file = scope.dir.path().join("playlists.json");
    let before = fs::read(&file).unwrap();
    assert!(add_playlist_tracks("p", &[b.id.clone(), "invalid".into()]).is_err());
    assert_eq!(fs::read(&file).unwrap(), before);
    let added = add_playlist_tracks("p", &[a.id.clone(), b.id.clone(), b.id.clone()]).unwrap();
    assert_eq!(
        added.track_ids,
        vec!["missing".to_string(), a.id.clone(), b.id.clone()]
    );
    let before = fs::read(&file).unwrap();
    for invalid in [
        vec![a.id.clone(), b.id.clone()],
        vec!["missing".into(), a.id.clone(), a.id.clone()],
        vec!["missing".into(), a.id.clone(), b.id.clone(), "extra".into()],
    ] {
        assert!(reorder_playlist("p", &invalid).is_err());
        assert_eq!(fs::read(&file).unwrap(), before);
    }
    let order = vec![b.id, "missing".into(), a.id];
    reorder_playlist("p", &order).unwrap();
    assert_eq!(read_playlists().unwrap()[0].track_ids, order);
    fs::write(&file, b"{broken").unwrap();
    assert!(add_playlist_tracks("p", &[]).is_err());
    assert!(reorder_playlist("p", &[]).is_err());
    assert_eq!(fs::read(&file).unwrap(), b"{broken");
}
#[test]
fn deletion_cleans_file_and_playlist_and_invalid_index_preserves_data() {
    let scope = Scope::new();
    let source = scope.midi();
    let entry = import_midi(&source).unwrap();
    write_playlists(&[Playlist {
        id: "p".into(),
        name: "p".into(),
        track_ids: vec![entry.id.clone()],
        created_at: "".into(),
    }])
    .unwrap();
    let lists = scope.dir.path().join("playlists.json");
    let saved = fs::read(&lists).unwrap();
    fs::write(&lists, b"invalid").unwrap();
    assert!(delete_midi(&entry.id).is_err());
    assert!(midi_path(&entry.file).unwrap().exists());
    assert_eq!(read_library().unwrap().len(), 1);
    fs::write(&lists, saved).unwrap();
    delete_midi(&entry.id).unwrap();
    assert!(!midi_path(&entry.file).unwrap().exists());
    assert!(read_library().unwrap().is_empty());
    assert!(read_playlists().unwrap()[0].track_ids.is_empty());
}
